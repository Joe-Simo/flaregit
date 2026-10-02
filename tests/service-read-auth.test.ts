import { expect, test } from "bun:test";
import { signServiceRead, verifyServiceRead } from "../src/server/service-read-auth";
const secret = "synthetic-service-read-unit-secret-32chars";
const request = { method: "GET", path: "/api/p/repo-one/connections/company/candidates/candidate-one?commit=" + "a".repeat(40), timestamp: 1_800_000_000, nonce: "synthetic_nonce_123456" };

test("service reads sign exact method/path/query and require read capability", async () => {
  const signature = await signServiceRead(secret, request);
  const input = { ...request, secret, signature, capabilities: ["read-candidate"] as const, now: request.timestamp * 1000 };
  expect(await verifyServiceRead(input)).toBe(true);
  expect(await verifyServiceRead({ ...input, path: input.path.replace("repo-one", "repo-two") })).toBe(false);
  expect(await verifyServiceRead({ ...input, path: input.path.replace("?commit=", "?other=") })).toBe(false);
  expect(await verifyServiceRead({ ...input, method: "POST" })).toBe(false);
  expect(await verifyServiceRead({ ...input, capabilities: ["comment"] })).toBe(false);
  expect(await verifyServiceRead({ ...input, nonce: "changed_nonce_123456" })).toBe(false);
});

test("service reads reject stale/future timestamps and malformed signatures", async () => {
  const signature = await signServiceRead(secret, request);
  expect(await verifyServiceRead({ ...request, secret, signature, capabilities: ["read-candidate"], now: (request.timestamp + 301) * 1000 })).toBe(false);
  expect(await verifyServiceRead({ ...request, secret, signature, capabilities: ["read-candidate"], now: (request.timestamp - 301) * 1000 })).toBe(false);
  expect(await verifyServiceRead({ ...request, secret, signature: "bad", capabilities: ["read-candidate"], now: request.timestamp * 1000 })).toBe(false);
});
