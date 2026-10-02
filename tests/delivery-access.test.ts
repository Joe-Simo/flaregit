import { expect, test } from "bun:test";
import { authenticate } from "../src/server/access.js";
import { projectIdFor } from "../src/server/shell.js";
import { deliverWebhook } from "../src/server/webhooks.js";
import type { Env } from "../src/server/env.js";

test("opaque identity subjects retain case and whitespace in tenant keys", async () => {
  expect(await projectIdFor("User_A")).not.toBe(await projectIdFor("user_a"));
  expect(await projectIdFor(" user_a ")).not.toBe(await projectIdFor("user_a"));
  expect(await projectIdFor("user_a")).toBe(await projectIdFor("user_a"));
});

test("Clerk authentication fails closed without authorized parties", async () => {
  const env = { CLERK_ISSUER: "https://auth.example.com" } as Env;
  const result = await authenticate(new Request("https://app.example.com/api/account", { headers: { Authorization: "Bearer unused" } }), env);
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(503);
});

test.each(["success", "failed"])("duplicate queue messages leave terminal %s webhook deliveries untouched", async (status) => {
  let writes = 0;
  const ledger = {
    getDelivery: async () => ({ delivery: { status }, webhook: { active: 1 } }),
    markDelivery: async () => { writes++; },
    isBlocked: async () => { throw new Error("Terminal deliveries must not enter delivery flow"); },
  };
  const env = { REPOSITORY_CONTROLLER: { idFromName: (name: string) => name, get: () => ledger } } as unknown as Env;
  expect(await deliverWebhook(env, "project", "delivery")).toBeNull();
  expect(writes).toBe(0);
});
