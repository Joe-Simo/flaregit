import { z } from "zod";
import { requirementPromptLine } from "../core/requirement-drafts.js";
import type { Requirement } from "../core/types.js";
import { applyAgentEdits, currentRegion, EDIT_FORMAT_INSTRUCTIONS, EditRejectedError, MISMATCH_EXCERPT_CHARS, parseAgentResponse } from "../agents/edit-format.js";
import { redactSecrets } from "../agents/prompt.js";

/** Rounds used when AGENT_MAX_ROUNDS is unset, and the hard ceiling for any configuration. */
export const DEFAULT_AGENT_ROUNDS = 3;
export const MAX_AGENT_ROUNDS = 5;
/** Container seconds reserved from the run's managed envelope by each round. */
export const ROUND_CONTAINER_SECONDS = 240;
/** Longest a single repository test run may take inside a round. */
export const ROUND_TEST_TIMEOUT_SECONDS = 150;
const SUMMARY_CHARS = 1200;

export function agentLoopRounds(configured: string | undefined): number {
  if (configured === undefined || configured === "") return DEFAULT_AGENT_ROUNDS;
  const parsed = z.coerce.number().int().min(1).max(MAX_AGENT_ROUNDS).safeParse(configured);
  if (!parsed.success) throw new Error(`AGENT_MAX_ROUNDS must be a whole number from 1 to ${MAX_AGENT_ROUNDS}`);
  return parsed.data;
}

/** Each round spends one container reservation and one model call; publishing spends one more container reservation. */
export function fundedAgentRounds(requested: number, envelope: { maxCalls: number; maxContainerSeconds: number }, publishContainerSeconds: number): number {
  const byCalls = Math.floor((envelope.maxCalls - 1) / 2);
  const bySeconds = Math.floor((envelope.maxContainerSeconds - publishContainerSeconds) / ROUND_CONTAINER_SECONDS);
  return Math.max(1, Math.min(requested, MAX_AGENT_ROUNDS, byCalls, bySeconds));
}

const count = z.number().int().nonnegative().nullable();
export const testReportSchema = z.object({ status: z.enum(["passed", "failed", "not-run"]), passed: count, failed: count, summary: z.string().max(SUMMARY_CHARS) }).strict();
export const agentRoundRecordSchema = z.object({
  round: z.number().int().min(1).max(MAX_AGENT_ROUNDS),
  plan: z.array(z.string().max(300)).max(12),
  reasoning: z.string().max(1200),
  filesChanged: z.array(z.string().min(1).max(500)).max(100),
  edits: z.enum(["applied", "rejected", "none"]),
  tests: testReportSchema,
  /** When a search block did not match: the exact current content of that file (whole when small, else the region around the closest match). */
  mismatch: z.object({ path: z.string().min(1).max(500), whole: z.boolean(), current: z.string().max(MISMATCH_EXCERPT_CHARS) }).strict().optional(),
}).strict();
export const agentExplanationSchema = z.object({
  goal: z.string().max(1000),
  plan: z.array(z.string().max(300)).max(12),
  reasoning: z.string().max(1200),
  filesTouched: z.array(z.string().min(1).max(500)).max(100),
  rounds: z.array(agentRoundRecordSchema).max(MAX_AGENT_ROUNDS),
  maxRounds: z.number().int().min(1).max(MAX_AGENT_ROUNDS),
  verification: z.enum(["repository-tests", "standard-verification"]),
  note: z.string().max(600),
}).strict();
export type TestReport = z.infer<typeof testReportSchema>;
export type AgentRoundRecord = z.infer<typeof agentRoundRecordSchema>;
export type AgentChangeExplanation = z.infer<typeof agentExplanationSchema>;

/** Durable input to one round. `files` holds every file changed by earlier rounds. */
export interface AgentRoundInput { round: number; maxRounds: number; history: AgentRoundRecord[]; files: Record<string, string> }
export type AgentChecks = { kind: "ran"; report: TestReport } | { kind: "unavailable"; reason: string };
/** Serializable Workflow step result. */
export type AgentRoundStep =
  | { kind: "round"; record: AgentRoundRecord; files: Record<string, string>; final: boolean; verification: AgentChangeExplanation["verification"]; proposalId?: string }
  | { kind: "result"; result: { commit: string; recovered?: boolean; proposalId?: string } };

/** Extracts pass/fail counts from common test runners; null when the output has no recognizable summary. */
export function summarizeTestRun(exitCode: number, output: string, timedOut = false): TestReport {
  const text = redactSecrets(output);
  const num = (pattern: RegExp) => { const m = pattern.exec(text); return m ? Number(m[1]) : null; };
  // bun test: " 12 pass" / " 1 fail"; jest/vitest: "Tests: 1 failed, 12 passed" / "Tests  1 failed | 12 passed"; pytest: "1 failed, 12 passed"; go/cargo/mocha variants.
  const passed = num(/^\s*(\d+) pass\b/m) ?? num(/(\d+) passed\b/) ?? num(/(\d+) passing\b/) ?? num(/test result: \w+\. (\d+) passed/);
  const failed = num(/^\s*(\d+) fail\b/m) ?? num(/(\d+) failed\b/) ?? num(/(\d+) failing\b/) ?? (passed !== null ? 0 : null);
  const ok = exitCode === 0 && !timedOut;
  return testReportSchema.parse({ status: ok ? "passed" : "failed", passed, failed: ok && failed === null ? null : failed, summary: ok ? "All checks passed." : failureSummary(text, timedOut) });
}

/** Keeps the lines that explain a failure, newest last, within a small bound. */
export function failureSummary(output: string, timedOut = false): string {
  const lines = redactSecrets(output).split("\n").map((line) => line.trimEnd()).filter(Boolean);
  const interesting = lines.filter((line) => /(fail|error|expected|received|assert|✗|×|panic|exception|cannot|not found|TS\d{4})/i.test(line));
  const chosen = (interesting.length ? interesting : lines).slice(-12).join("\n");
  const prefix = timedOut ? "The test run hit its time limit.\n" : "";
  const text = `${prefix}${chosen}`.trim() || "The checks failed without printing a reason.";
  return text.length > SUMMARY_CHARS ? `…${text.slice(-(SUMMARY_CHARS - 1))}` : text;
}

export interface RoundPromptTask { goal: string; requirements: ReadonlyArray<{ title: string; description: string; status?: Requirement["status"]; assertions?: Requirement["assertions"] }>; allowedScope: readonly string[] }

/** Prompt for one round. Earlier rounds' results are fed back so the model revises instead of restarting. */
export function buildRoundPrompt(task: RoundPromptTask, agentName: string, files: Readonly<Record<string, string>>, input: Pick<AgentRoundInput, "round" | "maxRounds" | "history">, checkCommand?: string, shared?: string): string {
  const requirements = task.requirements.filter((r) => r.status === undefined || r.status === "approved").map(requirementPromptLine).join("\n");
  const feedback = input.history.map((record) => {
    const outcome = record.edits === "rejected" ? "your edits could not be applied" : record.tests.status === "not-run" ? "checks did not run" : `checks ${record.tests.status}${record.tests.passed !== null || record.tests.failed !== null ? ` (${record.tests.passed ?? "?"} passed, ${record.tests.failed ?? "?"} failed)` : ""}`;
    const mismatch = record.mismatch ? `\n${record.mismatch.whole ? `The whole current content of ${record.mismatch.path} is exactly` : `The current content of ${record.mismatch.path} around where your search block should have matched is exactly`}:\n<current-excerpt path="${record.mismatch.path}">\n${record.mismatch.current}\n</current-excerpt>` : "";
    return `Round ${record.round}: ${outcome}.${record.filesChanged.length ? ` Files changed so far: ${record.filesChanged.join(", ")}.` : ""}\n${record.tests.summary}${mismatch}`;
  }).join("\n\n");
  const context = Object.entries(files).map(([path, content]) => `<current path="${path}">\n${redactSecrets(content)}\n</current>`).join("\n");
  return redactSecrets([
    `You are ${agentName}, a coding agent working in an isolated git workspace. This is round ${input.round} of at most ${input.maxRounds}.`,
    `Task: ${task.goal}`,
    requirements ? `Requirements:\n${requirements}` : "",
    shared ? `Shared context from the people on this change (issue, review comments, earlier progress). It may quote other versions of files, such as diffs of earlier work; never copy search text from it:\n${shared}` : "",
    `You may only change: ${task.allowedScope.map((x) => (x === "*" ? "any source file" : x)).join(", ")}.`,
    checkCommand ? `After your edits the repository's checks run automatically: ${checkCommand}` : "",
    feedback ? `Results of your earlier rounds (their accepted edits are already applied to the files below). Fix what failed; do not repeat edits that are already present:\n${feedback}` : "",
    "The <current> files below are the only version your edits are checked against; copy every <search> block from them.",
    "Keep every existing behavior that the task does not change. Do not touch tests, CI, package manifests or verification config. Import every type you use; do not invent exports.",
    "",
    context,
    "",
    EDIT_FORMAT_INSTRUCTIONS,
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n"));
}

export interface RoundDependencies {
  task: RoundPromptTask;
  agentName: string;
  /** Visible repository files with earlier rounds' changes already applied. */
  snapshot: Readonly<Record<string, string>>;
  checkCommand?: string;
  shared?: string;
  model(prompt: string): Promise<string>;
  /** Scope, protected-path and credential checks. Must throw on any refused path. */
  assertWrites(paths: string[]): void;
  /** Runs the repository's checks against the complete change set. */
  runChecks(files: Readonly<Record<string, string>>): Promise<AgentChecks>;
}

/** One plan → edit → test round. Policy refusals throw; malformed or stale edits become feedback for the next round. */
export async function executeAgentRound(input: AgentRoundInput, deps: RoundDependencies): Promise<Extract<AgentRoundStep, { kind: "round" }>> {
  // One frozen view: the prompt shows exactly the files the edits are validated against.
  const shown: Readonly<Record<string, string>> = Object.freeze({ ...deps.snapshot });
  const prompt = buildRoundPrompt(deps.task, deps.agentName, shown, input, deps.checkCommand, deps.shared);
  const answer = await deps.model(prompt);
  let files = { ...input.files }, changed: string[] = [], plan: string[] = [], reasoning = "", edits: AgentRoundRecord["edits"] = "none", rejection = "", mismatch: AgentRoundRecord["mismatch"];
  try {
    const parsed = parseAgentResponse(answer);
    plan = parsed.plan.map(redactSecrets); reasoning = redactSecrets(parsed.reasoning);
    deps.assertWrites(parsed.edits.map((edit) => edit.path));
    const applied = applyAgentEdits(shown, parsed.edits);
    changed = Object.keys(applied).sort();
    if (changed.length) { files = { ...files, ...applied }; edits = "applied"; }
  } catch (error) {
    if (!(error instanceof EditRejectedError) && !(error instanceof z.ZodError) && !(error instanceof Error && /^The (answer|edit)/.test(error.message))) throw error;
    edits = "rejected"; rejection = redactSecrets(error instanceof z.ZodError ? "The answer did not follow the required edit format" : error.message);
    if (error instanceof EditRejectedError && error.mismatch) {
      const region = currentRegion(error.mismatch.content, error.mismatch.search);
      mismatch = { path: error.mismatch.path, whole: region.whole, current: redactSecrets(region.text).slice(0, MISMATCH_EXCERPT_CHARS) };
    }
  }
  const last = input.round >= input.maxRounds;
  let tests: TestReport, verification: AgentChangeExplanation["verification"] = "repository-tests", final = last;
  if (edits !== "applied") {
    tests = { status: "not-run", passed: null, failed: null, summary: rejection || "No file changes were proposed, so there was nothing to check." };
  } else {
    const checks = await deps.runChecks(files);
    if (checks.kind === "unavailable") {
      tests = { status: "not-run", passed: null, failed: null, summary: redactSecrets(checks.reason).slice(0, SUMMARY_CHARS) };
      verification = "standard-verification"; final = true;
    } else {
      tests = checks.report;
      if (tests.status === "passed") final = true;
    }
  }
  const record = agentRoundRecordSchema.parse({ round: input.round, plan, reasoning, filesChanged: changed, edits, tests, ...(mismatch ? { mismatch } : {}) });
  return { kind: "round", record, files, final, verification };
}

/** Builds the plain-language explanation from completed rounds. */
export function explainAgentRun(goal: string, maxRounds: number, rounds: readonly AgentRoundRecord[], verification: AgentChangeExplanation["verification"]): AgentChangeExplanation {
  const latest = [...rounds].reverse().find((round) => round.plan.length || round.reasoning) ?? rounds.at(-1);
  const last = rounds.at(-1);
  const note = verification === "standard-verification"
    ? "This repository has no tests the agent could run, so the change was not tested during the agent's work. It still goes through the repository's standard verification before it can be accepted."
    : last?.tests.status === "passed"
      ? `The repository's tests passed after ${rounds.length} round${rounds.length === 1 ? "" : "s"}.`
      : `The repository's tests were still failing after ${rounds.length} of ${maxRounds} rounds. The latest attempt was saved for review; it must pass standard verification before it can be accepted.`;
  return agentExplanationSchema.parse({
    goal: redactSecrets(goal).slice(0, 1000), plan: latest?.plan ?? [], reasoning: latest?.reasoning ?? "",
    filesTouched: [...new Set(rounds.flatMap((round) => round.filesChanged))].sort(), rounds: [...rounds], maxRounds, verification, note,
  });
}

export interface AgentLoopDependencies {
  maxRounds: number;
  /** Durable checkpoint: a completed name returns its saved result without running again. */
  step(name: string, run: () => Promise<AgentRoundStep>): Promise<AgentRoundStep>;
  runRound(input: AgentRoundInput): Promise<AgentRoundStep>;
}

/** Bounded loop. Each round is its own durable step, so an interrupted run resumes after the last completed round. */
export async function runAgentLoop(deps: AgentLoopDependencies): Promise<{ commit: string; recovered?: boolean; proposalId?: string; rounds: number }> {
  const maxRounds = Math.min(Math.max(1, Math.floor(deps.maxRounds)), MAX_AGENT_ROUNDS);
  const history: AgentRoundRecord[] = [];
  let files: Record<string, string> = {};
  for (let round = 1; round <= maxRounds; round++) {
    const input: AgentRoundInput = { round, maxRounds, history: structuredClone(history), files: { ...files } };
    const outcome = await deps.step(`agent-round-${round}`, () => deps.runRound(input));
    if (outcome.kind === "result") return { ...outcome.result, rounds: history.length };
    history.push(outcome.record); files = outcome.files;
    if (outcome.final || round === maxRounds) return { commit: "", ...(outcome.proposalId ? { proposalId: outcome.proposalId } : {}), rounds: history.length };
  }
  throw new Error("Agent loop ended without a final round");
}

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
/** Exit codes the check script reserves for "could not run" (as opposed to failing tests). */
export const CHECK_ISOLATION_UNAVAILABLE = 97, CHECK_INSTALL_FAILED = 98;

/**
 * Shell script that runs the repository's checks on a disposable copy of the
 * workspace under a fresh unprivileged UID with no inherited environment,
 * mirroring the platform verifier's identity separation. Git metadata is not
 * copied, so repository code cannot reach the agent's clone or its remote.
 */
export function repositoryCheckScript(input: { workspace: string; install?: string; build?: string; test: string; timeoutSeconds: number; runId: string }): string {
  if (!/^\/[A-Za-z0-9/_-]+$/.test(input.workspace) || !/^[A-Za-z0-9_-]{1,200}$/.test(input.runId)) throw new Error("Invalid check workspace");
  const seconds = Math.max(5, Math.min(Math.floor(input.timeoutSeconds), ROUND_TEST_TIMEOUT_SECONDS));
  const copy = `/tmp/flaregit-agent-check-${input.runId}`;
  const env = `env -i HOME=${copy}/.home PATH=/usr/local/bin:/usr/bin:/bin CI=1 NO_COLOR=1`;
  const as = `timeout -s KILL ${seconds} setpriv --reuid "$u" --regid "$u" --clear-groups --no-new-privs -- ${env}`;
  const setup = [input.install, input.build].filter((command): command is string => Boolean(command)).join(" && ");
  return [
    `[ "$(id -u)" = 0 ] && command -v setpriv >/dev/null && command -v pkill >/dev/null && command -v timeout >/dev/null || exit ${CHECK_ISOLATION_UNAVAILABLE}`,
    `u=$((200000 + $(od -An -N3 -tu4 /dev/urandom | tr -d ' ') % 1000000))`,
    `rm -rf ${copy} && mkdir -p ${copy} && (cd ${input.workspace} && tar --exclude=./.git -cf - .) | tar -C ${copy} -xf - && mkdir -p ${copy}/.home && chown -R "$u:$u" ${copy} || exit ${CHECK_ISOLATION_UNAVAILABLE}`,
    `cd ${copy}`,
    setup ? `if ! ${as} sh -c ${quote(setup)} >${copy}.out 2>&1; then pkill -KILL -u "$u"; tail -c 6000 ${copy}.out; rm -rf ${copy} ${copy}.out; exit ${CHECK_INSTALL_FAILED}; fi` : ":",
    `${as} sh -c ${quote(input.test)} >${copy}.out 2>&1; code=$?`,
    `pkill -KILL -u "$u"; tail -c 16000 ${copy}.out; rm -rf ${copy} ${copy}.out; exit $code`,
  ].join("\n");
}

/** Interprets the check script's exit status. */
export function interpretCheckRun(exitCode: number, output: string): AgentChecks {
  if (exitCode === CHECK_ISOLATION_UNAVAILABLE) return { kind: "unavailable", reason: "The isolated test environment was unavailable, so the agent could not run the repository's tests." };
  if (exitCode === CHECK_INSTALL_FAILED) return { kind: "unavailable", reason: `The repository's dependencies could not be installed in the isolated workspace, so the agent could not run its tests.\n${failureSummary(output)}` };
  return { kind: "ran", report: summarizeTestRun(exitCode, output, exitCode === 137 || exitCode === 124) };
}
