import {acceptedTargetSchema,assertCompatibleAcceptedTargetBatch,type FrozenAcceptedTarget} from "../core/accepted-target";
import { z } from "zod";
import { assertAgentWrites, redactSecrets } from "../agents/prompt.js";
import { isSafeRef } from "../core/sanitize.js";

export type AgentRunPhase = "claimed" | "proposed" | "pushed" | "checkpointed" | "failed";
export interface AgentRunInput {
  readonly acceptedTarget?:FrozenAcceptedTarget;
  runId: string; taskId: string; startingCommit: string; startingBranchHead: string | null; branch: string; goal: string;
  context: { issue?: { number: number; title: string; summary: string }; comments: Array<{ id: string | number; summary: string }> };
  allowedScope: string[]; protectedPaths: string[];
}
export interface AgentRunRecord extends AgentRunInput {
  generation: number; phase: AgentRunPhase; proposal?: { files: Record<string, string>; digest: string; commitDate?: string };
  resumedFrom?: string;
  pushedCommit?: string; checkpointEventId?: string; failure?: string; createdAt: string; updatedAt: string;
}
export type AgentRunClaim = { kind: "claimed" | "existing" | "busy"; run: AgentRunRecord };
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const inputSchema = z.object({ acceptedTarget:acceptedTargetSchema.optional(), runId: id, taskId: id, startingCommit: sha, startingBranchHead: sha.nullable(), branch: z.string().refine(isSafeRef), goal: z.string().min(1).max(1000),
  context: z.object({ issue: z.object({ number: z.number().int().positive(), title: z.string().max(1000), summary: z.string().max(6000) }).strict().optional(), comments: z.array(z.object({ id: z.union([id, z.number().int().nonnegative()]), summary: z.string().max(1500) }).strict()).max(20) }).strict(),
  allowedScope: z.array(z.string().min(1).max(500)).min(1).max(100), protectedPaths: z.array(z.string().min(1).max(500)).max(100),
}).strict();
const proposalSchema = z.record(z.string(), z.string()).refine((files) => Object.keys(files).length > 0 && Object.keys(files).length <= 100 && new TextEncoder().encode(JSON.stringify(files)).length <= 120_000);

/** Repository-local durable run ownership. No clock expiration can steal a live
 * run: replacement requires its recorded terminal phase. All writes compare the
 * exact task/run generation, so a late callback cannot affect a replacement.
 */
export class AgentRunLedger {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS agent_runs(id TEXT PRIMARY KEY,doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_run_heads(task_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,generation INTEGER NOT NULL);`);
  }
  get(runId: string): AgentRunRecord | null { const row = this.storage.sql.exec<{ doc: string }>("SELECT doc FROM agent_runs WHERE id=?", runId).toArray()[0]; return row ? JSON.parse(row.doc) as AgentRunRecord : null; }
  private head(taskId: string) { return this.storage.sql.exec<{ run_id: string; generation: number }>("SELECT run_id,generation FROM agent_run_heads WHERE task_id=?", taskId).toArray()[0]; }
  private current(runId: string, taskId: string): AgentRunRecord | null {
    const run = this.get(runId), head = this.head(taskId);
    return run?.taskId === taskId && head?.run_id === runId && head.generation === run.generation ? run : null;
  }
  private save(run: AgentRunRecord) { this.storage.sql.exec("UPDATE agent_runs SET doc=? WHERE id=?", JSON.stringify({ ...run, updatedAt: new Date().toISOString() }), run.runId); }
  claim(input: AgentRunInput): AgentRunClaim {
    const value = inputSchema.parse(input);
    return this.storage.transactionSync(() => {
      const existing = this.get(value.runId);
      if (existing) {
        if(Boolean(existing.acceptedTarget)!==Boolean(value.acceptedTarget))throw new Error("Agent accepted target binding changed");
        if(existing.acceptedTarget&&value.acceptedTarget)assertCompatibleAcceptedTargetBatch([existing.acceptedTarget,value.acceptedTarget]);
        if (existing.taskId !== value.taskId) throw new Error("Run identity belongs to another task");
        const head = this.head(value.taskId);
        if (head?.run_id !== existing.runId || head.generation !== existing.generation) {
          const replacement = head ? this.get(head.run_id) : null;
          if (!replacement) throw new Error("Run generation is unavailable");
          return { kind: "busy", run: replacement };
        }
        return { kind: "existing", run: existing };
      }
      const head = this.head(value.taskId), current = head ? this.get(head.run_id) : null;
      if (current && current.phase !== "failed" && current.phase !== "checkpointed") return { kind: "busy", run: current };
      const now = new Date().toISOString();
      const run: AgentRunRecord = { ...value, goal: redactSecrets(value.goal), context: { ...(value.context.issue ? { issue: { ...value.context.issue, title: redactSecrets(value.context.issue.title), summary: redactSecrets(value.context.issue.summary) } } : {}), comments: value.context.comments.map((comment) => ({ ...comment, summary: redactSecrets(comment.summary) })) }, generation: (head?.generation ?? 0) + 1, phase: "claimed", createdAt: now, updatedAt: now };
      this.storage.sql.exec("INSERT INTO agent_runs VALUES (?,?)", run.runId, JSON.stringify(run));
      this.storage.sql.exec("INSERT INTO agent_run_heads VALUES (?,?,?) ON CONFLICT(task_id) DO UPDATE SET run_id=excluded.run_id,generation=excluded.generation", run.taskId, run.runId, run.generation);
      return { kind: "claimed", run };
    });
  }
  /** Explicit recovery transfers the immutable saved proposal to a new generation.
   * Current policy can narrow access; a changed task purpose needs a new proposal.
   */
  resume(newRunId: string, taskId: string, previousRunId: string, allowedScope: string[], protectedPaths: string[], goal: string): AgentRunClaim {
    id.parse(newRunId); id.parse(taskId); id.parse(previousRunId);
    return this.storage.transactionSync(() => {
      const previous = this.current(previousRunId, taskId);
      if (!previous || previous.phase !== "failed" || !previous.proposal || newRunId === previousRunId || this.get(newRunId)) throw new Error("The exact failed proposal is unavailable for recovery");
      const frozenGoal = redactSecrets(z.string().min(1).max(1000).parse(goal));
      if (frozenGoal !== previous.goal) throw new Error("Task purpose changed; create a new proposal instead of replaying the old one");
      const input = inputSchema.parse({ runId: newRunId, taskId, ...(previous.acceptedTarget?{acceptedTarget:previous.acceptedTarget}:{}), startingCommit: previous.startingCommit, startingBranchHead: previous.startingBranchHead, branch: previous.branch, goal: frozenGoal, context: previous.context, allowedScope, protectedPaths });
      const files = proposalSchema.parse(previous.proposal.files);
      if (Object.values(files).some((content) => redactSecrets(content) !== content)) throw new Error("Saved proposal contains credentials and cannot be resumed");
      assertAgentWrites({ allowedScope }, Object.keys(files), protectedPaths);
      const now = new Date().toISOString();
      const run: AgentRunRecord = { ...input, generation: previous.generation + 1, phase: "proposed", proposal: { ...previous.proposal, files, commitDate: previous.proposal.commitDate ?? previous.createdAt }, resumedFrom: previousRunId, createdAt: now, updatedAt: now };
      this.storage.sql.exec("INSERT INTO agent_runs VALUES (?,?)", run.runId, JSON.stringify(run));
      this.storage.sql.exec("UPDATE agent_run_heads SET run_id=?,generation=? WHERE task_id=?", run.runId, run.generation, taskId);
      return { kind: "claimed", run };
    });
  }
  async propose(runId: string, taskId: string, proposed: Record<string, string>): Promise<boolean> {
    const files = proposalSchema.parse(proposed);
    if (Object.values(files).some((content) => redactSecrets(content) !== content)) throw new Error("Agent proposal contains credentials; nothing was stored");
    const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(ordered)));
    const digest = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return this.storage.transactionSync(() => {
      const run = this.current(runId, taskId);
      if (!run || run.phase === "failed") return false;
      if (run.proposal) return run.proposal.digest === digest;
      if (run.phase !== "claimed") return false;
      assertAgentWrites({ allowedScope: run.allowedScope }, Object.keys(ordered), run.protectedPaths);
      this.save({ ...run, phase: "proposed", proposal: { files: ordered, digest, commitDate: run.createdAt } }); return true;
    });
  }
  markPushed(runId: string, taskId: string, commit: string): boolean {
    sha.parse(commit);
    return this.storage.transactionSync(() => {
      const run = this.current(runId, taskId);
      if (!run || run.phase === "failed") return false;
      if (run.pushedCommit) return run.pushedCommit === commit;
      if (run.phase !== "proposed") return false;
      this.save({ ...run, phase: "pushed", pushedCommit: commit }); return true;
    });
  }
  checkpoint(runId: string, taskId: string, eventId: string, commit: string): boolean {
    id.parse(eventId); sha.parse(commit);
    return this.storage.transactionSync(() => {
      const run = this.current(runId, taskId);
      if (!run || run.pushedCommit !== commit) return false;
      if (run.phase === "checkpointed") return run.checkpointEventId === eventId;
      if (run.phase !== "pushed") return false;
      this.save({ ...run, phase: "checkpointed", checkpointEventId: eventId }); return true;
    });
  }
  fail(runId: string, taskId: string, reason = "Agent execution failed; saved context, proposals and pushed commits remain recoverable"): boolean {
    return this.storage.transactionSync(() => {
      const run = this.current(runId, taskId);
      if (!run || run.phase === "checkpointed") return false;
      if (run.phase === "failed") return true;
      this.save({ ...run, phase: "failed", failure: redactSecrets(reason).slice(0, 1000) }); return true;
    });
  }
}
