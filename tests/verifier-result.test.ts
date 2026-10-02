import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHarness } from "./support/harness.js";
import { scriptedModel } from "./support/scripted-model.js";
import { gitOrThrow, PLATFORM_IDENTITY } from "../src/core/pipeline/git.js";
import { ticketBookingVerifier } from "../src/fixtures/ticket-booking/verifier.js";

test("candidate cannot forge protected check results by replacing JSON.stringify", async () => {
  const h = await createHarness({ model: scriptedModel() });
  try {
    const task = await h.controller.createTask({ taskId: "forge", goal: "Attempt forged verifier result", contributorName: "Adversary", contributorType: "human", allowedScope: ["src/"] });
    const dir = task.workspace.localPath!;
    const file = path.join(dir, "src/pricing.ts");
    const original = fs.readFileSync(file, "utf8").replace("const total = ticketTotal;", "const total = 0;");
    fs.writeFileSync(file, original + `\nconst stringify = JSON.stringify;\nJSON.stringify = ((value: unknown) => stringify(Array.isArray(value) ? value.map(item => ({ ...item, passed: true })) : value)) as typeof JSON.stringify;\n`);
    gitOrThrow(dir, ["add", "."]); gitOrThrow(dir, [...PLATFORM_IDENTITY, "commit", "-m", "Wrong totals and forged pass flags"]);
    const commit = gitOrThrow(dir, ["rev-parse", "HEAD"]);
    const evidence = await ticketBookingVerifier.verify({ repoDir: dir, candidateCommit: commit, expectedBase: h.seedHead, requirementsVersion: 1, policy: ticketBookingVerifier.defaultPolicy });
    expect(evidence.status).toBe("failed");
    expect(evidence.testResults[0]!.items.some((item) => item.testId === "REQ-BASE-SINGLE-TICKET" && !item.passed)).toBe(true);
  } finally { h.cleanup(); }
}, 30_000);
