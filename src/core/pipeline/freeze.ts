import * as crypto from "node:crypto";
import {acceptedTargetSchema,assertCompatibleAcceptedTargetBatch,assertFrozenRequirementsMatch,effectiveTaskAcceptedTarget,type FrozenAcceptedTarget} from "../accepted-target.js";
import type { CandidateGeneration, Requirement, Task } from "../types.js";

export interface FreezeCandidateOptions {
  acceptedTarget?: FrozenAcceptedTarget;
  tasks: Task[];
  acceptedBaseCommit: string | null;
  policyVersion: number;
  verificationPolicy: Record<string, unknown>;
  approvedRequirements: Requirement[];
  attemptNumber?: number;
}

export function freezeCandidateGeneration(
  opts: FreezeCandidateOptions
): CandidateGeneration {
  if(opts.acceptedBaseCommit===null&&!opts.acceptedTarget)throw Error("An unborn candidate requires its explicit recorded accepted target");
  if(opts.acceptedBaseCommit!==null&&/^0{40}$/.test(opts.acceptedBaseCommit))throw Error("Accepted candidate base must be a real commit or explicit unborn root");
  let acceptedTarget: FrozenAcceptedTarget | undefined;
  if (opts.acceptedTarget) {
    if (opts.tasks.length === 0) throw new Error("An explicit accepted target requires contributions");
    const taskTargets = opts.tasks.map(task => {
      const target=effectiveTaskAcceptedTarget(task);
      if (!target) throw new Error("Every contribution needs the same explicit accepted target");
      return target;
    });
    const contextTarget=acceptedTargetSchema.parse({...opts.acceptedTarget,acceptedCommit:opts.acceptedBaseCommit,policyVersion:opts.policyVersion,policy:opts.verificationPolicy});
    acceptedTarget = assertCompatibleAcceptedTargetBatch([opts.acceptedTarget,...taskTargets,contextTarget]);
    const mergedRequirements = [...acceptedTarget.requirements, ...opts.tasks.flatMap(task => task.requirements)].filter(requirement => requirement.status === "approved");
    assertFrozenRequirementsMatch(mergedRequirements,opts.approvedRequirements);
  } else if (opts.tasks.some(task => task.acceptedTarget !== undefined || task.targetGeneration !== undefined)) {
    throw new Error("An explicit contribution target cannot fall back to primary compatibility");
  }
  const participatingTaskIds = opts.tasks.map((t) => t.id);
  const participatingCommits: Record<string, string> = {};

  for (const task of opts.tasks) {
    if(!task.currentCommit||/^0{40}$/.test(task.currentCommit)||(opts.acceptedTarget!==undefined&&!/^[a-f0-9]{40}$/.test(task.currentCommit)))throw Error("A contribution requires a real checkpoint before review");
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
    ...(opts.tasks.some(task=>task.targetGeneration)?{participatingTargetGenerations:Object.fromEntries(opts.tasks.filter(task=>task.targetGeneration).map(task=>[task.id,structuredClone(task.targetGeneration!)]))}:{}),
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
