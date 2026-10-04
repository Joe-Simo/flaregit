import { expect, test } from "bun:test";
import { deriveIncidents, type ProbeRow } from "../src/server/status";

const M = 60_000;
const T0 = 1_800_000_000_000;
const row = (min: number, ok: boolean, detail: string | null = null, component = "git"): ProbeRow => ({ component, at: T0 + min * M, ok: ok ? 1 : 0, latency_ms: 10, detail });

test("single isolated failure is an incident ending at the next success", () => {
  const inc = deriveIncidents([row(0, true), row(5, false, "boom"), row(10, true)], T0 + 12 * M);
  expect(inc).toEqual([{ component: "git", label: "Git hosting (Artifacts)", startedAt: T0 + 5 * M, endedAt: T0 + 10 * M, failedChecks: 1, lastDetail: "boom", ongoing: false }]);
});

test("consecutive failures merge into one incident", () => {
  const inc = deriveIncidents([row(0, false, "a"), row(5, false, "b"), row(10, false, "c"), row(15, true)], T0 + 16 * M);
  expect(inc).toHaveLength(1);
  expect(inc[0]).toMatchObject({ startedAt: T0, endedAt: T0 + 15 * M, failedChecks: 3, lastDetail: "c", ongoing: false });
});

test("failures 20 minutes apart are separate incidents, newest first", () => {
  const withSuccess = deriveIncidents([row(0, false), row(10, true), row(20, false), row(25, true)], T0 + 26 * M);
  expect(withSuccess.map((i) => i.startedAt)).toEqual([T0 + 20 * M, T0]);
  const noChecksBetween = deriveIncidents([row(0, false), row(20, false), row(25, true)], T0 + 26 * M);
  expect(noChecksBetween).toHaveLength(2);
  expect(noChecksBetween[1]).toMatchObject({ startedAt: T0, endedAt: null, ongoing: false, failedChecks: 1 });
});

test("an unrecovered failure is ongoing", () => {
  const inc = deriveIncidents([row(0, true), row(5, false, "down"), row(10, false, "down")], T0 + 12 * M);
  expect(inc).toEqual([{ component: "git", label: "Git hosting (Artifacts)", startedAt: T0 + 5 * M, endedAt: null, failedChecks: 2, lastDetail: "down", ongoing: true }]);
});

test("recovery sets endedAt to the first successful probe", () => {
  const inc = deriveIncidents([row(0, false), row(5, true), row(10, true)], T0 + 11 * M);
  expect(inc[0]).toMatchObject({ endedAt: T0 + 5 * M, ongoing: false });
});

test("a component silent for 15 minutes is an ongoing incident", () => {
  const inc = deriveIncidents([row(0, true, null, "queue"), row(2, true, null, "api"), row(20, true, null, "api")], T0 + 21 * M);
  expect(inc).toHaveLength(1);
  expect(inc[0]).toMatchObject({ component: "queue", startedAt: T0, endedAt: null, failedChecks: 0, ongoing: true, lastDetail: "no check reported for 21 min" });
});

test("probes older than 7 days are ignored", () => {
  expect(deriveIncidents([row(0, false), row(5, true)], T0 + 8 * 1440 * M)).toEqual([]);
  expect(deriveIncidents([], T0)).toEqual([]);
});

test("missing probe evidence is unverified, not operational", async () => {
  const { currentStatus, statusPage } = await import("../src/server/status");
  const env = { REPOSITORY_CONTROLLER: { idFromName: (s: string) => s, get: () => ({ statusSummary: async () => [] }) } } as unknown as import("../src/server/env").Env;
  const rows = await currentStatus(env);
  expect(rows.length).toBe(8);
  expect(rows.every((r) => r.degradedNow && r.lastCheckAt === null)).toBe(true);
  const html = statusPage(rows);
  expect(html).toContain("Unverified");
  expect(html).toContain("not successful customer workflows");
  expect(html).not.toContain("Every subsystem passed");
});

test("storage probes require recovery and web probes require an actual response", async () => {
  const { runProbes } = await import("../src/server/status");
  const results: Array<{ component: string; ok: boolean }> = [];
  let deleted = 0;
  const env = {
    REPOSITORY_CONTROLLER: { idFromName: (s: string) => s, get: () => ({ usageToday: async () => ({}), recordProbe: async (component: string, ok: boolean) => { results.push({ component, ok }); } }) },
    ASSETS: { fetch: async () => new Response("", { status: 503 }) },
    ARTIFACTS: { list: async () => [] },
    EVIDENCE_BUCKET: { put: async () => {}, get: async () => null, delete: async () => { deleted++; } },
    INTEGRATION_WORKFLOW: { get: async () => { throw new Error("not found"); } },
    AI: { run: async () => ({ data: [[1]] }) },
    INTEGRATION_QUEUE: { send: async () => {} },
  } as unknown as import("../src/server/env").Env;
  await runProbes(env);
  expect(results.find((r) => r.component === "api")?.ok).toBe(false);
  expect(results.find((r) => r.component === "storage")?.ok).toBe(false);
  expect(deleted).toBe(1);
});

test("workflow outcomes include refusals in the denominator and retain missing outcomes separately", async () => {
  const { summarizeWorkflowCounts, statusPage } = await import("../src/server/status");
  const summary = summarizeWorkflowCounts([
    { kind: "agent", status: "completed", count: 3 },
    { kind: "agent", status: "failed", count: 1 },
    { kind: "integration", status: "accepted", count: 2 },
    { kind: "integration", status: "stale", count: 1 },
    { kind: "integration", status: "started", count: 4 },
    { kind: "integration", status: "awaiting_review", count: 2 },
  ]);
  expect(summary.completedRuns24h).toBe(7);
  expect(summary.outstandingRuns).toBe(6);
  expect(summary.awaitingReviewRuns).toBe(2);
  expect(summarizeWorkflowCounts([{kind:"integration",status:"awaiting_review",count:1}]).verified).toBe(false);
  expect(summary.verified).toBe(true);
  expect(statusPage([], [], Date.now(), undefined, summary)).toContain("not establish all launched runs were recorded");
  expect(summarizeWorkflowCounts([]).verified).toBe(false);
});

test("unavailable workflow telemetry remains unverified", async () => {
  const { workflowHealth } = await import("../src/server/status");
  const env = { REPOSITORY_CONTROLLER: { idFromName: (s: string) => s, get: () => ({ workflowCounts: async () => { throw new Error("unavailable"); } }) } } as unknown as import("../src/server/env").Env;
  expect((await workflowHealth(env)).verified).toBe(false);
});
