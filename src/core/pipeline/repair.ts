import * as fs from "node:fs";
import * as path from "node:path";
import { redactSecrets } from "../../agents/prompt.js";
import { git, gitOrThrow, PLATFORM_IDENTITY } from "./git.js";
import type { CandidateGeneration, RepairAttempt, Task, VerificationEvidence } from "../types.js";

export const MAX_REPAIR_ROUNDS = 2;
const MAX_FILE_BYTES = 200_000;

/** Produces a model completion for a prompt. Production: Workers AI through AI Gateway. */
export type RepairModel = (prompt: string) => Promise<string>;

export interface RepairOptions {
  repoDir: string;
  candidate: CandidateGeneration;
  /** Every change being combined, in merge order (one change rebasing onto newer accepted work is valid too). */
  tasks: Task[];
  round: number;
  conflictType: "text_conflict" | "behavior_failure";
  /** Files the model may rewrite. Anything else in its answer is rejected. */
  editableFiles: string[];
  /** Read-only source files the repair may depend on (types, callers). */
  contextFiles?: Record<string, string>;
  /** Per conflicting file: the common base and each contributor's version. */
  sideVersions?: Record<string, { base: string; a: string; b: string }>;
  /** Current contents (with native conflict markers for text conflicts) the model sees. */
  fileContents: Record<string, string>;
  failureEvidence?: VerificationEvidence | null;
  protectedPaths: readonly string[];
  model: RepairModel;
}

export interface RepairResult {
  success: boolean;
  candidateCommit: string | null;
  attempt: RepairAttempt;
  error?: string;
}

const FILE_BLOCK = /<file path="([^"]+)">\n([\s\S]*?)\n<\/file>/g;

export function buildRepairPrompt(opts: RepairOptions): string {
  const requirements = opts.candidate.frozenRequirements
    .filter((r) => r.status === "approved")
    .map((r) => `- ${r.id}: ${r.title} — ${r.description}`)
    .join("\n");
  const failures =
    opts.failureEvidence?.testResults
      .flatMap((s) => s.items.filter((i) => !i.passed))
      .map((i) => `- ${i.testId}: ${i.description}${i.message ? ` (${i.message})` : ""}`)
      .join("\n") ?? "";
  const files = opts.editableFiles
    .map((f) => `<current path="${f}">\n${opts.fileContents[f] ?? ""}\n</current>`)
    .join("\n");

  const context = Object.entries(opts.contextFiles ?? {})
    .map(([f, c]) => `<readonly path="${f}">\n${c}\n</readonly>`)
    .join("\n");
  const sides = Object.entries(opts.sideVersions ?? {})
    .map(
      ([f, v]) =>
        `<versions path="${f}">\n<base>\n${v.base}\n</base>\n<contributor_a>\n${v.a}\n</contributor_a>\n<contributor_b>\n${v.b}\n</contributor_b>\n</versions>`
    )
    .join("\n");

  return redactSecrets([
    opts.tasks.length > 1
      ? `You are the FlareGit integration repair engine. ${opts.tasks.length} contributors changed the same codebase in parallel.`
      : "You are the FlareGit integration repair engine. A contributor's change was written against an older version and newer work has been accepted since.",
    "Produce a single working version that preserves EVERY contributor's intended behavior, including the already accepted version. Never drop a feature,",
    "never edit tests or verification config, and do not change unrelated behavior.",
    "",
    ...opts.tasks.map((t, i) => `Contributor ${String.fromCharCode(65 + i)} (${t.contributor.name}): ${t.goal}`),
    "",
    `Problem type: ${opts.conflictType === "text_conflict" ? "Git text conflict (conflict markers present)" : "Clean merge that fails protected verification"}`,
    "",
    "Approved requirements:",
    requirements || "(none)",
    failures ? `\nProtected verification failures:\n${failures}` : "",
    "",
    "Files you may rewrite:",
    files,
    sides ? `\nEach side's version of the conflicting files:\n${sides}` : "",
    context ? `\nRead-only context (use only types and exports that exist here):\n${context}` : "",
    "",
    'Reply with the COMPLETE new content of every file you change, each as: <file path="PATH">\\nCONTENT\\n</file>.',
    "Reply with nothing else you want applied. No conflict markers may remain. Keep every public type and export compatible with the read-only context; do not invent types, and import every type you use from ./types.js. Totals must reconcile (any itemized receipt must sum to the total).",
  ].join("\n"));
}

export function parseRepairResponse(output: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const match of output.matchAll(FILE_BLOCK)) {
    files.set(match[1]!, match[2]!);
  }
  return files;
}

function isProtected(file: string, protectedPaths: readonly string[]): boolean {
  return protectedPaths.some((p) => (p.endsWith("/") ? file.startsWith(p) : file === p));
}

function fail(round: number, prompt: string, started: number, message: string, files: string[]): RepairResult {
  message = redactSecrets(message);
  return {
    success: false,
    candidateCommit: null,
    attempt: {
      round,
      prompt,
      patch: "",
      affectedContracts: files,
      diagnosticError: message,
      durationMs: Math.round(performance.now() - started),
      timestamp: new Date().toISOString(),
    },
    error: message,
  };
}

export async function repairCandidate(opts: RepairOptions): Promise<RepairResult> {
  const started = performance.now();
  const prompt = buildRepairPrompt(opts);
  const { repoDir, round } = opts;

  if (round > MAX_REPAIR_ROUNDS) {
    return fail(round, prompt, started, `Exceeded maximum repair rounds (${MAX_REPAIR_ROUNDS}).`, opts.editableFiles);
  }

  if (Object.values(opts.fileContents).some((content) => redactSecrets(content) !== content)) {
    return fail(round, prompt, started, "Automatic repair refused: an editable file contains credentials; a contributor must resolve it", opts.editableFiles);
  }

  let output: string;
  try {
    output = await opts.model(prompt);
  } catch (err) {
    return fail(round, prompt, started, `Repair model unavailable: ${err instanceof Error ? err.message : String(err)}`, opts.editableFiles);
  }

  const proposed = parseRepairResponse(output);
  if (proposed.size === 0) {
    return fail(round, prompt, started, "Repair model returned no file changes.", opts.editableFiles);
  }

  const root = path.resolve(repoDir);
  for (const [file, content] of proposed) {
    const target = path.resolve(root, file);
    if (!target.startsWith(root + path.sep)) return fail(round, prompt, started, `Repair path escapes workspace: ${file}`, [file]);
    if (!opts.editableFiles.includes(file)) return fail(round, prompt, started, `Repair touched out-of-scope file: ${file}`, [file]);
    let cursor = target;
    while (cursor !== root) {
      if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) return fail(round, prompt, started, "Repair through a symbolic link refused", [file]);
      cursor = path.dirname(cursor);
    }
    if (isProtected(file, opts.protectedPaths)) return fail(round, prompt, started, `Repair touched protected path: ${file}`, [file]);
    if (/^(<<<<<<<|=======|>>>>>>>)/m.test(content)) return fail(round, prompt, started, `Conflict markers remain in ${file}`, [file]);
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) return fail(round, prompt, started, `Repair output too large for ${file}`, [file]);
  }

  for (const [file, content] of proposed) {
    fs.writeFileSync(path.join(root, file), content.endsWith("\n") ? content : `${content}\n`);
  }

  gitOrThrow(repoDir, ["add", "-A"]);
  const message = `FlareGit repair (round ${round}) for ${opts.tasks.map((t) => t.id).join(" + ")}`;
  const commit = git(repoDir, [...PLATFORM_IDENTITY, "commit", "--allow-empty", "-m", message]);
  if (!commit.ok) return fail(round, prompt, started, `Git commit of repair failed: ${commit.stderr.trim()}`, [...proposed.keys()]);

  return {
    success: true,
    candidateCommit: gitOrThrow(repoDir, ["rev-parse", "HEAD"]),
    attempt: {
      round,
      prompt,
      patch: [...proposed.keys()].join(", "),
      affectedContracts: [...proposed.keys()],
      diagnosticError: "",
      durationMs: Math.round(performance.now() - started),
      timestamp: new Date().toISOString(),
    },
  };
}
