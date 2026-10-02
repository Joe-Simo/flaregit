import { expect, test } from "bun:test";
import { sendServiceReport } from "../src/cli/report.js";
import { verifyIntegrationCallback } from "../src/server/integration-auth.js";

const secret = "fixture-service-secret-" + "x".repeat(32);
const report = { type: "comment", candidateId: "candidate-one", commit: "a".repeat(40), body: "Automated review: inspect this change before human approval" };

test("CLI signs exact report bytes without bearer authentication and retains stable retry identity", async () => {
  const callbacks: Array<{ eventId: string; timestamp: number; body: string }> = [];
  const fetcher = (async (url: RequestInfo | URL, options?: RequestInit) => {
    expect(String(url)).toBe("https://flaregit.example/api/p/repo-one/connections/service-one/events");
    expect(options?.redirect).toBe("error");
    const headers = new Headers(options?.headers);
    expect(headers.has("Authorization")).toBe(false);
    const raw = String(options?.body);
    const verified = await verifyIntegrationCallback({ secret, raw, signature: headers.get("X-Flaregit-Signature")!, serviceId: "service-one", repositoryId: "repo-one", capabilities: ["comment"], now: 1_700_000_010_000 });
    expect(verified).not.toBeNull();
    if (!verified || verified.report.type !== "comment") throw new Error("Signature validation failed");
    callbacks.push({ eventId: verified.eventId, timestamp: verified.timestamp, body: verified.report.body });
    return Response.json({ kind: callbacks.length === 1 ? "applied" : "duplicate", commentId: 9, secret: "provider-response-must-not-echo" });
  });
  const base = { origin: "https://flaregit.example", repositoryId: "repo-one", serviceId: "service-one", eventId: "stable-event", report, secret, fetcher };
  expect(await sendServiceReport({ ...base, timestamp: 1_700_000_000 })).toEqual({ kind: "applied", commentId: 9, eventId: "stable-event" });
  expect(await sendServiceReport({ ...base, timestamp: 1_700_000_010 })).toEqual({ kind: "duplicate", commentId: 9, eventId: "stable-event" });
  expect(callbacks[0]?.eventId).toBe(callbacks[1]?.eventId);
  expect(callbacks[0]?.body).toBe(callbacks[1]?.body);
});

test("strict invalid report or unsafe origin is rejected before service secret is sent", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return Response.json({ kind: "applied" }); });
  const base = { origin: "https://flaregit.example", repositoryId: "repo-one", serviceId: "service-one", eventId: "stable-event", report, secret, fetcher };
  await expect(sendServiceReport({ ...base, report: { ...report, approved: true } })).rejects.toThrow();
  await expect(sendServiceReport({ ...base, origin: "https://user:password@attacker.example" })).rejects.toThrow();
  expect(calls).toBe(0);
});

test("service snapshot signs exact query and strips non-metadata fields; revocation denies reads", async () => {
  const { readServiceCandidate } = await import("../src/cli/report.js");
  const { verifyServiceRead } = await import("../src/server/service-read-auth.js");
  const repositoryId = "p123456789abc", serviceId = "svc_12345678-1234-1234-1234-123456789abc", candidateId = "candidate-one", commit = "a".repeat(40);
  let revoked = false;
  const fetcher = async (address: RequestInfo | URL, options?: RequestInit) => {
    const url = new URL(String(address)), headers = new Headers(options?.headers);
    expect(options?.redirect).toBe("error"); expect(headers.has("Authorization")).toBe(false);
    const signed = { secret, method: "GET", path: url.pathname + url.search, timestamp: Number(headers.get("X-Flaregit-Timestamp")), nonce: headers.get("X-Flaregit-Nonce")!, signature: headers.get("X-Flaregit-Signature")!, capabilities: revoked ? [] : ["read-candidate" as const], now: 1_700_000_000_000 };
    expect(await verifyServiceRead({ ...signed, path: signed.path.replace(commit, "b".repeat(40)) })).toBe(false);
    expect(await verifyServiceRead({ ...signed, path: signed.path.replace(candidateId, "candidate-two") })).toBe(false);
    if (!(await verifyServiceRead(signed))) return new Response("Revoked", { status: 401 });
    return Response.json({ repositoryId, candidateId, commit, tree: "b".repeat(40), policyVersion: 1, checks: [{ id: "check-one", required: true, secret: "ignored", run: null }], secret: "ignored", sourceBody: "must not emit", cloneToken: "must not emit" });
  };
  const input = { origin: "https://flaregit.example", repositoryId, serviceId, candidateId, commit, secret, timestamp: 1_700_000_000, fetcher };
  const snapshot = await readServiceCandidate(input);
  expect(snapshot).toEqual({ repositoryId, candidateId, commit, tree: "b".repeat(40), policyVersion: 1, checks: [{ id: "check-one", required: true, run: null }] });
  revoked = true;
  await expect(readServiceCandidate(input)).rejects.toThrow("401");
});
