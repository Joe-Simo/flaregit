import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
import type { FlareGitProjectState } from "../src/core/types";
import type { CoordinationView } from "../src/server/coordination-controller";

const FILE = "tests/post-land-revision-retry.test.ts";
const sha = (n: number) => n.toString(16).padStart(40, "0").replace(/^0/, "d");
const LANDED = sha(60);

async function fixture(name: string) {
  const output = `/tmp/flaregit-revision-retry-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, "build", "tests/support/coordination-worker.ts", "--target=browser", "--external=cloudflare:workers", "--external=node:*", `--outfile=${output}`], { stdout: "ignore", stderr: "pipe" });
  let script: string;
  try { if (await build.exited !== 0) throw new Error(await new Response(build.stderr).text()); script = await Bun.file(output).text(); } finally { if (await Bun.file(output).exists()) await Bun.file(output).delete(); }
  const bindings = { MANAGED_ACCOUNT_MONTHLY_USD_MICROS: "100000000", MANAGED_GLOBAL_MONTHLY_USD_MICROS: "100000000", MANAGED_ESSENTIAL_ACCOUNT_MONTHLY_USD_MICROS: "1000000", MANAGED_ESSENTIAL_GLOBAL_MONTHLY_USD_MICROS: "2000000" };
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "coordination", modules: true, script, bindings, compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], durableObjects: { REPOSITORY_CONTROLLER: { className: "CoordinationFixture", useSQLite: true } } }] }));
  const api = await mf.getWorker("coordination");
  const json = async <T>(path: string, value?: unknown): Promise<T> => {
    const response = await api.fetch(`http://test${path}${path.includes("?") ? "&" : "?"}name=${name}`, { method: "POST", ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    const parsed = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(parsed));
    return parsed as T;
  };
  await json("/seed");
  // One change lands; two agent changes no longer apply on top of it and need their agents re-run.
  await json("/task", { id: "lander", commit: sha(1), agent: true });
  await json("/task", { id: "conflicting", commit: sha(4), agent: true });
  await json("/task", { id: "failing", commit: sha(3), agent: true });
  await json("/landing", { tasks: ["lander"], holder: "landing-1" });
  await json("/land", { eventId: "landing-1", newHead: LANDED });
  await json("/plan-rebase", { landed: LANDED, workflowId: "plr-1" });
  const conflict = await json<{ revise: boolean }>("/record-rebase", { taskId: "conflicting", landedCommit: LANDED, fromCommit: sha(4), execution: { kind: "conflict", conflictingFiles: ["src/pricing.ts"], overlappingFiles: ["src/pricing.ts"], landedDiff: "+landed line", previousDiff: "+previous line", reset: true } });
  const failing = await json<{ revise: boolean }>("/record-rebase", { taskId: "failing", landedCommit: LANDED, fromCommit: sha(3), execution: { kind: "updated", newCommit: sha(71), overlappingFiles: [], verification: { status: "failed", failures: [{ testId: "T-GROUP", description: "Group discount", message: "expected 136.00, got 160" }] }, pushed: true } });
  expect([conflict.revise, failing.revise]).toEqual([true, true]);
  return { mf, json };
}

type Sent = { record: { status: string; reason: string; revisionRetry?: { refusal: string; attempts: number; nextAttemptAt: string | null } }; dispatch: { dispatched: boolean; refusal?: string }; created: string[] };
type Route = { status: number; body: string; created: string[] };
const update = async (json: <T>(path: string, value?: unknown) => Promise<T>, taskId: string) => (await json<CoordinationView>("/view")).updates.find((row) => row.taskId === taskId)!;

test("a re-run refused for budget is kept and an owner can send the same re-run again exactly once", async () => {
  if (await workerdChild(FILE, "a re-run refused for budget is kept and an owner can send the same re-run again exactly once")) return;
  const { mf, json } = await fixture("manual");
  try {
    const workflowId = "rev-manual-conflicting";
    const refused = await json<Sent>("/revise-post-land?capacity=none", { taskId: "conflicting", landedCommit: LANDED, workflowId });
    expect(refused.dispatch).toMatchObject({ dispatched: false, refusal: "budget" });
    expect(refused.created).toEqual([]);
    expect(refused.record.status).toBe("agent_waiting");
    expect(refused.record.revisionRetry).toMatchObject({ refusal: "budget", attempts: 1 });
    // The frozen context is kept: the restarted branch, the conflict, the request id and what the agent is told.
    const waiting = await update(json, "conflicting");
    expect(waiting).toMatchObject({ status: "agent_waiting", revisionWorkflowId: workflowId, conflictingFiles: ["src/pricing.ts"], retry: { refusal: "budget", attempts: 1 } });
    expect(waiting.reason).toContain("spending is at its limit");
    expect(waiting.retry?.refusedReason).toContain("free agent allowance is used up");
    expect("revisionContext" in waiting).toBe(false);
    expect((await json<{ alarm: number | null }>("/alarm-at")).alarm).not.toBeNull();
    const state = await json<FlareGitProjectState>("/state");
    expect([state.tasks.conflicting?.baseCommit, state.tasks.conflicting?.currentCommit, state.tasks.conflicting?.status]).toEqual([LANDED, LANDED, "checkpointed"]);

    // People who are not owners are refused and nothing is sent, even with a forged owner claim.
    for (const query of ["actor=member", "actor=member&forge=1"]) {
      const denied = await json<Route>(`/run-agent-again?${query}`, { taskId: "conflicting" });
      expect(denied.status).toBe(403);
      expect(denied.body).toContain("owner");
      expect(denied.created).toEqual([]);
    }
    // While spending is still at its limit the owner is told why, in plain words, and nothing starts.
    const stillFull = await json<Route>("/run-agent-again?capacity=none", { taskId: "conflicting" });
    expect(stillFull.status).toBe(429);
    expect(stillFull.body).toContain("The agent could not be re-run");
    expect(stillFull.body).toContain("free agent allowance is used up");
    expect(stillFull.created).toEqual([]);
    expect((await update(json, "conflicting")).retry?.attempts).toBe(2);

    const sent = await json<Route>("/run-agent-again", { taskId: "conflicting" });
    expect(sent.status).toBe(200);
    expect(JSON.parse(sent.body)).toMatchObject({ dispatched: true, replayed: false, update: { status: "conflict_revising", revisionWorkflowId: workflowId } });
    expect(sent.created).toEqual([workflowId]);
    const running = await json<FlareGitProjectState>("/state");
    expect([running.tasks.conflicting?.status, running.tasks.conflicting?.agentWorkflowInstanceId]).toEqual(["working", workflowId]);
    const resumed = await update(json, "conflicting");
    expect(resumed.reason).toContain("The agent is redoing its change");
    expect(resumed.retry).toBeNull();
    expect((await json<Array<{ body: string }>>("/comments?task=conflicting")).at(-1)?.body).toContain("+landed line");

    // Pressing it again replays the saved result.
    const again = await json<Route>("/run-agent-again", { taskId: "conflicting" });
    expect(again.status).toBe(200);
    expect(JSON.parse(again.body)).toMatchObject({ dispatched: true, replayed: true });
    expect(again.created).toEqual([workflowId]);
  } finally { await mf.dispose(); }
}, 120_000);

test("a refused re-run is sent again automatically once its backoff elapses and capacity has returned", async () => {
  if (await workerdChild(FILE, "a refused re-run is sent again automatically once its backoff elapses and capacity has returned")) return;
  const { mf, json } = await fixture("automatic");
  try {
    const workflowId = "rev-auto-failing";
    expect((await json<Sent>("/revise-post-land?capacity=none", { taskId: "failing", landedCommit: LANDED, workflowId })).record.status).toBe("agent_waiting");
    // Before the backoff elapses nothing is sent, even with room again.
    expect((await json<{ created: string[] }>("/retry-due")).created).toEqual([]);
    // After the backoff, still no capacity: refused again, kept with a longer wait.
    await json("/clock", { advanceMs: 6 * 60_000 });
    const second = await json<{ records: Sent["record"][]; created: string[] }>("/retry-due?capacity=none");
    expect(second.created).toEqual([]);
    expect(second.records.map((row) => [row.status, row.revisionRetry?.attempts])).toEqual([["agent_waiting", 2]]);
    const waitingAt = Date.parse((await update(json, "failing")).retry!.nextAttemptAt!);
    expect(waitingAt - Date.now()).toBeGreaterThan(9 * 60_000);
    // Capacity returned and the longer wait elapsed: sent exactly once.
    await json("/clock", { advanceMs: 7 * 60 * 60_000 });
    const sent = await json<{ records: Sent["record"][]; created: string[] }>("/retry-due");
    expect(sent.created).toEqual([workflowId]);
    expect(sent.records.map((row) => row.status)).toEqual(["verification_failed"]);
    expect((await json<{ created: string[] }>("/retry-due")).created).toEqual([workflowId]);
    const state = await json<FlareGitProjectState>("/state");
    expect([state.tasks.failing?.status, state.tasks.failing?.currentCommit, state.tasks.failing?.agentWorkflowInstanceId]).toEqual(["working", sha(71), workflowId]);
    expect((await update(json, "failing")).reason).toContain("checks fail");
  } finally { await mf.dispose(); }
}, 120_000);
