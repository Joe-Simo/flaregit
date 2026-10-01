import * as path from "node:path";
import { LocalGitArtifactsClient } from "../artifacts/local-git.js";
import { FlareGitRepositoryController } from "../core/controller.js";
import { seedCanonicalRepository } from "../core/seed.js";
import { WorkersAIClient } from "../ai/workers-ai.js";
import { ticketBookingVerifier } from "../fixtures/ticket-booking/verifier.js";
import type { FlareGitProjectState } from "../core/types.js";

const TEMPLATE = path.resolve(import.meta.dirname, "../fixtures/ticket-booking/template");

/** Local development runtime: real Git + real protected verification; models come from Workers AI. */
export async function createLocalRuntime(storageDir: string) {
  const artifacts = new LocalGitArtifactsClient(path.join(storageDir, "artifacts"));
  const ai = new WorkersAIClient({ gatewayId: process.env.CLOUDFLARE_AI_GATEWAY });
  const deps = { artifacts, verifier: ticketBookingVerifier, repairModel: ai.asModel(), storageDir: path.join(storageDir, "controller") };

  const restored = await FlareGitRepositoryController.restore(deps, "flaregit-local");
  if (restored) return { controller: restored, ai, artifacts };

  const seeded = await seedCanonicalRepository(artifacts, "flaregit-canonical", TEMPLATE, "Initial accepted version: ticket checkout");
  const state: FlareGitProjectState = {
    projectId: "flaregit-local",
    projectName: "Ticket checkout",
    canonicalRepoName: "flaregit-canonical",
    acceptedState: { currentCommit: seeded.head, acceptedAt: new Date().toISOString(), buildDigest: "seed", activeRequirements: [], history: [] },
    tasks: {},
    candidates: {},
    evidence: {},
    decisions: {},
    journal: [],
    policyVersion: 1,
    verificationPolicy: { ...ticketBookingVerifier.defaultPolicy },
  };
  return { controller: new FlareGitRepositoryController(deps, state), ai, artifacts };
}
