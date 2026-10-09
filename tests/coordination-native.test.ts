import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
import type { FlareGitProjectState, ProductDecision } from "../src/core/types";
import type { CoordinationView } from "../src/server/coordination-controller";
import type { QueueAction } from "../src/server/merge-queue-runner";
import type { RequirementRevision } from "../src/server/requirement-decisions";

const FILE = "tests/coordination-native.test.ts";
const HEAD = "a".repeat(40);
const sha = (n: number) => n.toString(16).padStart(40, "0").replace(/^0/, "d");

async function fixture(name: string) {
  const output = `/tmp/flaregit-coordination-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, "build", "tests/support/coordination-worker.ts", "--target=browser", "--external=cloudflare:workers", "--external=node:*", `--outfile=${output}`], { stdout: "ignore", stderr: "pipe" });
  let script: string;
  try { if (await build.exited !== 0) throw new Error(await new Response(build.stderr).text()); script = await Bun.file(output).text(); } finally { if (await Bun.file(output).exists()) await Bun.file(output).delete(); }
  const bindings = { MANAGED_ACCOUNT_MONTHLY_USD_MICROS: "100000000", MANAGED_GLOBAL_MONTHLY_USD_MICROS: "100000000", MANAGED_ESSENTIAL_ACCOUNT_MONTHLY_USD_MICROS: "1000000", MANAGED_ESSENTIAL_GLOBAL_MONTHLY_USD_MICROS: "2000000" };
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "coordination", modules: true, script, bindings, compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], durableObjects: { REPOSITORY_CONTROLLER: { className: "CoordinationFixture", useSQLite: true } } }] }));
  const api = await mf.getWorker("coordination");
  const call = (path: string, value?: unknown) => api.fetch(`http://test${path}${path.includes("?") ? "&" : "?"}name=${name}`, { method: "POST", ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const json = async <T>(path: string, value?: unknown): Promise<T> => { const response = await call(path, value); const parsed = await response.json(); if (!response.ok) throw new Error(JSON.stringify(parsed)); return parsed as T; };
  await json("/seed");
  return { mf, call, json };
}

test("a requirement contradiction is proven by running both changes and only the owner can choose", async () => {
  if (await workerdChild(FILE, "a requirement contradiction is proven by running both changes and only the owner can choose")) return;
  const { mf, call, json } = await fixture("proof");
  try {
    await json("/task", { id: "discount-all", commit: "b".repeat(40), agent: true, act3: 0 });
    await json("/task", { id: "fee-fixed", commit: "c".repeat(40), agent: true, act3: 1 });
    const { decision } = await json<{ decision: ProductDecision }>("/landing", { tasks: ["discount-all", "fee-fixed"], holder: "integration-proof" });
    expect(decision.status).toBe("pending");
    const proved = await json<{ result: { verdict: string; summary: string }; probes: number }>("/prove", { decisionId: decision.id });
    expect(proved.probes).toBe(2);
    expect(proved.result.verdict).toBe("proven");
    // Replay is idempotent: the saved proof is returned without running code again.
    expect((await json<{ probes: number }>("/prove", { decisionId: decision.id })).probes).toBe(0);
    const view = await json<CoordinationView>("/view?actor=member");
    const proof = view.decisions.find((row) => row.decisionId === decision.id)?.proof;
    expect(proof?.sides.map((side) => [side.taskId, side.actual, side.meetsOwnRequirement, side.meetsOtherRequirement])).toEqual([["discount-all", { total: 153 }, true, false], ["fee-fixed", { total: 156 }, true, false]]);
    expect(proof?.input).toEqual({ ticketCount: 4, basePrice: 40, isRefundable: true });
    // A non-maintainer cannot choose; nothing about the decision changes.
    const before = await json<FlareGitProjectState>("/state");
    const refused = await call("/resolve", { decisionId: decision.id, optionId: "REQ-DISCOUNT-INCLUDES-REFUND-FEE", actor: "member" });
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(await refused.json())).toContain("owner authority");
    const after = await json<FlareGitProjectState>("/state");
    expect(after.decisions[decision.id]).toEqual(before.decisions[decision.id]!);
    expect(after.tasks["fee-fixed"]?.status).toBe("needs_decision");
    const resolved = await json<{ taskIds: string[] }>("/resolve", { decisionId: decision.id, optionId: "REQ-DISCOUNT-INCLUDES-REFUND-FEE", actor: "owner" });
    expect(resolved.taskIds.sort()).toEqual(["discount-all", "fee-fixed"]);
    const final = await json<FlareGitProjectState>("/state");
    expect(final.decisions[decision.id]?.resolvedBy?.userId).toBe("owner");
    expect(final.tasks["fee-fixed"]?.requirements.find((requirement) => requirement.id === "REQ-REFUND-FEE-NEVER-DISCOUNTED")?.status).toBe("superseded");
  } finally { await mf.dispose(); }
}, 120_000);

test("the losing agent change is re-run once with the winning requirement as context", async () => {
  if (await workerdChild(FILE, "the losing agent change is re-run once with the winning requirement as context")) return;
  const { mf, json } = await fixture("revise");
  try {
    await json("/task", { id: "discount-all", commit: "b".repeat(40), agent: true, act3: 0 });
    await json("/task", { id: "fee-fixed", commit: "c".repeat(40), agent: true, act3: 1 });
    const { decision } = await json<{ decision: ProductDecision }>("/landing", { tasks: ["discount-all", "fee-fixed"], holder: "integration-revise" });
    await json("/resolve", { decisionId: decision.id, optionId: "REQ-DISCOUNT-INCLUDES-REFUND-FEE", actor: "owner" });
    const first = await json<{ results: RequirementRevision[]; created: Array<[string, { taskId: string; projectId: string }]> }>("/dispatch-revisions", { decisionId: decision.id });
    expect(first.results.map((row) => [row.taskId, row.status])).toEqual([["fee-fixed", "dispatched"]]);
    expect(first.created).toHaveLength(1);
    expect(first.created[0]![0]).toBe(first.results[0]!.workflowId);
    expect(first.created[0]![1].taskId).toBe("fee-fixed");
    const state = await json<FlareGitProjectState>("/state");
    const loser = state.tasks["fee-fixed"]!;
    expect(loser.status).toBe("working");
    expect(loser.agentWorkflowInstanceId).toBe(first.results[0]!.workflowId);
    expect(loser.requirements.map((requirement) => [requirement.id, requirement.status])).toEqual([["REQ-REFUND-FEE-NEVER-DISCOUNTED", "superseded"], ["REQ-DISCOUNT-INCLUDES-REFUND-FEE", "approved"]]);
    expect(state.tasks["discount-all"]?.status).toBe("ready");
    const again = await json<{ results: RequirementRevision[]; created: unknown[] }>("/dispatch-revisions", { decisionId: decision.id });
    expect(again.created).toHaveLength(1);
    expect(again.results[0]!.status).toBe("dispatched");
  } finally { await mf.dispose(); }
}, 120_000);

test("three ready changes land in queue order, one at a time, each on the latest version", async () => {
  if (await workerdChild(FILE, "three ready changes land in queue order, one at a time, each on the latest version")) return;
  const { mf, call, json } = await fixture("queue");
  try {
    for (const [index, id] of ["first", "second", "third"].entries()) await json("/task", { id, commit: sha(index + 1), agent: true });
    await json("/enqueue", { requestId: "queue-request-1", taskIds: ["first", "second", "third"] });
    // Replaying the same request id returns the saved result; reusing it for other changes is refused.
    expect((await json<{ replayed: boolean }>("/enqueue", { requestId: "queue-request-1", taskIds: ["first", "second", "third"] })).replayed).toBe(true);
    expect((await call("/enqueue", { requestId: "queue-request-1", taskIds: ["third"] })).ok).toBe(false);
    const landed: string[] = [];
    let head = HEAD;
    for (let round = 0; round < 3; round++) {
      let action = await json<QueueAction>("/advance");
      if (action.kind === "rebase") {
        // The queue refuses a change built on an older version; it is updated (post-land rebase) and re-queued.
        const view = await json<CoordinationView>("/view");
        const waitingId = action.taskId;
        const waiting = view.queue.find((entry) => entry.taskId === waitingId);
        expect(waiting?.status).toBe("waiting_rebase");
        expect(waiting?.reason).toContain("base changed");
        const items = await json<Array<{ taskId: string; fromCommit: string }>>("/plan-rebase", { landed: head, workflowId: `plr-${round}` });
        for (const item of items) await json("/record-rebase", { taskId: item.taskId, landedCommit: head, fromCommit: item.fromCommit, execution: { kind: "updated", newCommit: sha(100 + round * 10 + items.indexOf(item)), overlappingFiles: [], verification: { status: "passed", failures: [] }, pushed: true } });
        action = await json<QueueAction>("/advance");
      }
      if (action.kind !== "land") throw new Error(`Expected a landing, got ${JSON.stringify(action)}`);
      expect(action.taskIds).toHaveLength(1);
      // While one change lands, advancing again only re-issues that same landing.
      expect(await json<QueueAction>("/advance")).toEqual(action);
      const state = await json<FlareGitProjectState>("/state");
      expect(state.tasks[action.taskIds[0]!]?.baseCommit).toBe(head);
      await json("/landing", { tasks: action.taskIds, holder: action.eventId });
      head = sha(200 + round);
      await json("/land", { eventId: action.eventId, newHead: head });
      await json("/settle", { eventId: action.eventId, outcome: "accepted" });
      landed.push(action.taskIds[0]!);
    }
    expect(landed).toEqual(["first", "second", "third"]);
    const final = await json<FlareGitProjectState>("/state");
    expect(final.acceptedState.history.map((record) => record.participatingTasks[0])).toEqual(["first", "second", "third"]);
    expect((await json<CoordinationView>("/view")).queue.map((entry) => entry.status)).toEqual(["landed", "landed", "landed"]);
    expect((await json<QueueAction>("/advance")).kind).toBe("idle");
  } finally { await mf.dispose(); }
}, 180_000);

test("a stale landing is refused with a reason and re-queued after its update", async () => {
  if (await workerdChild(FILE, "a stale landing is refused with a reason and re-queued after its update")) return;
  const { mf, json } = await fixture("stale");
  try {
    await json("/task", { id: "late", commit: sha(1), agent: true });
    await json("/enqueue", { requestId: "queue-request-stale", taskIds: ["late"] });
    const action = await json<QueueAction>("/advance");
    if (action.kind !== "land") throw new Error("Expected a landing");
    // The accepted version moved while it was landing (another path published first): publication refuses it.
    await json("/settle", { eventId: action.eventId, outcome: "stale", reason: "Accepted history advanced before publication" });
    await json("/task", { id: "other", commit: sha(2), agent: true });
    await json("/landing", { tasks: ["other"], holder: "direct-landing" });
    await json("/land", { eventId: "direct-landing", newHead: sha(50) });
    let view = await json<CoordinationView>("/view");
    expect(view.queue[0]).toMatchObject({ taskId: "late", status: "waiting_rebase", reason: "Refused: Accepted history advanced before publication. Updating onto the latest version." });
    const rebase = await json<QueueAction>("/advance");
    expect(rebase).toMatchObject({ kind: "rebase", taskId: "late", landedCommit: sha(50) });
    const [item] = await json<Array<{ taskId: string; fromCommit: string }>>("/plan-rebase", { landed: sha(50), workflowId: "plr-stale" });
    expect(item?.taskId).toBe("late");
    await json("/record-rebase", { taskId: "late", landedCommit: sha(50), fromCommit: sha(1), execution: { kind: "updated", newCommit: sha(51), overlappingFiles: ["src/pricing.ts"], verification: { status: "passed", failures: [] }, pushed: true } });
    const relanded = await json<QueueAction>("/advance");
    expect(relanded).toMatchObject({ kind: "land", taskIds: ["late"] });
    view = await json<CoordinationView>("/view");
    expect(view.queue[0]?.status).toBe("landing");
    expect(view.updates[0]).toMatchObject({ taskId: "late", status: "updated", overlappingFiles: ["src/pricing.ts"] });
  } finally { await mf.dispose(); }
}, 120_000);

test("after a landing, other changes are updated and re-checked; failures and conflicts go back to the agent", async () => {
  if (await workerdChild(FILE, "after a landing, other changes are updated and re-checked; failures and conflicts go back to the agent")) return;
  const { mf, json } = await fixture("post-land");
  try {
    await json("/task", { id: "lander", commit: sha(1), agent: true });
    await json("/task", { id: "clean", commit: sha(2), agent: true });
    await json("/task", { id: "failing", commit: sha(3), agent: true });
    await json("/task", { id: "conflicting", commit: sha(4), agent: true });
    await json("/task", { id: "human", commit: sha(5) });
    await json("/landing", { tasks: ["lander"], holder: "landing-1" });
    await json("/land", { eventId: "landing-1", newHead: sha(60) });
    const items = await json<Array<{ taskId: string; fromCommit: string; agent: boolean; status: string }>>("/plan-rebase", { landed: sha(60), workflowId: "plr-1" });
    expect(items.map((row) => [row.taskId, row.agent, row.status]).sort()).toEqual([["clean", true, "pending"], ["conflicting", true, "pending"], ["failing", true, "pending"], ["human", false, "pending"]]);
    const record = (taskId: string, fromCommit: string, execution: unknown) => json<{ record: { status: string; reason: string }; revise: boolean }>("/record-rebase", { taskId, landedCommit: sha(60), fromCommit, execution });
    const clean = await record("clean", sha(2), { kind: "updated", newCommit: sha(70), overlappingFiles: [], verification: { status: "passed", failures: [] }, pushed: true });
    expect(clean).toMatchObject({ revise: false, record: { status: "updated" } });
    const failing = await record("failing", sha(3), { kind: "updated", newCommit: sha(71), overlappingFiles: [], verification: { status: "failed", failures: [{ testId: "T-GROUP", description: "Group discount", message: "expected 136.00, got 160" }] }, pushed: true });
    expect(failing).toMatchObject({ revise: true, record: { status: "verification_failed" } });
    const conflicting = await record("conflicting", sha(4), { kind: "conflict", conflictingFiles: ["src/pricing.ts"], overlappingFiles: ["src/pricing.ts"], landedDiff: "+landed line", previousDiff: "+previous line", reset: true });
    expect(conflicting).toMatchObject({ revise: true, record: { status: "conflict_revising" } });
    const human = await record("human", sha(5), { kind: "updated", newCommit: sha(72), overlappingFiles: [], verification: { status: "passed", failures: [] }, pushed: false });
    expect(human).toMatchObject({ revise: false, record: { status: "needs_author" } });
    // Replays of a recorded update change nothing.
    expect((await record("clean", sha(2), { kind: "skipped", reason: "replay" })).record.status).toBe("updated");
    const state = await json<FlareGitProjectState>("/state");
    expect([state.tasks.clean?.baseCommit, state.tasks.clean?.currentCommit, state.tasks.clean?.status]).toEqual([sha(60), sha(70), "ready"]);
    expect([state.tasks.failing?.currentCommit, state.tasks.failing?.status]).toEqual([sha(71), "checkpointed"]);
    expect([state.tasks.conflicting?.baseCommit, state.tasks.conflicting?.currentCommit]).toEqual([sha(60), sha(60)]);
    expect([state.tasks.human?.baseCommit, state.tasks.human?.currentCommit]).toEqual([HEAD, sha(5)]);
    const comments = await json<Array<{ author: string; body: string }>>("/comments?task=conflicting");
    expect(comments.at(-1)?.author).toBe("FlareGit");
    expect(comments.at(-1)?.body).toContain("+landed line");
    expect(comments.at(-1)?.body).toContain(sha(4));
    expect((await json<Array<{ body: string }>>("/comments?task=failing")).at(-1)?.body).toContain("expected 136.00, got 160");
    const view = await json<CoordinationView>("/view");
    expect(view.updates.find((row) => row.taskId === "human")?.reason).toContain("author needs to pull");
  } finally { await mf.dispose(); }
}, 120_000);
