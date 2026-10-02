import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHarness, type Harness } from "./support/harness.js";
import { scriptedModel, mergedPricing } from "./support/scripted-model.js";
import { ACT1, ACT2, ACT3, runScenario } from "../src/scenarios/ticket-booking.js";
import { ticketBookingVerifier } from "../src/fixtures/ticket-booking/verifier.js";
import { publishAcceptedCandidate, reconcileJournalEntry } from "../src/core/pipeline/accept.js";
import { changedFiles, gitOrThrow } from "../src/core/pipeline/git.js";
import { FlareGitRepositoryController } from "../src/core/controller.js";

let h: Harness | undefined;
afterEach(() => {
  h?.cleanup();
  h = undefined;
});
const P = ticketBookingVerifier.protectedPaths;
const T = 120_000;

describe("Act I — Git text conflict", () => {
  test("two agents conflict in native Git, repair keeps both features, exact verified commit lands", async () => {
    h = await createHarness({ model: scriptedModel() });
    const r = await runScenario(h.controller, ACT1, scriptedModel(), P);
    expect(r.agentCommits[0]).not.toBe(r.agentCommits[1]);
    expect(r.detectionSummary).toContain("cannot merge src/pricing.ts");
    expect(r.integration.success).toBe(true);

    const cand = r.integration.candidate!;
    const ev = r.integration.evidence!;
    expect(cand.compositionMethod).toBe("repaired_merge");
    expect(cand.repairAttempts).toHaveLength(1);
    expect(ev.status).toBe("passed");
    expect(h.head()).toBe(cand.candidateCommit!);
    expect(ev.candidateCommit).toBe(h.head());
    expect(ev.candidateTree).toBe(gitOrThrow(h.canonicalDir, ["rev-parse", `${h.head()}^{tree}`], { gitDir: true }));
    // Both features present in the accepted code.
    const code = gitOrThrow(h.canonicalDir, ["show", `${h.head()}:src/pricing.ts`], { gitDir: true });
    expect(code).toContain("0.15");
    expect(code).toContain("* 5");
    expect(h.controller.getState().acceptedState.currentCommit).toBe(h.head());
  }, T);
});

describe("Act II — clean merge, broken behavior", () => {
  test("Git merges cleanly, protected verification fails, repair fixes it, nothing broken is published", async () => {
    h = await createHarness({ model: scriptedModel() });
    await runScenario(h.controller, ACT1, scriptedModel(), P);
    const afterAct1 = h.head();

    const r = await runScenario(h.controller, ACT2, scriptedModel(), P);
    expect(r.detectionSummary).toContain("merges cleanly but the combined application fails");
    expect(r.integration.success).toBe(true);
    const evidence = Object.values(h.controller.getState().evidence).filter((e) => e.candidateCommit !== r.integration.evidence!.candidateCommit);
    const failed = evidence.filter((e) => e.status === "failed");
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed.some((e) => e.testResults[0]!.items.some((i) => i.testId === "REQ-CATALOG-TO-CHECKOUT-DOLLARS" && !i.passed))).toBe(true);
    expect(r.integration.candidate!.repairAttempts[0]!.patch).toContain("src/App.tsx");
    expect(h.head()).not.toBe(afterAct1);
    expect(h.head()).toBe(r.integration.evidence!.candidateCommit);
  }, T);

  test("if repair cannot fix the behavior, canonical is untouched and tasks are blocked", async () => {
    const good = scriptedModel();
    let calls = 0;
    h = await createHarness({ model: (p) => (++calls === 1 ? good(p) : Promise.resolve("no idea")) });
    await runScenario(h.controller, ACT1, scriptedModel(), P); // consumes the one good repair
    const before = h.head();
    const r = await runScenario(h.controller, ACT2, scriptedModel(), P);
    expect(r.integration.success).toBe(false);
    expect(h.head()).toBe(before);
    expect(r.tasks.every((t) => h!.controller.getState().tasks[t.id]!.status === "blocked")).toBe(true);
  }, T);
});

describe("Act III — contradiction", () => {
  test("preserves accepted version, asks one question, then implements and verifies the choice", async () => {
    h = await createHarness({ model: scriptedModel() });
    await runScenario(h.controller, ACT1, scriptedModel(), P);
    const accepted = h.head();

    const r = await runScenario(h.controller, ACT3, scriptedModel(), P);
    expect(r.integration.success).toBe(false);
    expect(r.integration.decision?.question).toBe("Should the group discount apply to the refund fee?");
    expect(r.integration.decision?.options).toHaveLength(2);
    expect(h.head()).toBe(accepted);
    expect(Object.values(h.controller.getState().tasks).filter((t) => t.status === "needs_decision")).toHaveLength(2);

    const chosen = "REQ-DISCOUNT-INCLUDES-REFUND-FEE"; // 153 — requires real implementation work
    const res = await h.controller.resolveProductDecision(r.integration.decision!.id, chosen);
    expect(res.integration?.success).toBe(true);
    expect(res.integration!.candidate!.repairAttempts.length).toBeGreaterThanOrEqual(1);
    expect(h.head()).not.toBe(accepted);
    const code = gitOrThrow(h.canonicalDir, ["show", `${h.head()}:src/pricing.ts`], { gitDir: true });
    expect(code).toBe(mergedPricing(true).trim());
    expect(h.controller.getState().verificationPolicy.discountAppliesToRefundFee).toBe(true);
  }, T);
});

describe("Protected verification and containment", () => {
  test("model-written repair cannot touch protected paths", async () => {
    const repairCalls: string[] = [];
    h = await createHarness({
      model: scriptedModel({ repairCalls, repair: () => '<file path="package.json">\n{}\n</file>' }),
    });
    const r = await runScenario(h.controller, ACT1, scriptedModel(), P);
    expect(r.integration.success).toBe(false);
    expect(r.integration.error).toMatch(/out-of-scope|protected/);
    expect(h.head()).toBe(h.seedHead);
  }, T);

  test("contributor push that edits protected verification config is rejected", async () => {
    h = await createHarness({ model: scriptedModel() });
    const [a, b] = ACT1;
    const ta = await h.controller.createTask({ taskId: a.taskId, goal: a.goal, contributorName: "A", contributorType: "human", allowedScope: ["src/"] });
    const tb = await h.controller.createTask({ taskId: b.taskId, goal: b.goal, contributorName: "B", contributorType: "human", allowedScope: ["src/"] });
    fs.mkdirSync(path.join(ta.workspace.localPath!, "tests"), { recursive: true });
    fs.writeFileSync(path.join(ta.workspace.localPath!, "tests/verify.test.ts"), "// weakened\n");
    h.controller.recordTaskCheckpoint({ taskId: ta.id, isReadyForIntegration: true });
    fs.writeFileSync(path.join(tb.workspace.localPath!, "src/NOTES.md"), "x\n");
    h.controller.recordTaskCheckpoint({ taskId: tb.id, isReadyForIntegration: true });
    const r = await h.controller.runIntegrationPipeline([ta.id, tb.id]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/protected/);
    expect(h.head()).toBe(h.seedHead);
  }, T);

  test("candidate code cannot see platform secrets or forge verifier output", async () => {
    process.env.CLOUDFLARE_API_TOKEN = "sentinel-secret";
    try {
      const evil = scriptedModel({
        agent: (prompt) =>
          prompt.includes("15% group discount")
            ? `<file path="src/pricing.ts">\nif (process.env.CLOUDFLARE_API_TOKEN) throw new Error("LEAK");\nconsole.log("deadbeef:[]");\nprocess.exit(0);\nexport const calculateQuote = () => ({});\n</file>`
            : undefined,
      });
      h = await createHarness({ model: scriptedModel({ repair: () => "nope" }) });
      const r = await runScenario(h.controller, ACT1, evil, P);
      expect(r.integration.success).toBe(false);
      const evs = Object.values(h.controller.getState().evidence);
      expect(evs.every((e) => e.status === "failed")).toBe(true);
      expect(JSON.stringify(evs)).not.toContain("LEAK");
      expect(h.head()).toBe(h.seedHead);
    } finally {
      delete process.env.CLOUDFLARE_API_TOKEN;
    }
  }, T);
});

describe("Publication safety", () => {
  async function landed() {
    h = await createHarness({ model: scriptedModel() });
    const r = await runScenario(h.controller, ACT1, scriptedModel(), P);
    return r.integration;
  }

  test("stale base is refused and never overwrites newer accepted work", async () => {
    const o = await landed();
    const head = h!.head();
    const res = publishAcceptedCandidate({
      canonicalRepoDir: h!.canonicalDir,
      defaultBranch: "main",
      candidate: { ...o.candidate!, expectedAcceptedBase: h!.seedHead },
      evidence: { ...o.evidence!, expectedAcceptedBase: h!.seedHead },
      candidateRepoDir: path.join(h!.root, "controller", "integration", o.candidate!.id),
      candidateRef: "refs/heads/x",
    });
    expect(res.success).toBe(false);
    expect(h!.head()).toBe(head);
  }, T);

  test("evidence for a different commit or failed status is refused", async () => {
    const o = await landed();
    const base = {
      canonicalRepoDir: h!.canonicalDir,
      defaultBranch: "main",
      candidateRepoDir: "/nonexistent",
      candidateRef: "refs/heads/x",
    };
    const wrongCommit = publishAcceptedCandidate({ ...base, candidate: o.candidate!, evidence: { ...o.evidence!, candidateCommit: h!.seedHead } });
    expect(wrongCommit.error).toMatch(/Invariant/);
    const failed = publishAcceptedCandidate({ ...base, candidate: o.candidate!, evidence: { ...o.evidence!, status: "failed" } });
    expect(failed.error).toMatch(/not passed/);
  }, T);

  test("duplicate integration requests and duplicate checkpoints are idempotent", async () => {
    const o = await landed();
    const ids = o.candidate!.participatingTaskIds as [string, string];
    const head = h!.head();
    const again = await h!.controller.runIntegrationPipeline(ids);
    expect(again.success).toBe(false);
    expect(again.error).toMatch(/already accepted/);
    expect(h!.head()).toBe(head);
    expect(h!.controller.getState().journal.filter((j) => j.state === "ACCEPTED")).toHaveLength(1);
  }, T);

  test("concurrent landing attempts are serialized; the second recomposes on the new head", async () => {
    h = await createHarness({ model: scriptedModel() });
    const [a, b] = ACT2;
    const mk = async (spec: typeof a, file: string) => {
      const t = await h!.controller.createTask({ taskId: spec.taskId, goal: spec.goal, contributorName: spec.taskId, contributorType: "human", allowedScope: ["src/"] });
      fs.writeFileSync(path.join(t.workspace.localPath!, file), `# ${spec.taskId}\n`);
      return h!.controller.recordTaskCheckpoint({ taskId: t.id, isReadyForIntegration: true });
    };
    const [t1, t2] = await Promise.all([mk(a, "src/N1.md"), mk(b, "src/N2.md")]);
    const [c, d] = ACT3;
    const [t3, t4] = await Promise.all([mk(c, "src/N3.md"), mk(d, "src/N4.md")]);
    const [r1, r2] = await Promise.all([
      h.controller.runIntegrationPipeline([t1.id, t2.id]),
      h.controller.runIntegrationPipeline([t3.id, t4.id]),
    ]);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    const log = gitOrThrow(h.canonicalDir, ["log", "--first-parent", "--format=%H"], { gitDir: true }).split("\n");
    expect(log).toContain(r1.candidate!.candidateCommit!);
    expect(log).toContain(r2.candidate!.candidateCommit!);
    expect(r2.candidate!.expectedAcceptedBase).toBe(r1.candidate!.candidateCommit!);
  }, T);

  test("cancelled tasks are never integrated", async () => {
    h = await createHarness({ model: scriptedModel() });
    const [a, b] = ACT1;
    const ta = await h.controller.createTask({ taskId: a.taskId, goal: a.goal, contributorName: "A", contributorType: "human", allowedScope: ["src/"] });
    const tb = await h.controller.createTask({ taskId: b.taskId, goal: b.goal, contributorName: "B", contributorType: "human", allowedScope: ["src/"] });
    fs.writeFileSync(path.join(ta.workspace.localPath!, "src/N.md"), "x\n");
    h.controller.recordTaskCheckpoint({ taskId: ta.id, isReadyForIntegration: true });
    fs.writeFileSync(path.join(tb.workspace.localPath!, "src/M.md"), "x\n");
    h.controller.recordTaskCheckpoint({ taskId: tb.id, isReadyForIntegration: true });
    h.controller.cancelTask(tb.id);
    const r = await h.controller.runIntegrationPipeline([ta.id, tb.id]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/cancelled/);
    expect(h.head()).toBe(h.seedHead);
  }, T);

  test("crash recovery settles an interrupted publication against the real ref", async () => {
    const o = await landed();
    const state = h!.controller.getState();
    const accepted = state.journal.find((j) => j.state === "ACCEPTED")!;
    const interrupted = { ...accepted, state: "PREPARED" as const };
    expect(reconcileJournalEntry(h!.head(), interrupted).state).toBe("ACCEPTED");
    expect(reconcileJournalEntry(h!.seedHead, interrupted).state).toBe("ABORTED");
    expect(reconcileJournalEntry("later-head", interrupted, true).state).toBe("ACCEPTED");
    // Restore from disk with a stuck task and journal entry.
    state.journal = [interrupted];
    state.acceptedState.currentCommit = h!.seedHead;
    for (const t of Object.values(state.tasks)) t.status = "verifying";
    fs.writeFileSync(path.join(h!.root, "controller", "test.state.json"), JSON.stringify(state));
    const restored = await FlareGitRepositoryController.restore(
      { artifacts: h!.artifacts, verifier: ticketBookingVerifier, repairModel: scriptedModel(), storageDir: path.join(h!.root, "controller") },
      "test"
    );
    const s = restored!.getState();
    expect(s.journal[0]!.state).toBe("ACCEPTED");
    expect(s.acceptedState.currentCommit).toBe(h!.head());
    expect(Object.values(s.tasks).every((t) => t.status === "accepted")).toBe(true);
    void o;
  }, T);
});

describe("Git change inspection", () => {
  test("refuses unavailable revisions rather than reporting no protected changes", async () => {
    h = await createHarness({ model: scriptedModel() });
    expect(() => changedFiles(h!.canonicalDir, "missing-base", "missing-head")).toThrow();
  });
});
