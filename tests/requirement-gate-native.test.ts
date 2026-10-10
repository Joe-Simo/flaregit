import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
import type { FlareGitProjectState, ProductDecision, RequirementCheck } from "../src/core/types";
import type { RequirementRevision } from "../src/server/requirement-decisions";
import { landingCommitMessage, mergeCommitMessage } from "../src/core/pipeline/merge-message";

const FILE = "tests/requirement-gate-native.test.ts";
const WINNER = "REQ-DISCOUNT-INCLUDES-REFUND-FEE", LOSER = "REQ-REFUND-FEE-NEVER-DISCOUNTED";
/** Fixture commits: b returns the decided total (153), c returns the losing total (156). */
const COMPLIANT = "b".repeat(40), VIOLATING = "c".repeat(40);

async function fixture(name: string) {
  const output = `/tmp/flaregit-requirement-gate-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, "build", "tests/support/coordination-worker.ts", "--target=browser", "--external=cloudflare:workers", "--external=node:*", `--outfile=${output}`], { stdout: "ignore", stderr: "pipe" });
  let script: string;
  try { if (await build.exited !== 0) throw new Error(await new Response(build.stderr).text()); script = await Bun.file(output).text(); } finally { if (await Bun.file(output).exists()) await Bun.file(output).delete(); }
  const bindings = { MANAGED_ACCOUNT_MONTHLY_USD_MICROS: "100000000", MANAGED_GLOBAL_MONTHLY_USD_MICROS: "100000000", MANAGED_ESSENTIAL_ACCOUNT_MONTHLY_USD_MICROS: "1000000", MANAGED_ESSENTIAL_GLOBAL_MONTHLY_USD_MICROS: "2000000" };
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "coordination", modules: true, script, bindings, compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], durableObjects: { REPOSITORY_CONTROLLER: { className: "CoordinationFixture", useSQLite: true } } }] }));
  const api = await mf.getWorker("coordination");
  const json = async <T>(path: string, value?: unknown): Promise<T> => {
    const response = await api.fetch(`http://test${path}?name=${name}`, { method: "POST", ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    const parsed = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(parsed));
    return parsed as T;
  };
  await json("/seed");
  return { mf, json };
}

/** Two changes contradict, the owner chooses the group discount for the whole order, and revisions are sent. */
async function decide(json: Awaited<ReturnType<typeof fixture>>["json"]) {
  await json("/task", { id: "discount-all", commit: COMPLIANT, agent: true, act3: 0 });
  await json("/task", { id: "fee-fixed", commit: VIOLATING, agent: true, act3: 1 });
  // Open elsewhere: the same losing requirement, and one restated under another identity.
  await json("/task", { id: "fee-fixed-again", commit: VIOLATING, agent: true, act3: 1 });
  await json("/task", { id: "fee-restated", commit: VIOLATING, agent: true, act3: 1, requirementId: "REQ-FEE-RESTATED" });
  const { decision } = await json<{ decision: ProductDecision }>("/landing", { tasks: ["discount-all", "fee-fixed"], holder: "integration-decision" });
  await json("/resolve", { decisionId: decision.id, optionId: WINNER, actor: "owner" });
  return json<{ results: RequirementRevision[]; created: Array<[string, { taskId: string }]> }>("/dispatch-revisions", { decisionId: decision.id });
}

test("a decision supersedes the losing requirement on every open change and sends each a revision", async () => {
  if (await workerdChild(FILE, "a decision supersedes the losing requirement on every open change and sends each a revision")) return;
  const { mf, json } = await fixture("supersede");
  try {
    const first = await decide(json);
    expect(first.results.map((row) => [row.taskId, row.status]).sort()).toEqual([["fee-fixed", "dispatched"], ["fee-fixed-again", "dispatched"], ["fee-restated", "dispatched"]]);
    expect(first.created.map(([, params]) => params.taskId).sort()).toEqual(["fee-fixed", "fee-fixed-again", "fee-restated"]);
    const state = await json<FlareGitProjectState>("/state");
    for (const [id, losing] of [["fee-fixed-again", LOSER], ["fee-restated", "REQ-FEE-RESTATED"]] as const) {
      const task = state.tasks[id]!;
      expect(task.status).toBe("working");
      expect(task.requirements.map((requirement) => [requirement.id, requirement.status])).toEqual([[losing, "superseded"], [WINNER, "approved"]]);
    }
    expect(state.tasks["discount-all"]?.requirements.map((requirement) => requirement.status)).toEqual(["approved"]);
    // Idempotent: dispatching again starts no second run.
    const again = await json<{ results: RequirementRevision[]; created: unknown[] }>("/dispatch-revisions", { decisionId: first.results[0]!.decisionId });
    expect(again.created).toHaveLength(3);
    expect(again.results.every((row) => row.status === "dispatched")).toBe(true);
  } finally { await mf.dispose(); }
}, 120_000);

test("a candidate that breaks a decided requirement is blocked and its approval refused; a compliant one passes", async () => {
  if (await workerdChild(FILE, "a candidate that breaks a decided requirement is blocked and its approval refused; a compliant one passes")) return;
  const { mf, json } = await fixture("gate");
  try {
    await decide(json);
    // A later change that never carried either requirement still inherits the decided one.
    await json("/task", { id: "late-violating", commit: VIOLATING, agent: true });
    await json("/landing", { tasks: ["late-violating"], holder: "integration-violating" });
    const blocked = await json<{ failure: string | null; checks: RequirementCheck[]; probes: number }>("/gate", { holder: "integration-violating", commit: VIOLATING });
    expect(blocked.probes).toBe(1);
    expect(blocked.checks.map((check) => [check.requirementId, check.decided, check.passed, check.actual])).toEqual([[WINNER, true, false, { total: 156 }]]);
    expect(blocked.failure).toBe("This change breaks the decided requirement “Group discount applies to the whole order”: ticketCount 4, basePrice 40, isRefundable true should give total 153, the code returns total 156.");
    const refused = await json<{ ok: boolean; error?: string }>("/review", { holder: "integration-violating", approved: true });
    expect(refused).toEqual({ ok: false, error: blocked.failure! });
    const saved = await json<FlareGitProjectState>("/state");
    const candidate = Object.values(saved.candidates).find((value) => value.workflowInstanceId === "integration-violating")!;
    expect(candidate.requirementChecks?.commit).toBe(VIOLATING);
    expect(candidate.review).toBeUndefined();
    await json("/abort", { holder: "integration-violating", reason: blocked.failure });

    await json("/task", { id: "late-compliant", commit: COMPLIANT, agent: true });
    await json("/landing", { tasks: ["late-compliant"], holder: "integration-compliant" });
    const passed = await json<{ failure: string | null; checks: RequirementCheck[] }>("/gate", { holder: "integration-compliant", commit: COMPLIANT });
    expect(passed.failure).toBeNull();
    expect(passed.checks.map((check) => [check.requirementId, check.passed, check.actual])).toEqual([[WINNER, true, { total: 153 }]]);
    // Requirements no longer refuse approval; this fixture has no verification evidence, so the next gate answers.
    const review = await json("/review", { holder: "integration-compliant", approved: true }).then((value) => JSON.stringify(value), (error: unknown) => String(error));
    expect(review).toContain("Verified exact candidate unavailable");
    expect(review).not.toContain("requirement");
  } finally { await mf.dispose(); }
}, 120_000);

test("merge commit messages read as the change's goal and keep platform ids in trailers", () => {
  const message = mergeCommitMessage({ goal: "Make the group discount\nalso reduce the refundable surcharge", candidateId: "cand_123", taskId: "task-abc", commit: "a".repeat(40) });
  expect(message).toBe(["Make the group discount also reduce the refundable surcharge", "", "Merged by FlareGit after review.", "", "FlareGit-Change: task-abc", "FlareGit-Candidate: cand_123", `FlareGit-Change-Commit: ${"a".repeat(40)}`].join("\n"));
  expect(message.split("\n")[0]).not.toContain("cand_");
  const squash = landingCommitMessage({ candidateId: "cand_9", changes: [{ id: "a", goal: "Add receipts" }, { id: "b", goal: "Fix totals" }], coauthors: ["Co-authored-by: A <a@users.flaregit.com>"] });
  expect(squash).toBe(["Add receipts; Fix totals", "", "- Add receipts", "- Fix totals", "", "Merged by FlareGit after review.", "", "FlareGit-Change: a", "FlareGit-Change: b", "FlareGit-Candidate: cand_9", "Co-authored-by: A <a@users.flaregit.com>"].join("\n"));
});
