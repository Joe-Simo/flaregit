import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHarness, type Harness } from "./support/harness.js";
import { createCommandVerifier } from "../src/core/verification/command.js";

const verifier = createCommandVerifier({ kind: "command", test: "bun test", timeoutSec: 60, allowedScope: ["src/"] });
let h: Harness | undefined;
let template: string | undefined;
afterEach(() => {
  h?.cleanup();
  if (template) fs.rmSync(template, { recursive: true, force: true });
});

function makeTemplate(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flaregit-custom-"));
  fs.mkdirSync(path.join(dir, "src"));
  fs.mkdirSync(path.join(dir, "tests"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "customer-app", type: "module" }));
  fs.writeFileSync(path.join(dir, "src/math.ts"), "export const add = (a: number, b: number) => a + b;\n");
  fs.writeFileSync(
    path.join(dir, "tests/math.test.ts"),
    'import { expect, test } from "bun:test";\nimport { add } from "../src/math.ts";\ntest("add", () => expect(add(2, 3)).toBe(5));\n'
  );
  return dir;
}

async function twoTasks(h: Harness, edits: [Record<string, string>, Record<string, string>]) {
  const ids = ["cust-a", "cust-b"] as const;
  const tasks = [];
  for (const [i, id] of ids.entries()) {
    const t = await h.controller.createTask({ taskId: id, goal: `task ${id}`, contributorName: id, contributorType: "human", allowedScope: ["src/"] });
    for (const [file, content] of Object.entries(edits[i]!)) {
      fs.mkdirSync(path.dirname(path.join(t.workspace.localPath!, file)), { recursive: true });
      fs.writeFileSync(path.join(t.workspace.localPath!, file), content);
    }
    tasks.push(h.controller.recordTaskCheckpoint({ taskId: id, isReadyForIntegration: true }));
  }
  return h.controller.runIntegrationPipeline([tasks[0]!.id, tasks[1]!.id]);
}

test("customer repo: two contributors land when the customer's own tests pass", async () => {
  template = makeTemplate();
  h = await createHarness({ model: async () => "no", verifier, template });
  const r = await twoTasks(h, [{ "src/a.ts": "export const a = 1;\n" }, { "src/b.ts": "export const b = 2;\n" }]);
  expect(r.success).toBe(true);
  expect(r.evidence!.verifierIdentity).toBe("flaregit-command-verifier-v1");
  expect(r.evidence!.testResults[0]!.items.map((i) => i.testId)).toEqual(["STEP-TEST"]);
  expect(h.head()).toBe(r.evidence!.candidateCommit);
}, 120_000);

test("customer repo: a change that breaks the customer's tests is never accepted", async () => {
  template = makeTemplate();
  h = await createHarness({ model: async () => "no", verifier, template });
  const r = await twoTasks(h, [{ "src/math.ts": "export const add = (a: number, b: number) => a - b;\n" }, { "src/b.ts": "export const b = 2;\n" }]);
  expect(r.success).toBe(false);
  expect(h.head()).toBe(h.seedHead);
  const ev = Object.values(h.controller.getState().evidence)[0]!;
  expect(ev.status).toBe("failed");
  expect(ev.testResults[0]!.items[0]!.message).toContain("add");
}, 120_000);

test("customer repo: contributors cannot weaken the protected tests", async () => {
  template = makeTemplate();
  h = await createHarness({ model: async () => "no", verifier, template });
  const t = await h.controller.createTask({ taskId: "cheat", goal: "x", contributorName: "c", contributorType: "human", allowedScope: ["src/", "tests/"] });
  fs.writeFileSync(path.join(t.workspace.localPath!, "tests/math.test.ts"), 'import { test } from "bun:test";\ntest("add", () => {});\n');
  fs.writeFileSync(path.join(t.workspace.localPath!, "src/math.ts"), "export const add = () => 0;\n");
  h.controller.recordTaskCheckpoint({ taskId: "cheat", isReadyForIntegration: true });
  const o = await h.controller.createTask({ taskId: "other", goal: "y", contributorName: "o", contributorType: "human", allowedScope: ["src/"] });
  fs.writeFileSync(path.join(o.workspace.localPath!, "src/o.ts"), "export const o = 1;\n");
  h.controller.recordTaskCheckpoint({ taskId: "other", isReadyForIntegration: true });
  const r = await h.controller.runIntegrationPipeline(["cheat", "other"]);
  expect(r.success).toBe(false);
  expect(r.error).toMatch(/protected/);
  expect(h.head()).toBe(h.seedHead);
}, 120_000);
