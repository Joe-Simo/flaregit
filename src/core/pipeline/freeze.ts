import * as crypto from "node:crypto";
import {assertCompatibleAcceptedTargetBatch,type FrozenAcceptedTarget} from "../accepted-target.js";
import type { CandidateGeneration, Requirement, Task } from "../types.js";

export interface FreezeCandidateOptions {
  acceptedTarget?: FrozenAcceptedTarget;
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
  let acceptedTarget: FrozenAcceptedTarget | undefined;
  if (opts.acceptedTarget) {
    if (opts.tasks.length === 0) throw new Error("An explicit accepted target requires contributions");
    const taskTargets = opts.tasks.map(task => {
      if (!task.acceptedTarget) throw new Error("Every contribution needs the same explicit accepted target");
      return task.acceptedTarget;
    });
    acceptedTarget = assertCompatibleAcceptedTargetBatch([
      opts.acceptedTarget,
      ...taskTargets,
      {...opts.acceptedTarget, acceptedCommit:opts.acceptedBaseCommit, policyVersion:opts.policyVersion, policy:opts.verificationPolicy},
    ]);
    const mergedRequirements = [...acceptedTarget.requirements, ...opts.tasks.flatMap(task => task.requirements)].filter(requirement => requirement.status === "approved");
    assertCompatibleAcceptedTargetBatch([
      {...acceptedTarget, requirements:mergedRequirements},
      {...acceptedTarget, requirements:opts.approvedRequirements},
    ]);
  } else if (opts.tasks.some(task => task.acceptedTarget !== undefined)) {
    throw new Error("An explicit contribution target cannot fall back to primary compatibility");
  }
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
    ...(acceptedTarget ? {acceptedTarget:structuredClone(acceptedTarget)} : {}),
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
