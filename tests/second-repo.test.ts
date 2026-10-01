import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHarness, type Harness } from "./support/harness.js";
import { RuntimeCodingAgent } from "../src/agents/runtime-agent.js";
import { shippingVerifier } from "../src/fixtures/shipping-calculator/verifier.js";
import { gitOrThrow } from "../src/core/pipeline/git.js";

const TEMPLATE = path.resolve(import.meta.dirname, "../src/fixtures/shipping-calculator/template");
const BASE = fs.readFileSync(path.join(TEMPLATE, "src/rates.ts"), "utf-8");
const EXPRESS_A = BASE.replace("speedSurcharge = baseRate * 0.5; // +50% for express", "speedSurcharge = Math.round(baseRate * 0.5 * 100) / 100; // +50% express, cent-rounded");
const EXPRESS_B = BASE.replace("speedSurcharge = baseRate * 0.5; // +50% for express\n    estimatedDays = 2;", "speedSurcharge = baseRate * 0.5; // +50% for express\n    estimatedDays = 3;");
const MERGED = EXPRESS_A.replace("estimatedDays = 2;", "estimatedDays = 3;");

let h: Harness | undefined;
afterEach(() => h?.cleanup());

test("a different domain repo: two real agents conflict in rates.ts, repair merges, protected shipping checks pass", async () => {
  h = await createHarness({
    template: TEMPLATE,
    verifier: shippingVerifier,
    model: async (p) => (p.includes("Git text conflict") ? `<file path="src/rates.ts">\n${MERGED}\n</file>` : "?"),
  });
  const mk = (id: string, goal: string) =>
    h!.controller.createTask({ taskId: id, goal, contributorName: id, contributorType: "agent", allowedScope: ["src/"] });
  const [ta, tb] = await Promise.all([mk("ship-a", "Round express surcharge to cents"), mk("ship-b", "Express takes 3 days")]);
  await Promise.all([
    new RuntimeCodingAgent(ta, shippingVerifier.protectedPaths).work(async () => `<file path="src/rates.ts">\n${EXPRESS_A}\n</file>`),
    new RuntimeCodingAgent(tb, shippingVerifier.protectedPaths).work(async () => `<file path="src/rates.ts">\n${EXPRESS_B}\n</file>`),
  ]);
  h.controller.recordTaskCheckpoint({ taskId: ta.id, isReadyForIntegration: true });
  h.controller.recordTaskCheckpoint({ taskId: tb.id, isReadyForIntegration: true });

  const detection = await h.controller.analyzeCompatibility(ta.id, tb.id);
  expect(detection.conflictedFiles).toEqual(["src/rates.ts"]);

  const r = await h.controller.runIntegrationPipeline([ta.id, tb.id]);
  expect(r.success).toBe(true);
  expect(r.evidence!.testResults[0]!.items.every((i) => i.passed)).toBe(true);
  expect(r.evidence!.verifierIdentity).toBe(shippingVerifier.identity);
  expect(gitOrThrow(h.canonicalDir, ["show", `${h.head()}:src/rates.ts`], { gitDir: true })).toBe(MERGED.trim());
}, 120_000);
