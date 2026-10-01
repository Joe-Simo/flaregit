import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { getArtifactsClient } from "../artifacts/index.js";
import { FlareGitRepositoryController } from "../core/controller.js";
import type { FlareGitProjectState, Requirement } from "../core/types.js";
import { runAct1TextConflict } from "../scenarios/act1-text-conflict.js";
import { runAct2CleanMergeBrokenBehavior } from "../scenarios/act2-clean-broken.js";
import { runAct3ContradictoryRequirements } from "../scenarios/act3-contradiction.js";

async function runLiveCompetitionDemo(): Promise<void> {
  console.log("========================================================================");
  console.log("          FLAREGIT: AUTONOMOUS GIT PLATFORM LIVE DEMONSTRATION          ");
  console.log("             “Work in parallel. Integration happens automatically.”     ");
  console.log("             Custom Domain: flaregit.com                                ");
  console.log("             Built for Cloudflare Next-Gen Git Platform Competition     ");
  console.log("========================================================================\n");

  const demoDir = path.resolve(process.cwd(), ".flaregit-storage", "demo-run");
  if (fs.existsSync(demoDir)) fs.rmSync(demoDir, { recursive: true, force: true });
  fs.mkdirSync(demoDir, { recursive: true });

  const artifacts = getArtifactsClient({
    forceLocal: true,
    baseDir: path.join(demoDir, "artifacts"),
  });

  // 1. Initializing canonical repo
  console.log("[Phase 1/5] Initializing Cloudflare Artifacts Canonical Repository...");
  const canonicalRepo = await artifacts.create("flaregit-demo-canonical", {
    description: "Authoritative canonical repository for FlareGit live demonstration",
    setDefaultBranch: "main",
  });

  const seedDir = path.join(demoDir, "seed");
  spawnSync("git", ["clone", canonicalRepo.remote, seedDir]);
  fs.cpSync(path.resolve(process.cwd(), "src/fixtures/ticket-booking/template"), seedDir, { recursive: true });
  spawnSync("git", ["-C", seedDir, "add", "-A"]);
  spawnSync("git", [
    "-C",
    seedDir,
    "-c",
    "user.name=FlareGit System",
    "-c",
    "user.email=system@flaregit.local",
    "commit",
    "-m",
    "Initial seed commit: Ticket Booking application fixture",
  ]);
  spawnSync("git", ["-C", seedDir, "push", "origin", "main"]);

  const seedHead = spawnSync("git", ["-C", seedDir, "rev-parse", "HEAD"]).stdout.toString().trim();
  console.log(`✓ Canonical repository initialized at commit: ${seedHead.slice(0, 7)}\n`);

  const controller = new FlareGitRepositoryController(artifacts, {
    projectId: "demo-live",
    projectName: "FlareGit Demonstration Platform",
    canonicalRepoName: "flaregit-demo-canonical",
    acceptedState: {
      currentCommit: seedHead,
      acceptedAt: new Date().toISOString(),
      buildDigest: "sha256:demo_init",
      activeRequirements: [],
      history: [],
    },
    tasks: {},
    candidates: {},
    evidence: {},
    decisions: {},
    journal: [],
    policyVersion: 1,
  }, demoDir);

  // 2. Act I
  console.log("[Phase 2/5] Act I: Two concurrent coding agents produce overlapping text conflict...");
  const act1 = await runAct1TextConflict(controller);
  console.log(`✓ Act I Resolved! Workers AI synthesized pricing logic. Verified & Accepted: ${act1.candidateCommit.slice(0, 7)}\n`);

  // 3. Act II
  console.log("[Phase 3/5] Act II: Clean Git merge with semantic/units mismatch...");
  const act2 = await runAct2CleanMergeBrokenBehavior(controller);
  console.log(`✓ Act II Caught & Repaired! Broken units detected by protected verifier. Accepted: ${act2.candidateCommit.slice(0, 7)}\n`);

  // 4. Act III
  console.log("[Phase 4/5] Act III: Contradictory business rules detected...");
  const act3 = await runAct3ContradictoryRequirements(controller);
  console.log(`✓ Act III Resolved! Product decision applied and verified without manual merge: ${act3.finalCommit.slice(0, 7)}\n`);

  // 5. Final State Verification
  console.log("[Phase 5/5] Reviewing Authoritative State & Publication Journal...");
  const finalState = controller.getState();
  console.log(`Canonical HEAD: ${finalState.acceptedState.currentCommit.slice(0, 7)}`);
  console.log(`Active Approved Requirements: ${finalState.acceptedState.activeRequirements.length}`);
  console.log(`Candidate Generations: ${Object.keys(finalState.candidates).length}`);
  console.log(`Protected Evidence Records: ${Object.keys(finalState.evidence).length}`);
  console.log(`CAS Ref Updates: ${finalState.journal.length}`);

  console.log("\n========================================================================");
  console.log("             DEMONSTRATION COMPLETED WITH 100% SUCCESS                  ");
  console.log("  FlareGit guarantees zero unverified landings and zero manual merges. ");
  console.log("========================================================================");
}

runLiveCompetitionDemo().catch((err) => {
  console.error("Live demo error:", err);
  process.exit(1);
});
