import {expect, test} from "bun:test";
import {expiredRecords, retentionFor, type RetainedRecord} from "../src/core/retention";
import {computeStatus, incidentDurationMs, openIncident, resolveIncident, uptime} from "../src/core/service-status";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 8);

test("retention windows are fixed per record kind", () => {
  expect(retentionFor("audit")).toBe(365);
  expect(retentionFor("deleted_repository")).toBe(30);
  expect(retentionFor("job_log")).toBe(90);
  expect(retentionFor("backup")).toBe(35);
});

test("records expire at exactly their kind's window and never before", () => {
  const records: RetainedRecord[] = [
    {id: "audit-ends-now", kind: "audit", createdAt: NOW - 365 * DAY},
    {id: "audit-one-ms-left", kind: "audit", createdAt: NOW - 365 * DAY + 1},
    {id: "audit-young", kind: "audit", createdAt: NOW - 364 * DAY},
    {id: "repo-old", kind: "deleted_repository", createdAt: NOW - 31 * DAY},
    {id: "repo-young", kind: "deleted_repository", createdAt: NOW - 29 * DAY},
    {id: "log-ends-now", kind: "job_log", createdAt: NOW - 90 * DAY},
    {id: "backup-old", kind: "backup", createdAt: NOW - 36 * DAY},
  ];
  expect(expiredRecords(records, NOW)).toEqual(["audit-ends-now", "repo-old", "log-ends-now", "backup-old"]);
});

test("a legal hold blocks deletion regardless of age", () => {
  const held: RetainedRecord = {id: "held", kind: "job_log", createdAt: NOW - 400 * DAY, legal_hold: true};
  const free: RetainedRecord = {id: "free", kind: "job_log", createdAt: NOW - 400 * DAY, legal_hold: false};
  expect(expiredRecords([held, free], NOW)).toEqual(["free"]);
});

test("status is operational only when every check is ok and fresh", () => {
  const checks = [
    {name: "api", ok: true, checkedAt: NOW - 1_000},
    {name: "git", ok: true, checkedAt: NOW - 5_000},
  ];
  expect(computeStatus(checks, NOW, 60_000)).toBe("operational");
});

test("any failed check makes the status degraded", () => {
  const checks = [
    {name: "api", ok: true, checkedAt: NOW - 1_000},
    {name: "webhooks", ok: false, checkedAt: NOW - 1_000},
  ];
  expect(computeStatus(checks, NOW, 60_000)).toBe("degraded");
});

test("a stale check makes the status unknown, even when it passed", () => {
  expect(computeStatus([{name: "api", ok: true, checkedAt: NOW - 60_001}], NOW, 60_000)).toBe("unknown");
  expect(computeStatus([{name: "api", ok: true, checkedAt: NOW - 60_000}], NOW, 60_000)).toBe("operational");
});

test("a recorded failure stays degraded even when another check is stale", () => {
  const checks = [
    {name: "api", ok: false, checkedAt: NOW - 1_000},
    {name: "git", ok: true, checkedAt: NOW - 120_000},
  ];
  expect(computeStatus(checks, NOW, 60_000)).toBe("degraded");
});

test("no checks at all is unknown, not operational", () => {
  expect(computeStatus([], NOW, 60_000)).toBe("unknown");
});

test("uptime is the ok fraction of samples inside the window", () => {
  const samples = [
    {at: NOW - 4 * HOUR, ok: false},
    {at: NOW - 3 * HOUR, ok: true},
    {at: NOW - 2 * HOUR, ok: false},
    {at: NOW - 1 * HOUR, ok: true},
    {at: NOW + 1 * HOUR, ok: false},
  ];
  expect(uptime(samples, 3 * HOUR, NOW)).toBeCloseTo(2 / 3, 10);
});

test("uptime with no samples in the window is null, not 100%", () => {
  expect(uptime([], HOUR, NOW)).toBeNull();
  expect(uptime([{at: NOW - 2 * HOUR, ok: true}], HOUR, NOW)).toBeNull();
});

test("an incident resolves once and reports its duration in ms", () => {
  expect(incidentDurationMs(openIncident(NOW), NOW + 5_000)).toBe(5_000);

  const resolved = resolveIncident(openIncident(NOW), NOW + 90_000);
  if (!resolved.ok) throw new Error(resolved.error);
  expect(incidentDurationMs(resolved.incident, NOW + 10 * DAY)).toBe(90_000);

  expect(resolveIncident(resolved.incident, NOW + 120_000)).toEqual({ok: false, error: "Incident is already resolved"});
  expect(incidentDurationMs(resolved.incident, NOW + 10 * DAY)).toBe(90_000);
});

test("an incident cannot resolve before it opened", () => {
  expect(resolveIncident(openIncident(NOW), NOW - 1)).toEqual({ok: false, error: "Incident cannot resolve before it opened"});
});

test("future and malformed successful checks cannot establish operational status", () => {
  expect(computeStatus([{name: "api", ok: true, checkedAt: NOW + 1}], NOW, 60_000)).toBe("unknown");
  expect(computeStatus([{name: "api", ok: true, checkedAt: Number.NaN}], NOW, 60_000)).toBe("unknown");
  expect(computeStatus([{name: "api", ok: true, checkedAt: NOW}], NOW, -1)).toBe("unknown");
});
