import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LocalGitArtifactsClient } from "../../src/artifacts/local-git.js";
import { FlareGitRepositoryController } from "../../src/core/controller.js";
import { seedCanonicalRepository } from "../../src/core/seed.js";
import { ticketBookingVerifier } from "../../src/fixtures/ticket-booking/verifier.js";
import { gitOrThrow } from "../../src/core/pipeline/git.js";
import type { ProtectedVerifier } from "../../src/core/verifier.js";
import type { RepairModel } from "../../src/core/pipeline/repair.js";
import type { FlareGitProjectState } from "../../src/core/types.js";

export const TEMPLATE = path.resolve(import.meta.dirname, "../../src/fixtures/ticket-booking/template");

export interface Harness {
  root: string;
  artifacts: LocalGitArtifactsClient;
  controller: FlareGitRepositoryController;
  canonicalDir: string;
  seedHead: string;
  head(): string;
  cleanup(): void;
}

export async function createHarness(opts: {
  model: RepairModel;
  verifier?: ProtectedVerifier;
  template?: string;
}): Promise<Harness> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flaregit-test-"));
  const artifacts = new LocalGitArtifactsClient(path.join(root, "artifacts"));
  const verifier = opts.verifier ?? ticketBookingVerifier;
  const seeded = await seedCanonicalRepository(artifacts, "canonical", opts.template ?? TEMPLATE);
  const state: FlareGitProjectState = {
    projectId: "test",
    projectName: "Test",
    canonicalRepoName: "canonical",
    acceptedState: {
      currentCommit: seeded.head,
      acceptedAt: new Date().toISOString(),
      buildDigest: "seed",
      activeRequirements: [],
      history: [],
    },
    tasks: {},
    candidates: {},
    evidence: {},
    decisions: {},
    journal: [],
    policyVersion: 1,
    verificationPolicy: { ...verifier.defaultPolicy },
  };
  const controller = new FlareGitRepositoryController(
    { artifacts, verifier, repairModel: opts.model, storageDir: path.join(root, "controller") },
    state
  );
  return {
    root,
    artifacts,
    controller,
    canonicalDir: seeded.remote,
    seedHead: seeded.head,
    head: () => gitOrThrow(seeded.remote, ["rev-parse", "refs/heads/main"], { gitDir: true }),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
