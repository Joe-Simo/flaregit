import * as fs from "node:fs";
import * as path from "node:path";
import { git, gitOrThrow } from "../core/pipeline/git.js";
import { parseRepairResponse, type RepairModel } from "../core/pipeline/repair.js";
import type { Task } from "../core/types.js";
import { assertAgentWrites, buildAgentPrompt, inAgentScope, isProtectedPath, redactSecrets } from "./prompt.js";

export interface AgentLogEntry {
  action: "read" | "model" | "write" | "commit" | "push";
  detail: string;
  timestamp: string;
}

const MAX_CONTEXT_BYTES = 120_000;
const MAX_FILE_BYTES = 200_000;

/**
 * A runtime coding agent bound to one task's isolated workspace. The model (Workers AI in
 * production) proposes complete file contents; this class only applies them inside the task's
 * allowed scope, then commits and pushes with ordinary Git to the task's own repository.
 */
export class RuntimeCodingAgent {
  readonly id: string;
  readonly name: string;
  readonly workspacePath: string;
  readonly log: AgentLogEntry[] = [];

  constructor(
    private readonly task: Task,
    private readonly protectedPaths: readonly string[] = []
  ) {
    this.id = task.contributor.id;
    this.name = task.contributor.name;
    if (!task.workspace.localPath) throw new Error(`Task ${task.id} has no workspace`);
    this.workspacePath = task.workspace.localPath;
  }

  private record(action: AgentLogEntry["action"], detail: string): void {
    this.log.push({ action, detail, timestamp: new Date().toISOString() });
  }

  private inScope(file: string): boolean {
    return inAgentScope(this.task, file);
  }

  private isProtected(file: string): boolean {
    return isProtectedPath(file, this.protectedPaths);
  }

  private assertRegularPath(file: string): string {
    assertAgentWrites(this.task, [file], this.protectedPaths);
    const root = path.resolve(this.workspacePath);
    const target = path.resolve(root, file);
    for (let cursor = target; cursor !== root; cursor = path.dirname(cursor)) {
      if (fs.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("Agent refuses a symbolic link in a source path");
    }
    return target;
  }

  private readContextFiles(): Record<string, string> {
    const listing = git(this.workspacePath, ["ls-files", "-z"]);
    if (!listing.ok) throw new Error("Could not inspect tracked workspace files");
    const tracked = listing.stdout.split("\0").filter(Boolean);
    let total = 0;
    const out: Record<string, string> = {};
    for (const f of tracked) {
      if (!this.inScope(f) || this.isProtected(f) || !/\.(ts|tsx|css|json|html|md)$/.test(f)) continue;
      const content = fs.readFileSync(this.assertRegularPath(f), "utf-8");
      total += Buffer.byteLength(content);
      if (total > MAX_CONTEXT_BYTES) break;
      out[f] = content;
    }
    this.record("read", `${Object.keys(out).length} files`);
    return out;
  }

  /** Ask the model to implement the task, apply the result, commit and push. Returns the commit. */
  async work(model: RepairModel): Promise<string> {
    if (gitOrThrow(this.workspacePath, ["status", "--porcelain"])) throw new Error("Workspace has unsaved changes; checkpoint them before running an agent");
    const prompt = buildAgentPrompt(this.task, this.name, this.readContextFiles());

    const output = await model(prompt);
    this.record("model", `${output.length} chars returned`);
    const files = parseRepairResponse(output);
    if (files.size === 0) throw new Error(`Agent ${this.name}: model returned no file changes`);

    assertAgentWrites(this.task, [...files.keys()], this.protectedPaths);
    for (const [file, content] of files) {
      const target = this.assertRegularPath(file);
      if (fs.existsSync(target)) {
        const original = fs.readFileSync(target, "utf8");
        if (redactSecrets(original) !== original) throw new Error("Agent refuses whole-file replacement of a credential-bearing file");
      }
      if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error(`Agent ${this.name}: ${file} too large`);
    }
    // Validate the entire response before modifying any contributor work.
    for (const [file, content] of files) {
      const target = this.assertRegularPath(file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content.endsWith("\n") ? content : `${content}\n`);
      this.record("write", file);
    }

    gitOrThrow(this.workspacePath, ["add", "-A"]);
    const committed = git(this.workspacePath, [
      "-c",
      `user.name=${this.name}`,
      "-c",
      `user.email=${this.task.id}@agents.flaregit.com`,
      "commit",
      "-m",
      this.task.goal,
    ]);
    if (!committed.ok) throw new Error(`Agent ${this.name}: commit failed: ${redactSecrets(committed.stderr.trim() || committed.stdout.trim())}`);
    const hash = gitOrThrow(this.workspacePath, ["rev-parse", "HEAD"]);
    this.record("commit", hash.slice(0, 7));

    gitOrThrow(this.workspacePath, ["push", "--quiet", "origin", `${this.task.workspace.branch}:${this.task.workspace.branch}`]);
    this.record("push", this.task.workspace.branch);
    return hash;
  }
}
