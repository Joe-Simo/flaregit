import {AgentRuntimeLedger,type AgentNativeAttemptIdentity} from "../src/server/agent-runtime-ledger";
import {AgentCredentialIncidents,type AgentCredentialScope} from "../src/server/agent-credential-incidents";
import { Database } from "bun:sqlite";
import { accountKeyFor } from "../src/server/projects.js";
import { ManagedSpendLedger } from "../src/server/managed-spend-ledger.js";
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgentTask, type AgentExecutionLedger } from "../src/server/agent-run.js";
import type {FrozenAcceptedTarget} from "../src/core/accepted-target";
import type { Task } from "../src/core/types.js";
import type { AgentRunInput, AgentRunRecord } from "../src/server/agent-run-ledger.js";
import type { Env } from "../src/server/env.js";

// Native Git with a deterministic model double and in-memory durable-store double.
// These assertions verify recovery orchestration, not hosted provider execution.
async function fixture(options: { lostPush?: boolean; lostCheckpoint?: boolean; infoFails?: boolean; secret?: boolean; revokeBeforeModel?: "account" | "membership";badTokenScope?:boolean;revokeFails?:boolean;stopFails?:boolean;revokeDuringModel?:"account"|"membership";primaryPolicy?:Record<string,unknown>;changeTargetDuringModel?:boolean;changePolicyDuringModel?:boolean;changeGenerationDuringModel?:boolean } = {}) {
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
  const actorId = "fixture-human", accountKey = await accountKeyFor(actorId);
  let lifecycle: "active" | "deleted" = "active", membership = true,policyVersion=1;
  const db = new Database(":memory:");
  const storage = { sql: { exec(query: string, ...bindings: Array<string | number>) { const rows = db.query(query).all(...bindings); return { toArray: () => rows,one:()=>rows[0] }; } }, transactionSync<T>(callback: () => T): T { return db.transaction(callback)(); } };
  const spend = new ManagedSpendLedger(storage as unknown as DurableObjectStorage),native=new AgentRuntimeLedger(storage as unknown as DurableObjectStorage),credentials=new AgentCredentialIncidents(storage as unknown as DurableObjectStorage),credentialScopes=new Map<string,AgentCredentialScope>();
  const runs = new Map<string, AgentRunRecord>(); let active: string | undefined;
  let modelCalls = 0, destroyed = 0, revoked = 0, checkpoints = 0, lostPush = options.lostPush, lostCheckpoint = options.lostCheckpoint;
  const order: string[] = [],prompts:string[]=[];
  const ledger = {
    beginAgentNativeAttempt:async(input:{workflowId:string;runId:string;taskId:string;phase:"proposal"|"apply";attemptId:string;nativeId:string})=>{if(db.query("SELECT id FROM agent_credential_incidents WHERE status!='revoked' LIMIT 1").get())throw Error("credential cleanup unconfirmed");const identity:AgentNativeAttemptIdentity={...input,projectId:"project1",incarnation:"11111111-1111-4111-8111-111111111111",actorId,accountKey,generation:runs.get(input.runId)?.generation??0,snapshotDigest:"a".repeat(64)};native.begin(identity,()=>{if(!membership||lifecycle!=="active")throw Error("revoked");});return identity;},
    beginAgentCredential:async(attemptId:string,id:string,scope:"read"|"write",expiresAt:number)=>{const attempt=native.get(attemptId)!;const {state:_state,createdAt:_created,stoppedAt:_stopped,...identity}=attempt,context={...identity,repoName:task.workspace.repoName,scope};if(!credentials.begin(id,context,expiresAt,()=>{if(!membership||lifecycle!=="active")throw Error("revoked");}))return null;credentialScopes.set(id,context);return context;},
    recordAgentCredential:async(_attemptId:string,id:string,token:string,expiry:number)=>credentials.record(id,credentialScopes.get(id)!,token,expiry),
    revokeAgentCredential:async(id:string)=>{const pending=credentials.credentialForRevocation(id);if(!pending)return credentials.summary(id)?.status==="revoked";if(options.revokeFails)return false;revoked++;credentials.markAttempt(id);await credentials.markRevoked(id,pending.token);return true;},
    confirmAgentNativeStopped:async(attemptId:string,nativeId:string)=>{const attempt=native.get(attemptId)!;const {state:_state,createdAt:_created,stoppedAt:_stopped,...identity}=attempt;if(options.stopFails)return false;native.confirmStopped(identity,{nativeId,state:"stopped"});return true;},
    getWorkflowRun: async (id: string) => ({ instanceId: id, kind: "agent", actorId }),
    roleOf: async (id: string) => membership && id === actorId ? "owner" : null,
    canGitAccess: async (id: string, taskId: string) => membership && id === actorId && taskId === task.id,
    logActivity: async () => {},
    getState: async () => ({ projectId: "project1",canonicalRepoName:"repo",policyVersion,verificationPolicy:options.primaryPolicy, tasks: { [task.id]: task.targetGeneration?{...task,targetGeneration:{...task.targetGeneration,baseCommit:task.baseCommit,currentCommit:task.currentCommit}}:task } }), listComments: async () => [{ id: 1, author: "Maintainer", body: "Preserve customer behavior" }],
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
    MANAGED_ACCOUNT_MONTHLY_USD_MICROS: "5000000", MANAGED_GLOBAL_MONTHLY_USD_MICROS: "10000000",
    REPOSITORY_CONTROLLER: { idFromName: (name: string) => name, get: (name: string) => name === "global" ? {
      reserveManagedSpend: async (input: Parameters<ManagedSpendLedger["reserve"]>[0], budget: Parameters<ManagedSpendLedger["reserve"]>[1]) => spend.reserve(input, budget),
      consumeManagedSpend: async (...args: Parameters<ManagedSpendLedger["consume"]>) => spend.consume(...args),
    } : { accountLifecycle: async () => lifecycle } },
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
        readFile: async (file: string) => {
          if (options.revokeBeforeModel === "account") lifecycle = "deleted";
          if (options.revokeBeforeModel === "membership") membership = false;
          return Bun.file(file.replaceAll("/workspace/task", work)).text();
        },
        writeFile: async (file: string, content: string) => { order.push("materialize"); await Bun.write(file.replaceAll("/workspace/task", work), content); },
        destroy: async () => { destroyed++; await rm(work, { recursive: true, force: true }); },
      };
    } },
    ARTIFACTS: { get: async () => ({ info: async () => { if (options.infoFails) throw new Error("Info unavailable"); return { remote: canonical }; }, createToken: async (scope:"read"|"write",ttl:number) => ({ plaintext: "fixture-token",scope:options.badTokenScope?"admin":scope,expiresAt:new Date(Date.now()+ttl*1000).toISOString() }), revokeToken: async () => { revoked++; return true; }, [Symbol.dispose]: () => {} }) },
    AI: { run: async (_model:string,input:{messages?:Array<{content:string}>}) => { prompts.push(...(input.messages??[]).map(message=>message.content));if(options.changePolicyDuringModel)policyVersion++;if(options.changeGenerationDuringModel&&task.targetGeneration)Object.assign(task,{targetGeneration:{...task.targetGeneration,eventId:crypto.randomUUID(),generation:task.targetGeneration.generation+1}});if(options.changeTargetDuringModel&&task.acceptedTarget)Object.assign(task,{acceptedTarget:{...task.acceptedTarget,acceptedCommit:"f".repeat(40)}});modelCalls++;if(options.revokeDuringModel==="account")lifecycle="deleted";if(options.revokeDuringModel==="membership")membership=false; return { response: '<file path="src/app.ts">\nexport const value = 2;\n</file>' }; } },
  } as unknown as Env;
  return { env, ledger, task, runs, order, prompts,git, canonical, root, funding: { accountKey, parentWorkflowId: "registered-parent" }, deleteAccount: () => { lifecycle = "deleted"; }, revokeMembership: () => { membership = false; }, native,credentials, counts: () => ({ modelCalls, destroyed, revoked, checkpoints }), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test.each(["lostPush", "lostCheckpoint"] as const)("%s retry recovers the same pushed commit and persisted context without regenerating", async (failure) => {
  const f = await fixture({ [failure]: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-one", f.funding)).rejects.toThrow(/lost/);
    const pushed = await f.git(["--git-dir", f.canonical, "rev-parse", "refs/heads/task/change1"]);
    const resumed = await runAgentTask(f.env, f.ledger, f.task, "run-one", f.funding);
    expect(resumed.commit).toBe(pushed); expect(f.counts().modelCalls).toBe(1);
    expect(f.runs.get("run-one")?.phase).toBe("checkpointed");
    expect(f.runs.get("run-one")?.context.comments[0]?.summary).toContain("Preserve customer behavior");
    expect(f.order.indexOf("proposal-saved")).toBeLessThan(f.order.indexOf("materialize"));
    expect(f.order.indexOf("pushed-recorded")).toBeLessThan(f.order.indexOf("checkpoint"));
    expect((await runAgentTask(f.env, f.ledger, f.task, "run-one", f.funding)).commit).toBe(pushed);
    expect(f.counts().destroyed).toBe(2); expect(f.counts().revoked).toBe(2);
  } finally { await f.cleanup(); }
});

test("another durable generation cannot produce a model call or overwrite a live run", async () => {
  const f = await fixture({ lostPush: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-one", f.funding)).rejects.toThrow();
    const before = await f.git(["--git-dir", f.canonical, "rev-parse", "refs/heads/task/change1"]);
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-two", f.funding)).rejects.toThrow(/generation owns/);
    expect(f.counts().modelCalls).toBe(1);
    expect(await f.git(["--git-dir", f.canonical, "rev-parse", "refs/heads/task/change1"])).toBe(before);
  } finally { await f.cleanup(); }
});

test("early repository-info failure still destroys allocated compute without inventing a token", async () => {
  const f = await fixture({ infoFails: true });
  try { await expect(runAgentTask(f.env, f.ledger, f.task, "run-one", f.funding)).rejects.toThrow("Info unavailable"); expect(f.counts()).toEqual({ modelCalls: 0, destroyed: 1, revoked: 0, checkpoints: 0 }); }
  finally { await f.cleanup(); }
});

test("credential-bearing source and cancelled tasks remain protected", async () => {
  const f = await fixture({ secret: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-one", f.funding)).rejects.toThrow(/credential-bearing/);
    expect(f.order).not.toContain("materialize");
    f.task.status = "cancelled";
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-two", f.funding)).rejects.toThrow(/no longer available/);
  } finally { await f.cleanup(); }
});

test("a newer contributor branch is never overwritten by reconstruction of an older proposal", async () => {
  const f = await fixture({ lostPush: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-one", f.funding)).rejects.toThrow();
    const seed = join(f.root, "seed");
    await f.git(["-C", seed, "fetch", "origin", "task/change1"]);
    await f.git(["-C", seed, "checkout", "-B", "advanced", "FETCH_HEAD"]);
    await Bun.write(join(seed, "src/app.ts"), "export const value = 3;\n");
    await f.git(["-C", seed, "commit", "-am", "New contributor work"]);
    await f.git(["-C", seed, "push", "origin", "HEAD:refs/heads/task/change1"]);
    const newer = await f.git(["-C", seed, "rev-parse", "HEAD"]);
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-one", f.funding)).rejects.toThrow(/advanced this branch/);
    expect(await f.git(["--git-dir", f.canonical, "rev-parse", "refs/heads/task/change1"])).toBe(newer);
    expect(f.counts().modelCalls).toBe(1);
  } finally { await f.cleanup(); }
});

test("a new workflow recovers an exact prior failed push before calling the model", async () => {
  const f = await fixture({ lostCheckpoint: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-one", f.funding)).rejects.toThrow();
    const prior = f.runs.get("run-one")!;
    prior.phase = "failed"; f.task.agentRunId = "run-one";
    const result = await runAgentTask(f.env, f.ledger, f.task, "run-two", f.funding);
    expect(result).toEqual({ commit: prior.pushedCommit!, recovered: true });
    expect(f.counts().modelCalls).toBe(1); expect(prior.phase).toBe("failed"); expect(f.task.status).toBe("ready");
  } finally { await f.cleanup(); }
});

test("a failed saved proposal with unknown push is not silently replaced by new model output", async () => {
  const f = await fixture({ lostPush: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-one", f.funding)).rejects.toThrow();
    const prior = f.runs.get("run-one")!; prior.phase = "failed"; f.task.agentRunId = "run-one";
    const saved = structuredClone(prior.proposal);
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-two", f.funding)).rejects.toThrow(/without a confirmed push/);
    expect(f.counts().modelCalls).toBe(1); expect(prior.proposal).toEqual(saved);
  } finally { await f.cleanup(); }
});

test("proposal phase saves context then releases compute; a fresh apply phase does not call the model again", async () => {
  const f = await fixture();
  try {
    const base = await f.git(["--git-dir", f.canonical, "rev-parse", "main"]);
    const proposal = await runAgentTask(f.env, f.ledger, f.task, "run-staged", { ...f.funding, stopAfterProposal: true });
    expect(proposal).toEqual({ commit: "", proposalId: "run-staged" });
    expect(f.runs.get("run-staged")?.phase).toBe("proposed"); expect(f.runs.get("run-staged")?.proposal?.files["src/app.ts"]).toContain("value = 2");
    expect(f.order).not.toContain("materialize"); expect(f.order).not.toContain("pushed-recorded");
    expect(f.counts()).toEqual({ modelCalls: 1, destroyed: 1, revoked: 1, checkpoints: 0 });
    const applied = await runAgentTask(f.env, f.ledger, f.task, "run-staged", f.funding);
    expect(applied.commit).toBe(await f.git(["--git-dir", f.canonical, "rev-parse", "refs/heads/task/change1"]));
    expect(f.counts().modelCalls).toBe(1); expect(f.counts().destroyed).toBe(2); expect(f.runs.get("run-staged")?.phase).toBe("checkpointed");
    expect(await f.git(["--git-dir", f.canonical, "rev-parse", "main"])).toBe(base);
  } finally { await f.cleanup(); }
});

test("explicit resume of a failed unknown push reconstructs the original SHA and never calls the model again", async () => {
  const f = await fixture({ lostPush: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-original", f.funding)).rejects.toThrow();
    const old = f.runs.get("run-original")!; old.phase = "failed"; f.task.agentRunId = "run-original";
    const originalCommit = await f.git(["--git-dir", f.canonical, "rev-parse", "refs/heads/task/change1"]);
    const planned = await runAgentTask(f.env, f.ledger, f.task, "run-resume", { ...f.funding, stopAfterProposal: true, resumeFrom: "run-original" });
    expect(planned).toEqual({ commit: "", proposalId: "run-resume" }); expect(f.counts().modelCalls).toBe(1);
    const result = await runAgentTask(f.env, f.ledger, f.task, "run-resume", { ...f.funding, resumeFrom: "run-original" });
    expect(result).toEqual({ commit: originalCommit, recovered: true }); expect(f.counts().modelCalls).toBe(1);
    expect(f.runs.get("run-resume")?.proposal?.commitDate).toBe(old.createdAt); expect(old.phase).toBe("failed");
  } finally { await f.cleanup(); }
});

test("explicit resume cannot overwrite a branch advanced after the original unknown push", async () => {
  const f = await fixture({ lostPush: true });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-original", f.funding)).rejects.toThrow();
    f.runs.get("run-original")!.phase = "failed"; f.task.agentRunId = "run-original";
    const seed = join(f.root, "seed"); await f.git(["-C", seed, "fetch", "origin", "task/change1"]); await f.git(["-C", seed, "checkout", "-B", "advanced", "FETCH_HEAD"]);
    await Bun.write(join(seed, "src/app.ts"), "export const value = 4;\n"); await f.git(["-C", seed, "commit", "-am", "Later contributor"]); await f.git(["-C", seed, "push", "origin", "HEAD:refs/heads/task/change1"]);
    const newer = await f.git(["-C", seed, "rev-parse", "HEAD"]);
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-resume", { ...f.funding, resumeFrom: "run-original" })).rejects.toThrow(/advanced this branch/);
    expect(await f.git(["--git-dir", f.canonical, "rev-parse", "refs/heads/task/change1"])).toBe(newer); expect(f.counts().modelCalls).toBe(1);
  } finally { await f.cleanup(); }
});

test.each(["account", "membership"] as const)("%s revocation after funded container admission denies the actual model request", async (kind) => {
  const f = await fixture({ revokeBeforeModel: kind });
  try {
    await expect(runAgentTask(f.env, f.ledger, f.task, "run-revoked", f.funding)).rejects.toThrow("revoked");
    expect(f.counts().modelCalls).toBe(0);
    expect(f.counts().destroyed).toBe(1);
    expect(f.runs.get("run-revoked")?.proposal).toBeUndefined();
  } finally { await f.cleanup(); }
});

test.each(["account","membership"] as const)("checkpointed replay revalidates %s before returning saved success",async(kind)=>{
 const f=await fixture();try{const first=await runAgentTask(f.env,f.ledger,f.task,"run-checkpointed",f.funding);expect(f.runs.get("run-checkpointed")?.phase).toBe("checkpointed");const saved=structuredClone(f.runs.get("run-checkpointed")),counts=f.counts();expect(await runAgentTask(f.env,f.ledger,f.task,"run-checkpointed",f.funding)).toEqual(first);expect(f.counts()).toEqual(counts);if(kind==="account")f.deleteAccount();else f.revokeMembership();await expect(runAgentTask(f.env,f.ledger,f.task,"run-checkpointed",f.funding)).rejects.toThrow("revoked");expect(f.runs.get("run-checkpointed")).toEqual(saved);expect(f.counts()).toEqual(counts);expect(f.task.currentCommit).toBe(first.commit);}finally{await f.cleanup();}
});

test("native attempt and token receipts precede use; wrong provider scope refuses model and revokes exact receipt",async()=>{const f=await fixture({badTokenScope:true});try{await expect(runAgentTask(f.env,f.ledger,f.task,"bad-token",f.funding)).rejects.toThrow("scope or expiry");expect(f.counts().modelCalls).toBe(0);expect(f.counts().revoked).toBe(1);expect(f.native.hasUnconfirmed()).toBe(false);expect(f.credentials.pendingBatch()).toHaveLength(0);}finally{await f.cleanup();}});
test.each(["credential","native"] as const)("unconfirmed %s cleanup preserves durable hold and refuses replacement compute",async(kind)=>{const f=await fixture({revokeFails:kind==="credential",stopFails:kind==="native"});try{await runAgentTask(f.env,f.ledger,f.task,"held-run",{...f.funding,stopAfterProposal:true});const before=f.counts();await expect(runAgentTask(f.env,f.ledger,f.task,"held-run",f.funding)).rejects.toThrow(/unconfirmed/);expect(f.counts()).toEqual(before);expect(f.runs.get("held-run")?.proposal).toBeDefined();if(kind==="native")expect(f.native.hasUnconfirmed()).toBe(true);else expect(f.credentials.pendingBatch()).toHaveLength(1);}finally{await f.cleanup();}});

test.each(["account","membership"] as const)("%s withdrawn while model runs refuses persistence and Git publication",async(kind)=>{const f=await fixture({revokeDuringModel:kind});try{await expect(runAgentTask(f.env,f.ledger,f.task,"mid-model",f.funding)).rejects.toThrow("revoked");expect(f.counts().modelCalls).toBe(1);expect(f.order).not.toContain("proposal-saved");expect(f.order).not.toContain("materialize");expect(f.runs.get("mid-model")?.proposal).toBeUndefined();expect(f.counts().checkpoints).toBe(0);expect(await f.git(["--git-dir",f.canonical,"for-each-ref","--format=%(refname)"])).toBe("refs/heads/main");expect(f.counts().revoked).toBe(1);expect(f.native.hasUnconfirmed()).toBe(false);}finally{await f.cleanup();}});

function targetFor(task:Task):FrozenAcceptedTarget{return{projectId:"project1",incarnation:"11111111-1111-4111-8111-111111111111",canonicalRepoName:"repo",ref:"refs/heads/release",branch:"release",acceptedCommit:task.baseCommit,acceptedVersion:1,policyVersion:2,policy:{kind:"command",test:"bun test selected-root",allowedScope:["src/"],protectedPaths:["target-protected/"]},requirements:[{id:"accepted-target-behavior",title:"Keep selected behavior",description:"Preserve selected root behavior",version:1,status:"approved",assertions:[],originTaskId:"accepted",approvedAt:"now"}]};}
test("bound agent uses frozen selected policy and accepted behavior, preserves target through saved proposal interruption",async()=>{
 const f=await fixture({primaryPolicy:{kind:"command",test:"false primary-root-check",protectedPaths:["src/app.ts"]}});
 try{const target=targetFor(f.task);Object.assign(f.task,{acceptedTarget:target});const seed=join(f.root,"seed");await Bun.write(join(seed,"src/app.ts"),"export const value = 9;\n");await f.git(["-C",seed,"commit","-am","primary advanced"]);await f.git(["-C",seed,"push","origin","main"]);const primaryHead=await f.git(["--git-dir",f.canonical,"rev-parse","main"]);const proposed=await runAgentTask(f.env,f.ledger,f.task,"bound-run",{...f.funding,stopAfterProposal:true});expect(proposed.proposalId).toBe("bound-run");const prompt=f.prompts.join("\n");expect(prompt).toContain("bun test selected-root");expect(prompt).not.toContain("primary-root-check");expect(prompt).toContain("Existing accepted behavior on refs/heads/release");expect(prompt).toContain("Preserve selected root behavior");expect(prompt).toContain("export const value = 1;");expect(prompt).not.toContain("export const value = 9;");expect(f.runs.get("bound-run")?.acceptedTarget).toEqual(target);const saved=f.runs.get("bound-run")!;const resumed=await runAgentTask(f.env,f.ledger,f.task,"bound-run",f.funding);expect(resumed.commit).toBe(saved.pushedCommit!);expect(f.counts().modelCalls).toBe(1);expect(await f.git(["--git-dir",f.canonical,"rev-parse","task/change1"])).toBe(resumed.commit);expect(f.runs.get("bound-run")?.startingCommit).toBe(target.acceptedCommit);expect(await f.git(["--git-dir",f.canonical,"rev-parse","main"])).toBe(primaryHead);}
 finally{await f.cleanup();}
},20000);
test("bound agent refuses changed target after model await without saving proposal or pushing",async()=>{
 const f=await fixture({changeTargetDuringModel:true});try{Object.assign(f.task,{acceptedTarget:targetFor(f.task)});await expect(runAgentTask(f.env,f.ledger,f.task,"bound-run",f.funding)).rejects.toThrow(/target|batch/);expect(f.runs.get("bound-run")?.proposal).toBeUndefined();expect(f.counts().checkpoints).toBe(0);expect(await f.git(["--git-dir",f.canonical,"rev-parse","main"])).toBe(f.task.baseCommit);}
 finally{await f.cleanup();}
},20000);
test("unbound agent keeps legacy project policy without acquiring a target snapshot",async()=>{
 const f=await fixture({primaryPolicy:{kind:"command",test:"bun test legacy",protectedPaths:["legacy-protected/"]}});try{await runAgentTask(f.env,f.ledger,f.task,"legacy-run",{...f.funding,stopAfterProposal:true});expect(f.prompts.join("\n")).toContain("bun test legacy");expect(f.prompts.join("\n")).not.toContain("Existing accepted behavior on");expect(f.runs.get("legacy-run")?.acceptedTarget).toBeUndefined();}finally{await f.cleanup();}
},20000);

test("bound agent aborts repository policy tightening during model execution",async()=>{
 const f=await fixture({changePolicyDuringModel:true});try{Object.assign(f.task,{acceptedTarget:targetFor(f.task)});await expect(runAgentTask(f.env,f.ledger,f.task,"bound-run",f.funding)).rejects.toThrow("policy changed");expect(f.runs.get("bound-run")?.proposal).toBeUndefined();expect(f.counts().checkpoints).toBe(0);}finally{await f.cleanup();}
},20000);
test("accepted parent keeps its old frozen target while a bound child uses current target policy",async()=>{
 const f=await fixture();try{const target=targetFor(f.task),parent:Task={...structuredClone(f.task),id:"parent",status:"accepted",acceptedTarget:{...target,acceptedCommit:"c".repeat(40),acceptedVersion:0,policyVersion:0,requirements:[]}};const original=f.ledger.getState.bind(f.ledger);f.ledger.getState=async()=>{const state=await original();return{...state,tasks:{...state.tasks,parent}};};Object.assign(f.task,{dependsOn:"parent",acceptedTarget:target});await runAgentTask(f.env,f.ledger,f.task,"child-run",{...f.funding,stopAfterProposal:true});expect(f.runs.get("child-run")?.acceptedTarget).toEqual(target);expect(f.prompts.join("\n")).toContain("bun test selected-root");expect(parent.acceptedTarget?.acceptedCommit).toBe("c".repeat(40));}finally{await f.cleanup();}
},20000);

test("agent uses server-projected active target generation and freezes its identity without changing creation binding",async()=>{
 const f=await fixture({primaryPolicy:{kind:"command",test:"false primary",protectedPaths:["src/app.ts"]}});try{const original={...targetFor(f.task),policyVersion:1,policy:{kind:"command",test:"false creation-policy",protectedPaths:["src/app.ts"]}},active=targetFor(f.task),eventId=crypto.randomUUID();Object.assign(f.task,{acceptedTarget:original,targetGeneration:{eventId,generation:1,acceptedTarget:active,baseCommit:f.task.baseCommit,currentCommit:f.task.currentCommit}});await runAgentTask(f.env,f.ledger,f.task,"generation-run",{...f.funding,stopAfterProposal:true});expect(f.prompts.join("\n")).toContain("bun test selected-root");expect(f.prompts.join("\n")).not.toContain("creation-policy");expect(f.runs.get("generation-run")?.targetGeneration).toEqual({eventId,generation:1});expect(f.runs.get("generation-run")?.acceptedTarget).toEqual(active);expect(f.task.acceptedTarget).toEqual(original);await runAgentTask(f.env,f.ledger,f.task,"generation-run",f.funding);expect(f.counts().modelCalls).toBe(1);expect(f.task.acceptedTarget).toEqual(original);}finally{await f.cleanup();}
},20000);
test("old saved proposal cannot apply after a new explicit generation even when accepted policy and Git base match",async()=>{
 const f=await fixture();try{const target=targetFor(f.task);Object.assign(f.task,{acceptedTarget:target,targetGeneration:{eventId:crypto.randomUUID(),generation:1,acceptedTarget:target,baseCommit:f.task.baseCommit,currentCommit:f.task.currentCommit}});await runAgentTask(f.env,f.ledger,f.task,"generation-run",{...f.funding,stopAfterProposal:true});Object.assign(f.task,{targetGeneration:{...f.task.targetGeneration!,eventId:crypto.randomUUID(),generation:2}});await expect(runAgentTask(f.env,f.ledger,f.task,"generation-run",f.funding)).rejects.toThrow("generation changed");expect(f.counts().checkpoints).toBe(0);expect(f.counts().modelCalls).toBe(1);}finally{await f.cleanup();}
},20000);
test("generation changes while model runs reject its proposal before persistence or Git publication",async()=>{
 const f=await fixture({changeGenerationDuringModel:true});try{const target=targetFor(f.task);Object.assign(f.task,{acceptedTarget:target,targetGeneration:{eventId:crypto.randomUUID(),generation:1,acceptedTarget:target,baseCommit:f.task.baseCommit,currentCommit:f.task.currentCommit}});await expect(runAgentTask(f.env,f.ledger,f.task,"generation-run",f.funding)).rejects.toThrow("generation changed");expect(f.runs.get("generation-run")?.proposal).toBeUndefined();expect(f.counts().checkpoints).toBe(0);}finally{await f.cleanup();}
},20000);
