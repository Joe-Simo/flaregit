import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { getArtifactsClient } from "../artifacts/index.js";
import { FlareGitRepositoryController } from "../core/controller.js";
import type { FlareGitProjectState, Requirement } from "../core/types.js";
import { runAct1TextConflict } from "../scenarios/act1-text-conflict.js";
import { runAct2CleanMergeBrokenBehavior } from "../scenarios/act2-clean-broken.js";
import { runAct3ContradictoryRequirements } from "../scenarios/act3-contradiction.js";
import { publishAcceptedCandidate } from "../core/pipeline/accept.js";

async function main() {
  console.log("=================================================");
  console.log("  FLAREGIT FEASIBILITY SPIKE: PROOF BEFORE POLISH");
  console.log("=================================================\n");

  const spikeStorage = path.resolve(process.cwd(), ".flaregit-storage", "spike-run");
  const workspacesStorage = path.resolve(process.cwd(), ".flaregit-workspace");
  if (fs.existsSync(spikeStorage)) {
    fs.rmSync(spikeStorage, { recursive: true, force: true });
  }
  if (fs.existsSync(workspacesStorage)) {
    fs.rmSync(workspacesStorage, { recursive: true, force: true });
  }
  fs.mkdirSync(spikeStorage, { recursive: true });

  const { LocalGitArtifactsClient } = await import("../artifacts/local-git.js");
  const artifacts = new LocalGitArtifactsClient(path.join(spikeStorage, "artifacts"));


  // STEP 1: Create Canonical Repository and Seed Fixture
  console.log("[Spike 1/8] Creating canonical Artifacts repository...");
  const canonicalRepo = await artifacts.create("flaregit-canonical", {
    description: "Authoritative canonical repository for FlareGit",
    setDefaultBranch: "main",
  });

  // Seed fixture files into canonical
  const seedWorkDir = path.join(spikeStorage, "canonical-seed");
  spawnSync("git", ["clone", canonicalRepo.remote, seedWorkDir]);

  const fixtureTemplateDir = path.resolve(
    process.cwd(),
    "src/fixtures/ticket-booking/template"
  );

  // Copy template files
  fs.cpSync(fixtureTemplateDir, seedWorkDir, { recursive: true });

  spawnSync("git", ["-C", seedWorkDir, "add", "-A"]);
  spawnSync("git", [
    "-C",
    seedWorkDir,
    "-c",
    "user.name=FlareGit System",
    "-c",
    "user.email=system@flaregit.local",
    "commit",
    "-m",
    "Initial seed commit: Ticket Booking application fixture",
  ]);
  spawnSync("git", ["-C", seedWorkDir, "push", "origin", "main"]);

  const seedHead = spawnSync("git", ["-C", seedWorkDir, "rev-parse", "HEAD"])
    .stdout.toString()
    .trim();
  console.log(`✓ Canonical repository initialized at commit: ${seedHead.slice(0, 7)}`);

  // Initialize Controller
  const baseRequirement: Requirement = {
    id: "REQ-BASE-SINGLE-TICKET",
    title: "Baseline Ticket Checkout",
    description: "1 ticket @ $40 without extras equals exactly $40.00",
    version: 1,
    status: "approved",
    originTaskId: "task-seed",
    approvedAt: new Date().toISOString(),
    assertions: [],
  };

  const projectState: FlareGitProjectState = {
    projectId: "flaregit-demo",
    projectName: "FlareGit Ticket Platform",
    canonicalRepoName: "flaregit-canonical",
    acceptedState: {
      currentCommit: seedHead,
      acceptedAt: new Date().toISOString(),
      buildDigest: "seed_digest_init",
      activeRequirements: [baseRequirement],
      history: [],
    },
    tasks: {},
    candidates: {},
    evidence: {},
    decisions: {},
    journal: [],
    policyVersion: 1,
  };

  const controller = new FlareGitRepositoryController(
    artifacts,
    projectState,
    path.join(spikeStorage, "controller")
  );

  // STEP 2: Execute actual Git & build commands in isolated workspaces
  console.log("\n[Spike 2/8] Validating isolated workspace Git operations...");
  const testTask = await controller.createTask({
    taskId: "test-workspace-check",
    goal: "Verify clean workspace git operations",
    contributorName: "Workspace Validator",
    contributorType: "agent",
  });
  const gitStatus = spawnSync("git", [
    "-C",
    testTask.workspace.localPath!,
    "status",
  ]);
  if (gitStatus.status !== 0) throw new Error("Workspace git verification failed");
  console.log("✓ Real Git commands execute with full fidelity in task workspaces.");

  // STEP 3 & 4: Run Act I - Text Conflict and Automatic Repair
  console.log("\n[Spike 3-4/8] Running Act I: Concurrent agents with textual conflict & repair...");
  const act1Result = await runAct1TextConflict(controller);
  console.log(`✓ Act I verified and accepted at: ${act1Result.candidateCommit.slice(0, 7)}`);

  // STEP 5: Run Act II - Clean Merge with Broken Behavior & Repair
  console.log("\n[Spike 5/8] Running Act II: Clean merge semantic/units failure & repair...");
  const act2Result = await runAct2CleanMergeBrokenBehavior(controller);
  console.log(`✓ Act II verified and accepted at: ${act2Result.candidateCommit.slice(0, 7)}`);

  // STEP 6: Run Act III - Contradictory Requirements & Product Decision
  console.log("\n[Spike 6/8] Running Act III: Incompatible requirements & product decision...");
  const act3Result = await runAct3ContradictoryRequirements(
    controller,
    "discount_tickets_only"
  );
  console.log(`✓ Act III resolved and accepted at: ${act3Result.finalCommit.slice(0, 7)}`);

  // STEP 7: Fault Test - Reject Stale or Competing Publication
  console.log("\n[Spike 7/8] Fault Test: Rejecting stale/competing publication...");
  const staleCandidate = {
    ...controller.getState().candidates[Object.keys(controller.getState().candidates)[0]!]!,
    id: "cand_stale_test",
    candidateCommit: seedHead,
    expectedAcceptedBase: "0000000000000000000000000000000000000000", // completely invalid old base
  };
  const mockEvidence = Object.values(controller.getState().evidence)[0]!;

  const staleResult = publishAcceptedCandidate({
    canonicalRepoDir: seedWorkDir,
    candidate: staleCandidate,
    evidence: { ...mockEvidence, candidateCommit: seedHead },
    currentCanonicalHead: controller.getState().acceptedState.currentCommit,
    tasks: [],
  });

  if (staleResult.success) {
    throw new Error("Fault test failed: stale candidate was incorrectly accepted!");
  }
  console.log(`✓ Stale publication correctly rejected: ${staleResult.error}`);

  // STEP 8: Fault Test - Test Weakening Rejection
  console.log("\n[Spike 8/8] Fault Test: Proving test weakening cannot authorize acceptance...");
  // Protected verifier maintains its own test suite; even if untrusted code claims "all pass",
  // the verifier independently re-executes tests directly against candidate exports
  const faultyContext = {
    candidateCommit: seedHead,
    expectedBase: seedHead,
    requirementsVersion: 1,
    calculateQuote: () => ({
      ticketCount: 4,
      basePrice: 40,
      ticketTotal: 160,
      discountAmount: 0,
      refundFeeTotal: 0,
      total: 999999, // deliberate faulty output
      isRefundable: false,
    }),
    policy: {
      groupDiscountPercent: 0.15,
      minTicketsForDiscount: 4,
      refundFeePerTicket: 5.0,
      discountAppliesToRefundFee: false,
    },
  };

  const { runProtectedVerification } = await import(
    "../fixtures/ticket-booking/verifier.js"
  );
  const faultyEvidence = runProtectedVerification(faultyContext);
  if (faultyEvidence.status === "passed") {
    throw new Error("Fault test failed: faulty quote was marked as passed!");
  }
  console.log("✓ Protected verifier caught faulty calculation and rejected acceptance.");

  console.log("\n=================================================");
  console.log("  ALL 8 SPIKE CHECKS COMPLETED SUCCESSFULLY!");
  console.log("=================================================");
}

main().catch((err) => {
  console.error("Spike failed with error:", err);
  process.exit(1);
});
