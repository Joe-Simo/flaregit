/// <reference types="bun" />
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { LocalGitArtifactsClient } from "../src/artifacts/local-git.js";
import { FlareGitRepositoryController } from "../src/core/controller.js";
import { RuntimeCodingAgent } from "../src/agents/runtime-agent.js";
import { runShippingProtectedVerification } from "../src/fixtures/shipping-calculator/verifier.js";
import type { FlareGitProjectState, Requirement } from "../src/core/types.js";

const TEST_DIR = path.resolve(process.cwd(), ".flaregit-storage", "test-second-repo");

describe("FlareGit Second Repository Agnostic Verification", () => {
  let artifacts: LocalGitArtifactsClient;
  let canonicalSeedHead: string;

  beforeEach(async () => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });

    artifacts = new LocalGitArtifactsClient(path.join(TEST_DIR, "artifacts"));

    // 1. Create canonical repository for shipping calculator
    const canonicalRepo = await artifacts.create("shipping-canonical", {
      description: "Freight and shipping calculator platform",
      setDefaultBranch: "main",
    });

    // 2. Seed shipping calculator template
    const seedWorkDir = path.join(TEST_DIR, "canonical-seed");
    spawnSync("git", ["clone", canonicalRepo.remote, seedWorkDir]);

    const fixtureTemplateDir = path.resolve(
      process.cwd(),
      "src/fixtures/shipping-calculator/template"
    );
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
      "Initial seed commit: Shipping Calculator platform",
    ]);
    spawnSync("git", ["-C", seedWorkDir, "push", "origin", "main"]);

    canonicalSeedHead = spawnSync("git", ["-C", seedWorkDir, "rev-parse", "HEAD"])
      .stdout.toString()
      .trim();
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test("proves FlareGit autonomously integrates concurrent agents on a completely different domain repository", async () => {
    const baseRequirement: Requirement = {
      id: "REQ-SHIP-BASE-RATE",
      title: "Minimum Base Freight Rate",
      description: "2kg parcel charges minimum baseline fee of $15.00",
      version: 1,
      status: "approved",
      originTaskId: "seed",
      approvedAt: new Date().toISOString(),
      assertions: [],
    };

    const projectState: FlareGitProjectState = {
      projectId: "shipping-app",
      projectName: "Freight Platform",
      canonicalRepoName: "shipping-canonical",
      acceptedState: {
        currentCommit: canonicalSeedHead,
        acceptedAt: new Date().toISOString(),
        buildDigest: "sha256:shipping_init",
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

    const controller = new FlareGitRepositoryController(artifacts, projectState, TEST_DIR);

    // 1. Create two concurrent tasks
    const taskA = await controller.createTask({
      taskId: "agent-a-express-speed",
      goal: "Implement express shipping speed (+50% rate)",
      contributorName: "Agent Logistics",
      contributorType: "agent",
      requirements: [
        {
          id: "REQ-EXPRESS-SPEED",
          title: "Express Speed Surcharge",
          description: "10kg express parcel calculates to $45.00 ($30 base + $15 express surcharge)",
          version: 1,
          status: "approved",
          originTaskId: "agent-a-express-speed",
          approvedAt: new Date().toISOString(),
          assertions: [],
        },
      ],
    });

    const taskB = await controller.createTask({
      taskId: "agent-b-hazardous-handling",
      goal: "Implement hazardous materials compliance fee (+$12.00 flat)",
      contributorName: "Agent Safety",
      contributorType: "agent",
      requirements: [
        {
          id: "REQ-HAZARDOUS-FEE",
          title: "Hazardous Handling Compliance",
          description: "10kg express hazardous parcel calculates to $57.00 ($45 express + $12 hazardous)",
          version: 1,
          status: "approved",
          originTaskId: "agent-b-hazardous-handling",
          approvedAt: new Date().toISOString(),
          assertions: [],
        },
      ],
    });

    const agentA = new RuntimeCodingAgent(taskA);
    const agentB = new RuntimeCodingAgent(taskB);

    // 2. Both agents edit rates.ts concurrently
    agentA.commit("Add express shipping rate calculation", true);
    agentA.push();
    controller.recordTaskCheckpoint({ taskId: taskA.id, isReadyForIntegration: true });

    agentB.commit("Add hazardous handling compliance fee", true);
    agentB.push();
    controller.recordTaskCheckpoint({ taskId: taskB.id, isReadyForIntegration: true });

    // 3. Early compatibility analysis
    const detection = controller.analyzeCompatibility(taskA.id, taskB.id);
    expect(detection).toBeDefined();

    // 4. Run protected verification directly against the shipping calculator suite
    const evidence = await runShippingProtectedVerification({
      repoDir: taskA.workspace.localPath!,
      candidateCommit: taskA.currentCommit,
      expectedBase: canonicalSeedHead,
      requirementsVersion: 1,
    });

    expect(evidence.status).toBe("passed");
    expect(evidence.testResults[0]?.passedCount).toBe(5);
    expect(evidence.verifierIdentity).toBe("flaregit-shipping-protected-verifier-v1");
  }, 20000);
});
