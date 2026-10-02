import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveReceipt } from "../src/cli/acceptance.js";

test("acceptance receipts redact credential-shaped observations and restrict filesystem access", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acceptance-unit-"));
  const file = join(directory, "receipt.json");
  try {
    await saveReceipt(file, { version: 1, origin: "https://example.com", createdAt: "2026-10-02", tasks: [], agentRuns: [], observations: [{ note: "Bearer credential-value-123456" }] });
    const content = await readFile(file, "utf8");
    expect(content).not.toContain("credential-value-123456");
    expect(content).toContain("[REDACTED]");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(content).version).toBe(1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("edited receipt origins cannot redirect authentication away from configured service", async () => {
  const { assertReceiptOrigin } = await import("../src/cli/acceptance.js");
  expect(() => assertReceiptOrigin("https://attacker.example", "https://flaregit.com")).toThrow(/differs/);
  expect(() => assertReceiptOrigin("http://flaregit.com", "https://flaregit.com")).toThrow(/HTTPS/);
  expect(() => assertReceiptOrigin("https://user:secret@flaregit.com", "https://flaregit.com")).toThrow(/credential-free/);
  expect(() => assertReceiptOrigin("https://flaregit.com", "https://flaregit.com")).not.toThrow();
});

test("resuming prepare preserves known agent starts rather than launching duplicates", async () => {
  const { pendingAgentTasks } = await import("../src/cli/acceptance.js");
  expect(pendingAgentTasks({ tasks: ["a", "b"], agentRuns: [{ taskId: "a", instanceId: "saved-instance", requestedAt: "2026-10-02" }] })).toEqual(["b"]);
  expect(pendingAgentTasks({ tasks: ["a"], agentRuns: [{ taskId: "a", instanceId: "saved-instance", requestedAt: "2026-10-02" }] })).toEqual([]);
});

 test("unknown dispatch response can be observed through persisted task ownership without duplicate launch", async () => {
  const { observedAgentInstances } = await import("../src/cli/acceptance.js");
  expect(observedAgentInstances({ tasks: ["a", "b"], agentRuns: [{ taskId: "a", instanceId: "saved-a", requestedAt: "2026-10-02" }] }, {
    a: { agentWorkflowInstanceId: "saved-a" }, b: { agentWorkflowInstanceId: "persisted-b" }, unrelated: { agentWorkflowInstanceId: "foreign-run" },
  })).toEqual(["saved-a", "persisted-b"]);
});
