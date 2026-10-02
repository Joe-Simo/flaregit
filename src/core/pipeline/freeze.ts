import * as crypto from "node:crypto";
import type { CandidateGeneration, Requirement, Task } from "../types.js";

export interface FreezeCandidateOptions {
  tasks: Task[];
  acceptedBaseCommit: string;
  policyVersion: number;
  verificationPolicy: Record<string, unknown>;
  approvedRequirements: Requirement[];
  attemptNumber?: number;
}

export function freezeCandidateGeneration(
  opts: FreezeCandidateOptions
): CandidateGeneration {
  const participatingTaskIds = opts.tasks.map((t) => t.id);
  const participatingCommits: Record<string, string> = {};

  for (const task of opts.tasks) {
    participatingCommits[task.id] = task.currentCommit;
  }

  // Deep clone frozen requirements to guarantee immutability
  const frozenRequirements: Requirement[] = JSON.parse(
    JSON.stringify(opts.approvedRequirements)
  );

  const candidateId = `cand_${crypto.randomUUID()}`;

  const candidate: CandidateGeneration = {
    id: candidateId,
    attemptNumber: opts.attemptNumber ?? 1,
    participatingTaskIds,
    participatingCommits,
    expectedAcceptedBase: opts.acceptedBaseCommit,
    frozenPolicyVersion: opts.policyVersion,
    frozenVerificationPolicy: JSON.parse(JSON.stringify(opts.verificationPolicy)),
    frozenRequirements,
    repairAttempts: [],
    status: "composing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return candidate;
}
