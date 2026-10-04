import { expect, test } from "bun:test";
import { WorkersAIClient } from "../src/ai/workers-ai.js";

test("durable spend refusal prevents actual provider invocation", async () => {
  let calls = 0;
  const client = new WorkersAIClient({ binding: { run: async () => { calls++; return { response: "ok" }; } }, beforeDispatch: async () => { throw new Error("budget exhausted"); } });
  await expect(client.complete("work")).rejects.toThrow("budget exhausted");
  expect(calls).toBe(0);
});
test("every real retry consults durable admission with UTF8 byte and output bounds", async () => {
  const admissions: Array<{ model: string; inputBytes: number; maxOutputTokens: number }> = [];
  let calls = 0;
  const client = new WorkersAIClient({ maxOutputTokens: 20, binding: { run: async () => { calls++; if (calls === 1) throw new Error("provider interrupted"); return { response: "ok" }; } }, beforeDispatch: async (input) => { admissions.push(input); } });
  await expect(client.complete("é")).rejects.toThrow("provider interrupted");
  expect(await client.complete("é")).toBe("ok");
  expect(admissions.map((input) => input.inputBytes)).toEqual([2, 2]);
  expect(admissions.map((input) => input.maxOutputTokens)).toEqual([20, 20]);
});
