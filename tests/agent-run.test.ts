import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentTask, type AgentExecutionLedger } from "../src/server/agent-run.js";
import type { Task } from "../src/core/types.js";
import type { AgentRunInput, AgentRunRecord } from "../src/server/agent-run-ledger.js";
import type { Env } from "../src/server/env.js";

// Native Git with a deterministic model double and in-memory durable-store double.
// These assertions verify recovery orchestration, not hosted provider execution.
async function fixture(options: { lostPush?: boolean; lostCheckpoint?: boolean; infoFails?: boolean; secret?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "agent-recovery-")), canonical = join(root, "repo.git"), seed = join(root, "seed");
  const git = async (args: string[]) => {
    const child = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@localhost", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@localhost" } });
    const [out, error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code) throw new Error(error); return out.trim();
  };
  await git(["init", "--bare", "--initial-branch=main", canonical]); await git(["clone", canonical, seed]);
  await mkdir(join(seed, "src")); await Bun.write(join(seed, "src/app.ts"), options.secret ? 'const api_key = "privatecredentialvalue";\n' : "export const value = 1;\n");
  await git(["-C", seed, "add", "."]); await git(["-C", seed, "commit", "-m", "base"]); await git(["-C", seed, "push", "origin", "main"]);
  const base = await git(["-C", seed, "rev-parse", "HEAD"]);
  const task: Task = { id: "change1", goal: "Change source", contributor: { id: "agent1", name: "Agent", type: "agent" }, baseCommit: base, currentCommit: base, status: "working", allowedScope: ["src/"], requirements: [], checkpoints: [], workspace: { repoName: "repo", remote: canonical, branch: "task/change1" }, createdAt: "2026-10-02", updatedAt: "2026-10-02" };
  const runs = new Map<string, AgentRunRecord>(); let active: string | undefined;
  let modelCalls = 0, destroyed = 0, revoked = 0, checkpoints = 0, lostPush = options.lostPush, lostCheckpoint = options.lostCheckpoint;
  const order: string[] = [];
  const ledger = {
    logActivity: async () => {},
    getState: async () => ({ projectId: "project1", tasks: { [task.id]: task } }), listComments: async () => [{ id: 1, author: "Maintainer", body: "Preserve customer behavior" }],
    getAgentRun: async (id: string) => runs.get(id) ?? null,
    claimAgentRun: async (input: AgentRunInput) => {
      if (active && active !== input.runId) return { kind: "busy", run: runs.get(active)! };
      if (runs.has(input.runId)) return { kind: "existing", run: runs.get(input.runId)! };
      const record: AgentRunRecord = { ...input, generation: 1, phase: "claimed", createdAt: "2026-10-02T10:00:00.000Z", updatedAt: "2026-10-02T10:00:00.000Z" };
      active = input.runId; runs.set(input.runId, record); return { kind: "claimed", run: record };
    },
    resumeAgentRun: async (newId: string, taskId: string, previousId: string) => {
      const previous = runs.get(previousId);
      if (!previous || previous.taskId !== taskId || previous.phase !== "failed" || !previous.proposal) throw new Error("Selected failed proposal is unavailable");
      const record: AgentRunRecord = { ...structuredClone(previous), runId: newId, phase: "proposed", generation: previous.generation + 1, resumedFrom: previousId, createdAt: "2026-10-03T10:00:00.000Z", updatedAt: "2026-10-03T10:00:00.000Z", proposal: { ...previous.proposal, files: { ...previous.proposal.files }, commitDate: previous.proposal.commitDate ?? previous.createdAt } };
      delete record.failure; delete record.checkpointEventId;
      active = newId; task.agentRunId = newId; runs.set(newId, record); return { kind: "claimed", run: record };
    },
    saveAgentProposal: async (id: string, _task: string, files: Record<string, string>) => { if (id !== active) return false; const record = runs.get(id)!; order.push("proposal-saved"); record.proposal ??= { files, digest: "fixture-digest", commitDate: record.createdAt }; record.phase = record.phase === "claimed" ? "proposed" : record.phase; return true; },
    markAgentPushed: async (id: string, _task: string, commit: string) => { if (id !== active) return false; const record = runs.get(id)!; record.phase = "pushed"; record.pushedCommit = commit; order.push("pushed-recorded"); return true; },
    ingestCheckpoint: async ({ commit }: { commit: string }) => { checkpoints++; order.push("checkpoint"); if (lostCheckpoint) { lostCheckpoint = false; throw new Error("Checkpoint response lost"); } task.currentCommit = commit; task.status = "ready"; return { applied: true }; },
    checkpointAgentRun: async (id: string, _task: string, eventId: string, commit: string) => { const record = runs.get(id)!; if (record.pushedCommit !== commit) return false; record.phase = "checkpointed"; record.checkpointEventId = eventId; return true; },
  } as unknown as AgentExecutionLedger;
  const env = {
    AGENT: { getByName: () => {
      const work = join(root, `work-${crypto.randomUUID()}`);
      return {
        exec: async (argv: string[], opts?: { env?: Record<string, string> }) => {
          const command = argv[2]!.replaceAll("/workspace/task", work);
          const child = Bun.spawn(["sh", "-c", command], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...opts?.env } });
          const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
          if (command.includes(" push ") && exitCode === 0 && lostPush) { lostPush = false; throw new Error("Push response lost after real ref update"); }
          return { success: exitCode === 0, stdout, stderr, exitCode };
        },
        readFile: async (file: string) => Bun.file(file.replaceAll("/workspace/task", work)).text(),
        writeFile: async (file: string, content: string) => { order.push("materialize"); await Bun.write(file.replaceAll("/workspace/task", work), content); },
        destroy: async () => { destroyed++; await rm(work, { recursive: true, force: true }); },
      };
    } },
    ARTIFACTS: { get: async () => ({ info: async () => { if (options.infoFails) throw new Error("Info unavailable"); return { remote: canonical }; }, createToken: async () => ({ plaintext: "fixture-token" }), revokeToken: async () => { revoked++; return true; }, [Symbol.dispose]: () => {} }) },
    AI: { run: async () => { modelCalls++; return { response: '<file path="src/app.ts">\nexport const value = 2;\n</file>' }; } },
  } as unknown as Env;
  return { env, ledger, task, runs, order, git, canonical, root, counts: () => ({ modelCalls, destroyed, revoked, checkpoints }), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test.each(["lostPush", "lostCheckpoint"] as const)("%s retry recovers the same pushed commit and persisted context without regenerating", async (failure) => {
  const f = await fixture({ [failure]: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-one")).rejects.toThrow(/lost/);
    const pushed = await f.git(["--git-dir", f.canonical, "rev-parse", "refs/heads/task/change1"]);
    const resumed = await runAgentTask(f.env, f.ledger, f.task, "run-one");
    expect(resumed.commit).toBe(pushed); expect(f.counts().modelCalls).toBe(1);
    expect(f.runs.get("run-one")?.phase).toBe("checkpointed");
    expect(f.runs.get("run-one")?.context.comments[0]?.summary).toContain("Preserve customer behavior");
    expect(f.order.indexOf("proposal-saved")).toBeLessThan(f.order.indexOf("materialize"));
    expect(f.order.indexOf("pushed-recorded")).toBeLessThan(f.order.indexOf("checkpoint"));
    expect((await runAgentTask(f.env, f.ledger, f.task, "run-one")).commit).toBe(pushed);
    expect(f.counts().destroyed).toBe(2); expect(f.counts().revoked).toBe(2);
  } finally { await f.cleanup(); }
});

test("another durable generation cannot produce a model call or overwrite a live run", async () => {
  const f = await fixture({ lostPush: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-one")).rejects.toThrow();
    const before = await f.git(["--git-dir", f.canonical, "rev-parse", "refs/heads/task/change1"]);
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-two")).rejects.toThrow(/generation owns/);
    expect(f.counts().modelCalls).toBe(1);
    expect(await f.git(["--git-dir", f.canonical, "rev-parse", "refs/heads/task/change1"])).toBe(before);
  } finally { await f.cleanup(); }
});

test("early repository-info failure still destroys allocated compute without inventing a token", async () => {
  const f = await fixture({ infoFails: true });
  try { await expect(runAgentTask(f.env, f.ledger, f.task, "run-one")).rejects.toThrow("Info unavailable"); expect(f.counts()).toEqual({ modelCalls: 0, destroyed: 1, revoked: 0, checkpoints: 0 }); }
  finally { await f.cleanup(); }
});

test("credential-bearing source and cancelled tasks remain protected", async () => {
  const f = await fixture({ secret: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-one")).rejects.toThrow(/credential-bearing/);
    expect(f.order).not.toContain("materialize");
    f.task.status = "cancelled";
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-two")).rejects.toThrow(/no longer available/);
  } finally { await f.cleanup(); }
});

test("a newer contributor branch is never overwritten by reconstruction of an older proposal", async () => {
  const f = await fixture({ lostPush: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-one")).rejects.toThrow();
    const seed = join(f.root, "seed");
    await f.git(["-C", seed, "fetch", "origin", "task/change1"]);
    await f.git(["-C", seed, "checkout", "-B", "advanced", "FETCH_HEAD"]);
    await Bun.write(join(seed, "src/app.ts"), "export const value = 3;\n");
    await f.git(["-C", seed, "commit", "-am", "New contributor work"]);
    await f.git(["-C", seed, "push", "origin", "HEAD:refs/heads/task/change1"]);
    const newer = await f.git(["-C", seed, "rev-parse", "HEAD"]);
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-one")).rejects.toThrow(/advanced this branch/);
    expect(await f.git(["--git-dir", f.canonical, "rev-parse", "refs/heads/task/change1"])).toBe(newer);
    expect(f.counts().modelCalls).toBe(1);
  } finally { await f.cleanup(); }
});

test("a new workflow recovers an exact prior failed push before calling the model", async () => {
  const f = await fixture({ lostCheckpoint: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-one")).rejects.toThrow();
    const prior = f.runs.get("run-one")!;
    prior.phase = "failed"; f.task.agentRunId = "run-one";
    const result = await runAgentTask(f.env, f.ledger, f.task, "run-two");
    expect(result).toEqual({ commit: prior.pushedCommit!, recovered: true });
    expect(f.counts().modelCalls).toBe(1); expect(prior.phase).toBe("failed"); expect(f.task.status).toBe("ready");
  } finally { await f.cleanup(); }
});

test("a failed saved proposal with unknown push is not silently replaced by new model output", async () => {
  const f = await fixture({ lostPush: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-one")).rejects.toThrow();
    const prior = f.runs.get("run-one")!; prior.phase = "failed"; f.task.agentRunId = "run-one";
    const saved = structuredClone(prior.proposal);
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-two")).rejects.toThrow(/without a confirmed push/);
    expect(f.counts().modelCalls).toBe(1); expect(prior.proposal).toEqual(saved);
  } finally { await f.cleanup(); }
});

test("proposal phase saves context then releases compute; a fresh apply phase does not call the model again", async () => {
  const f = await fixture();
  try {
    const base = await f.git(["--git-dir", f.canonical, "rev-parse", "main"]);
    const proposal = await runAgentTask(f.env, f.ledger, f.task, "run-staged", { stopAfterProposal: true });
    expect(proposal).toEqual({ commit: "", proposalId: "run-staged" });
    expect(f.runs.get("run-staged")?.phase).toBe("proposed"); expect(f.runs.get("run-staged")?.proposal?.files["src/app.ts"]).toContain("value = 2");
    expect(f.order).not.toContain("materialize"); expect(f.order).not.toContain("pushed-recorded");
    expect(f.counts()).toEqual({ modelCalls: 1, destroyed: 1, revoked: 1, checkpoints: 0 });
    const applied = await runAgentTask(f.env, f.ledger, f.task, "run-staged");
    expect(applied.commit).toBe(await f.git(["--git-dir", f.canonical, "rev-parse", "refs/heads/task/change1"]));
    expect(f.counts().modelCalls).toBe(1); expect(f.counts().destroyed).toBe(2); expect(f.runs.get("run-staged")?.phase).toBe("checkpointed");
    expect(await f.git(["--git-dir", f.canonical, "rev-parse", "main"])).toBe(base);
  } finally { await f.cleanup(); }
});

test("explicit resume of a failed unknown push reconstructs the original SHA and never calls the model again", async () => {
  const f = await fixture({ lostPush: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-original")).rejects.toThrow();
    const old = f.runs.get("run-original")!; old.phase = "failed"; f.task.agentRunId = "run-original";
    const originalCommit = await f.git(["--git-dir", f.canonical, "rev-parse", "refs/heads/task/change1"]);
    const planned = await runAgentTask(f.env, f.ledger, f.task, "run-resume", { stopAfterProposal: true, resumeFrom: "run-original" });
    expect(planned).toEqual({ commit: "", proposalId: "run-resume" }); expect(f.counts().modelCalls).toBe(1);
    const result = await runAgentTask(f.env, f.ledger, f.task, "run-resume", { resumeFrom: "run-original" });
    expect(result).toEqual({ commit: originalCommit, recovered: true }); expect(f.counts().modelCalls).toBe(1);
    expect(f.runs.get("run-resume")?.proposal?.commitDate).toBe(old.createdAt); expect(old.phase).toBe("failed");
  } finally { await f.cleanup(); }
});

test("explicit resume cannot overwrite a branch advanced after the original unknown push", async () => {
  const f = await fixture({ lostPush: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-original")).rejects.toThrow();
    f.runs.get("run-original")!.phase = "failed"; f.task.agentRunId = "run-original";
    const seed = join(f.root, "seed"); await f.git(["-C", seed, "fetch", "origin", "task/change1"]); await f.git(["-C", seed, "checkout", "-B", "advanced", "FETCH_HEAD"]);
    await Bun.write(join(seed, "src/app.ts"), "export const value = 4;\n"); await f.git(["-C", seed, "commit", "-am", "Later contributor"]); await f.git(["-C", seed, "push", "origin", "HEAD:refs/heads/task/change1"]);
    const newer = await f.git(["-C", seed, "rev-parse", "HEAD"]);
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-resume", { resumeFrom: "run-original" })).rejects.toThrow(/advanced this branch/);
    expect(await f.git(["--git-dir", f.canonical, "rev-parse", "refs/heads/task/change1"])).toBe(newer); expect(f.counts().modelCalls).toBe(1);
  } finally { await f.cleanup(); }
});
