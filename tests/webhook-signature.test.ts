import {expect, test} from "bun:test";
import {signWebhook, verifyWebhook} from "../src/core/webhook-signature";

const now = 1_700_000_000_000;
const secret = crypto.randomUUID();

test("a fresh signature verifies", async () => {
  const signature = await signWebhook(secret, now, '{"a":1}');
  expect(await verifyWebhook(secret, now, '{"a":1}', signature, now + 1000)).toEqual({ok: true});
});

test("tampered body, wrong secret and bad signatures fail", async () => {
  const signature = await signWebhook(secret, now, "body");
  expect(await verifyWebhook(secret, now, "other", signature, now)).toEqual({ok: false, reason: "mismatch"});
  expect(await verifyWebhook(crypto.randomUUID(), now, "body", signature, now)).toEqual({ok: false, reason: "mismatch"});
  expect(await verifyWebhook(secret, now, "body", "zz", now)).toEqual({ok: false, reason: "malformed"});
});

test("timestamps beyond five minutes are stale in both directions", async () => {
  const signature = await signWebhook(secret, now, "body");
  expect(await verifyWebhook(secret, now, "body", signature, now + 300_000)).toEqual({ok: true});
  expect(await verifyWebhook(secret, now, "body", signature, now + 300_001)).toEqual({ok: false, reason: "stale"});
  expect(await verifyWebhook(secret, now, "body", signature, now - 300_001)).toEqual({ok: false, reason: "stale"});
});
