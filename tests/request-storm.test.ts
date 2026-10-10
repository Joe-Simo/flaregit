import { expect, test } from "bun:test";
import { ApiError, apiJson, apiJsonWithRetry, bindApiSession, clearVerifiedApiSession } from "../src/web/api";
import { VisiblePolling, type PollingEnvironment } from "../src/web/visible-polling";
import { ACTIVITY_REFRESH_WINDOW_MS, coalesce, notifyRepositoryActivity, subscribeRepositoryActivity, type CoalesceScheduler } from "../src/web/repository-activity";
import { canRunAgentAgain, coordinationViewSchema, COORDINATION_FALLBACK_INTERVAL_MS, type UpdateView } from "../src/web/coordination";

const flush = async () => { for (let i = 0; i < 32; i++) await Promise.resolve(); };
const emptyView = { queue: [], decisions: [], updates: [] };

/** One virtual clock driving both the coalescer and the polling timer. */
function clock() {
  let now = 0, id = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const scheduler: CoalesceScheduler = { now: () => now, schedule(callback, delay) { const handle = ++id; timers.set(handle, { at: now + delay, callback }); return handle; }, cancel(handle) { timers.delete(handle as number); } };
  const environment: PollingEnvironment = { visible: () => true, subscribe: () => () => undefined, schedule: scheduler.schedule, cancel: scheduler.cancel };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]); now = due[1].at; due[1].callback(); await flush();
    }
    now = end;
  };
  return { scheduler, environment, advance, timers, now: () => now };
}

test("a burst of live-board events costs a bounded number of coordination reads", async () => {
  const original = globalThis.fetch;
  const release = bindApiSession("synthetic-storm-session", async () => "synthetic-token");
  let reads = 0;
  globalThis.fetch = Object.assign(async () => { reads++; return Response.json(emptyView); }, { preconnect: original.preconnect });
  const c = clock();
  try {
    const poll = new VisiblePolling({ intervalMs: COORDINATION_FALLBACK_INTERVAL_MS, read: async signal => coordinationViewSchema.parse(await apiJson<unknown>("/p/project/coordination", { signal })), onValue: () => undefined, onError: () => undefined }, c.environment);
    const coalesced = coalesce(() => void poll.refresh(), ACTIVITY_REFRESH_WINDOW_MS, c.scheduler);
    const unsubscribe = subscribeRepositoryActivity("project", coalesced.trigger);
    poll.start(); await flush();
    expect(reads).toBe(1);
    // 500 board events spread over 10 seconds (one every 20ms), as several agents report progress.
    for (let event = 0; event < 500; event++) { notifyRepositoryActivity("project"); await c.advance(20); }
    await c.advance(ACTIVITY_REFRESH_WINDOW_MS);
    // At most one activity read per 2s window, plus the initial read.
    expect(reads).toBeLessThanOrEqual(1 + Math.ceil(10_000 / ACTIVITY_REFRESH_WINDOW_MS) + 1);
    const settled = reads;
    // With no further events, only the slow fallback read happens: one per fallback interval.
    await c.advance(COORDINATION_FALLBACK_INTERVAL_MS);
    expect(reads).toBe(settled + 1);
    unsubscribe(); coalesced.cancel(); poll.stop();
    notifyRepositoryActivity("project"); await c.advance(60_000);
    expect(reads).toBe(settled + 1);
  } finally { release(); clearVerifiedApiSession(); globalThis.fetch = original; await flush(); }
});

test("a board ticket does not supersede repository reads, and a superseded read is read again instead of failing", async () => {
  const original = globalThis.fetch;
  const release = bindApiSession("synthetic-fence-session", async () => "synthetic-token");
  const pending: Array<(response: Response) => void> = [];
  let gets = 0;
  globalThis.fetch = Object.assign(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (init?.method === "POST") return Response.json({ ticket: "t" });
    gets++; return new Promise<Response>(resolve => pending.push(resolve));
  }, { preconnect: original.preconnect });
  try {
    const run = apiJson<{ version: number }>("/p/project/tasks/one/agent-run");
    await flush();
    await apiJson("/p/project/agents/board/ticket", { method: "POST", preservesReads: true });
    pending.shift()!(Response.json({ version: 1 }));
    expect(await run).toEqual({ version: 1 });
    expect(gets).toBe(1);

    const superseded = apiJson<{ version: number }>("/p/project/tasks/one/agent-run");
    await flush();
    await apiJson("/p/project/tasks/one", { method: "POST", json: { change: true } });
    pending.shift()!(Response.json({ version: 1 }));
    await flush();
    expect(gets).toBe(2 + 1);
    pending.shift()!(Response.json({ version: 2 }));
    expect(await superseded).toEqual({ version: 2 });
  } finally { release(); clearVerifiedApiSession(); globalThis.fetch = original; await flush(); }
});

test("rate-limited reads wait for Retry-After and recover without surfacing an error", async () => {
  const c = clock();
  const errors: unknown[] = [];
  let calls = 0;
  const poll = new VisiblePolling({ intervalMs: 6000, read: async () => { if (++calls === 1) throw new ApiError("Too many requests. Please slow down.", 429, 60); return "ok"; }, onValue: () => undefined, onError: error => errors.push(error), retryDelayMs: error => error instanceof ApiError && error.retryAfter !== null ? error.retryAfter * 1000 : null }, c.environment);
  poll.start(); await flush();
  expect([...c.timers.values()][0]!.at).toBe(60_000);
  await c.advance(60_000);
  expect(calls).toBe(2);
  expect([...c.timers.values()][0]!.at - c.now()).toBe(6000);
  poll.stop();

  const original = globalThis.fetch;
  const release = bindApiSession("synthetic-retry-session", async () => "synthetic-token");
  let reads = 0;
  globalThis.fetch = Object.assign(async () => ++reads === 1 ? new Response(JSON.stringify({ error: "Too many requests" }), { status: 429, headers: { "Retry-After": "0" } }) : Response.json({ run: null }), { preconnect: original.preconnect });
  try {
    expect(await apiJsonWithRetry<{ run: null }>("/p/project/tasks/one/agent-run", new AbortController().signal, 1)).toEqual({ run: null });
    expect(reads).toBe(2);
  } finally { release(); clearVerifiedApiSession(); globalThis.fetch = original; await flush(); }
});

test("an owner can run the agent again after a refused re-run", () => {
  const update: UpdateView = { taskId: "one", landedCommit: "a".repeat(40), fromCommit: "b".repeat(40), fromBase: "c".repeat(40), status: "failed", overlappingFiles: [], conflictingFiles: [], newCommit: null, verification: null, reason: "The agent could not be re-run yet. FlareGit tries again automatically; an owner can also run it again now.", workflowId: "w", revisionWorkflowId: "r", updatedAt: "2026-10-10T00:00:00.000Z" };
  expect(canRunAgentAgain(update)).toBe(true);
});
