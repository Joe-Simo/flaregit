import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACT3 } from "../src/scenarios/ticket-booking";
import { contradictionProofPlan, matchesExpected } from "../src/core/decision/contradiction-proof";
import { executeContradictionProof, type ProofSources } from "../src/server/requirement-decisions";
import { localCoordinationRuntime, sh } from "./support/local-coordination-runtime";

const PRICING = {
  base: `export function calculateQuote(p: { ticketCount: number; basePrice: number; isRefundable?: boolean }) {
  const tickets = p.ticketCount * p.basePrice, fee = p.isRefundable ? 5 * p.ticketCount : 0;
  return { ticketTotal: tickets, refundFeeTotal: fee, discountAmount: 0, total: tickets + fee, isRefundable: p.isRefundable === true };
}
`,
  // Agent A: the group discount applies to the whole order, refund fee included.
  wholeOrder: `export function calculateQuote(p: { ticketCount: number; basePrice: number; isRefundable?: boolean }) {
  const tickets = p.ticketCount * p.basePrice, fee = p.isRefundable ? 5 * p.ticketCount : 0, rate = p.ticketCount >= 4 ? 0.15 : 0;
  const discountAmount = (tickets + fee) * rate;
  return { ticketTotal: tickets, refundFeeTotal: fee, discountAmount, total: tickets + fee - discountAmount, isRefundable: p.isRefundable === true };
}
`,
  // Agent B: the refund fee is never discounted.
  feeProtected: `export function calculateQuote(p: { ticketCount: number; basePrice: number; isRefundable?: boolean }) {
  const tickets = p.ticketCount * p.basePrice, fee = p.isRefundable ? 5 * p.ticketCount : 0, rate = p.ticketCount >= 4 ? 0.15 : 0;
  const discountAmount = tickets * rate;
  return { ticketTotal: tickets, refundFeeTotal: fee, discountAmount, total: tickets - discountAmount + fee, isRefundable: p.isRefundable === true };
}
`,
};

let root = "";
const commits: Record<string, string> = {};
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "flaregit-proof-"));
  const source = join(root, "source");
  await sh(root, `git init --quiet -b main source && mkdir -p source/src`);
  await Bun.write(join(source, "src/pricing.ts"), PRICING.base);
  await sh(source, `git add -A && git commit --quiet -m base`);
  for (const [branch, content] of [["task/a", PRICING.wholeOrder], ["task/b", PRICING.feeProtected], ["task/broken", "export const nothing = 1;\n"]] as const) {
    await sh(source, `git checkout --quiet -B ${branch} main`);
    await Bun.write(join(source, "src/pricing.ts"), content);
    await sh(source, `git commit --quiet -am ${branch.replace("/", "-")}`);
    commits[branch] = await sh(source, "git rev-parse HEAD");
  }
  await sh(root, `git clone --quiet --bare source workspace.git`);
});
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

function sources(branchB: "task/b" | "task/broken"): Extract<ProofSources, { status: "ready" }> {
  const [a, b] = ACT3;
  const plan = contradictionProofPlan(a.requirements[0]!, b.requirements[0]!)!;
  return {
    decisionId: "dec_proof",
    status: "ready",
    input: plan.input,
    probe: plan.probe,
    sides: [
      { taskId: a.taskId, commit: commits["task/a"]!, workspaceRepoName: "workspace", branch: "task/a", requirement: a.requirements[0]! },
      { taskId: b.taskId, commit: commits[branchB]!, workspaceRepoName: "workspace", branch: branchB, requirement: b.requirements[0]! },
    ],
  };
}

test("expected-output matching uses requirement fields only, with cents tolerance", () => {
  expect(matchesExpected({ total: 153.001, discountAmount: 27 }, { total: 153 })).toBe(true);
  expect(matchesExpected({ total: 156 }, { total: 153 })).toBe(false);
  expect(matchesExpected({ other: 1 }, { total: 153 })).toBe(false);
});

test("contradiction is proven by running each change's real code on the disputed input", async () => {
  const runtime = localCoordinationRuntime(join(root, "work"), { workspace: join(root, "workspace.git") });
  const proof = await executeContradictionProof(runtime, sources("task/b"));
  expect(proof.verdict).toBe("proven");
  expect(proof.input).toEqual({ ticketCount: 4, basePrice: 40, isRefundable: true });
  expect(proof.sides.map((side) => side.actual)).toEqual([{ total: 153 }, { total: 156 }]);
  expect(proof.sides.every((side) => side.meetsOwnRequirement && !side.meetsOtherRequirement)).toBe(true);
  expect(proof.sides.map((side) => side.commit)).toEqual([commits["task/a"]!, commits["task/b"]!]);
  expect(proof.summary).toContain("returns total 153");
  expect(proof.summary).toContain("returns total 156");
  // Code ran through the isolated supervisor, never with the fetch credential in its environment.
  expect(runtime.commands.filter((command) => command.includes("probe-cli.ts"))).toHaveLength(2);
}, 60_000);

test("a side whose code cannot run is reported as an execution failure, not a pass", async () => {
  const runtime = localCoordinationRuntime(join(root, "work-broken"), { workspace: join(root, "workspace.git") });
  const proof = await executeContradictionProof(runtime, sources("task/broken"));
  expect(proof.verdict).toBe("execution_failed");
  expect(proof.sides[1].error).toContain("does not export calculateQuote");
  expect(proof.sides[1].meetsOwnRequirement).toBe(false);
  expect(proof.sides[0].actual).toEqual({ total: 153 });
}, 60_000);
