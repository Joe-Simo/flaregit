import { expect, test } from "bun:test";
import { signIntegrationCallback, verifyIntegrationCallback, type IntegrationCapability } from "../src/server/integration-auth";

const secret = "synthetic-unit-fixture-secret-32-characters";
const now = 1_800_000_000_000;
const callback = { serviceId: "custom-company", repositoryId: "repo-one", eventId: "stable-event-one", timestamp: now / 1000, report: { type: "check", candidateId: "candidate-one", commit: "a".repeat(40), tree: "b".repeat(40), checkId: "check-one", runId: "run-one", policyVersion: 1, sequence: 1, status: "passed", summary: "Synthetic unit fixture" } };
async function verify(value: unknown = callback, capabilities: IntegrationCapability[] = ["report-check"]) {
  const raw = JSON.stringify(value);
  return verifyIntegrationCallback({ secret, raw, signature: await signIntegrationCallback(secret, raw), serviceId: callback.serviceId, repositoryId: callback.repositoryId, capabilities, now });
}

test("generic company callbacks bind the exact payload and stable event identity", async () => {
  expect((await verify())?.eventId).toBe("stable-event-one");
  const raw = JSON.stringify(callback), signature = await signIntegrationCallback(secret, raw);
  expect(await verifyIntegrationCallback({ secret, raw: raw.replace("passed", "failed"), signature, serviceId: callback.serviceId, repositoryId: callback.repositoryId, capabilities: ["report-check"], now })).toBeNull();
});

test("cross-repository and cross-service callbacks fail authentication", async () => {
  expect(await verify({ ...callback, repositoryId: "repo-two" })).toBeNull();
  expect(await verify({ ...callback, serviceId: "different-company" })).toBeNull();
});

test("old and future timestamps are refused independently of event deduplication", async () => {
  expect(await verify({ ...callback, timestamp: callback.timestamp - 301 })).toBeNull();
  expect(await verify({ ...callback, timestamp: callback.timestamp + 301 })).toBeNull();
});

test("capabilities cannot report approval or write repository history", async () => {
  expect(await verify(callback, ["read-candidate"])).toBeNull();
  expect(await verify({ ...callback, approved: true })).toBeNull();
  expect(await verify({ ...callback, report: { ...callback.report, type: "approval" } })).toBeNull();
});

test("review comments validate paths and require comment capability", async () => {
  const comment = { ...callback, report: { type: "comment", candidateId: "candidate-one", commit: "a".repeat(40), body: "Synthetic review", path: "src/file.ts", line: 12 } };
  expect(await verify(comment, ["comment"])).not.toBeNull();
  expect(await verify(comment, ["report-check"])).toBeNull();
  expect(await verify({ ...comment, report: { ...comment.report, path: "../private" } }, ["comment"])).toBeNull();
});


test("check reports require frozen policy, tree and registered run identity without provider spoofing", async () => {
  const { tree: _tree, ...missingTree } = callback.report;
  expect(await verify({ ...callback, report: missingTree })).toBeNull();
  expect(await verify({ ...callback, report: { ...callback.report, providerId: "spoof" } })).toBeNull();
  expect(await verify({ ...callback, report: { ...callback.report, sequence: -1 } })).toBeNull();
  expect(await verify({ ...callback, report: { ...callback.report, policyVersion: 0 } })).toBeNull();
});

test("check links preserve ordinary navigation queries but reject authentication-bearing URLs", async () => {
  expect(await verify({ ...callback, report: { ...callback.report, detailsUrl: "https://checks.example.com/run?step=tests&view=summary" } })).not.toBeNull();
  for (const detailsUrl of ["https://checks.example.com/run?access_token=synthetic", "https://checks.example.com/run?X-Amz-Signature=synthetic", "https://checks.example.com/run?api_key=synthetic", "https://checks.example.com/run?view=ghp_abcdefghijklmnopqrstuvwxyz", "https://checks.example.com/%E0%A4%A"]) {
    expect(await verify({ ...callback, report: { ...callback.report, detailsUrl } })).toBeNull();
  }
});
