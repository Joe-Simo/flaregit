import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { ArtifactsClient } from "../artifacts/types.js";
import { isolateTaskWorkspace } from "./pipeline/isolate.js";
import { recordCheckpoint } from "./pipeline/checkpoint.js";
import { detectCompatibility, type DetectionResult } from "./pipeline/detect.js";
import { freezeCandidateGeneration } from "./pipeline/freeze.js";
import { composeCandidateCommits } from "./pipeline/compose.js";
import { repairCandidate } from "./pipeline/repair.js";
import { verifyCandidateCommit } from "./pipeline/verify.js";
import { publishAcceptedCandidate } from "./pipeline/accept.js";
import { detectContradiction, createProductDecision } from "./decision/contradiction.js";
import type {
  FlareGitProjectState,
  CandidateGeneration,
  ProductDecision,
  Requirement,
  Task,
  VerificationEvidence,
} from "./types.js";

export type EventSubscriber = (event: { type: string; payload: unknown }) => void;

export class FlareGitRepositoryController {
  private state: FlareGitProjectState;
  private readonly artifacts: ArtifactsClient;
  private readonly storageDir: string;
  private subscribers: Set<EventSubscriber> = new Set();
  private isProcessingIntegration = false;

  constructor(
    artifacts: ArtifactsClient,
    initialState: FlareGitProjectState,
    storageDir?: string
  ) {
    this.artifacts = artifacts;
    this.state = initialState;
    this.storageDir =
      storageDir ?? path.resolve(process.cwd(), ".flaregit-storage", "projects", initialState.projectId);

    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  getState(): FlareGitProjectState {
    return JSON.parse(JSON.stringify(this.state));
  }

  subscribe(subscriber: EventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  private emit(type: string, payload: unknown): void {
    for (const sub of this.subscribers) {
      try {
        sub({ type, payload });
      } catch (err) {
        console.error("Subscriber error:", err);
      }
    }
  }

  // 1. Create a new task (agent or human)
  async createTask(opts: {
    taskId: string;
    goal: string;
    contributorName: string;
    contributorType: "human" | "agent";
    requirements?: Requirement[];
  }): Promise<Task> {
    const baseCommit = this.state.acceptedState.currentCommit;

    const task = await isolateTaskWorkspace(this.artifacts, {
      projectId: this.state.projectId,
      taskId: opts.taskId,
      goal: opts.goal,
      contributorName: opts.contributorName,
      contributorType: opts.contributorType,
      canonicalRepoName: this.state.canonicalRepoName,
      baseCommit,
    });

    if (opts.requirements) {
      task.requirements = opts.requirements;
    }

    this.state.tasks[task.id] = task;
    this.emit("task.created", task);
    return task;
  }

  // 2. Ingest Checkpoint
  recordTaskCheckpoint(opts: {
    taskId: string;
    message?: string;
    isReadyForIntegration: boolean;
  }): Task {
    const task = this.state.tasks[opts.taskId];
    if (!task) throw new Error(`Task ${opts.taskId} not found`);

    const { task: updatedTask, checkpoint } = recordCheckpoint({
      task,
      message: opts.message,
      isReadyForIntegration: opts.isReadyForIntegration,
    });

    this.state.tasks[opts.taskId] = updatedTask;
    this.emit("task.checkpointed", { task: updatedTask, checkpoint });

    return updatedTask;
  }

  // 3. Early Compatibility Analysis
  analyzeCompatibility(taskA_id: string, taskB_id: string): DetectionResult {
    const taskA = this.state.tasks[taskA_id];
    const taskB = this.state.tasks[taskB_id];
    if (!taskA || !taskB) throw new Error("Tasks not found");

    const baseCommit = this.state.acceptedState.currentCommit;
    const repoDir = taskA.workspace.localPath!;
    const sourceB = taskB.workspace.localPath ?? taskB.workspace.remote;

    const result = detectCompatibility(baseCommit, taskA, taskB, repoDir, sourceB);
    this.emit("compatibility.analyzed", { taskA_id, taskB_id, result });
    return result;
  }

  // 4. Run Integration Pipeline for ready tasks
  async runIntegrationPipeline(
    taskIds: [string, string],
    policyOverride?: {
      groupDiscountPercent?: number;
      minTicketsForDiscount?: number;
      refundFeePerTicket?: number;
      discountAppliesToRefundFee?: boolean;
    }
  ): Promise<{
    success: boolean;
    candidate: CandidateGeneration;
    evidence?: VerificationEvidence;
    decision?: ProductDecision;
    error?: string;
  }> {
    if (this.isProcessingIntegration) {
      throw new Error("Another integration operation is currently in progress.");
    }
    this.isProcessingIntegration = true;

    try {
      const [idA, idB] = taskIds;
      const taskA = this.state.tasks[idA];
      const taskB = this.state.tasks[idB];
      if (!taskA || !taskB) throw new Error("Tasks not found for integration");

      taskA.status = "integrating";
      taskB.status = "integrating";
      this.emit("task.status_changed", { taskIds, status: "integrating" });

      // Step 1: Check for contradictory requirements
      const combinedReqs = [...taskA.requirements, ...taskB.requirements];
      for (const reqA of taskA.requirements) {
        for (const reqB of taskB.requirements) {
          if (detectContradiction(reqA, reqB)) {
            const decision = createProductDecision(reqA, reqB);
            this.state.decisions[decision.id] = decision;
            taskA.status = "needs_decision";
            taskB.status = "needs_decision";
            this.emit("decision.needed", decision);
            return {
              success: false,
              candidate: freezeCandidateGeneration({
                tasks: [taskA, taskB],
                acceptedBaseCommit: this.state.acceptedState.currentCommit,
                policyVersion: this.state.policyVersion,
                approvedRequirements: this.state.acceptedState.activeRequirements,
              }),
              decision,
              error: "Contradictory requirements detected. Paused for product decision.",
            };
          }
        }
      }

      // Step 2: Freeze candidate generation inputs
      const candidate = freezeCandidateGeneration({
        tasks: [taskA, taskB],
        acceptedBaseCommit: this.state.acceptedState.currentCommit,
        policyVersion: this.state.policyVersion,
        approvedRequirements: [
          ...this.state.acceptedState.activeRequirements,
          ...combinedReqs,
        ],
      });
      this.state.candidates[candidate.id] = candidate;
      this.emit("candidate.frozen", candidate);

      // Step 3: Compose using native Git
      const repoDir = taskA.workspace.localPath!;
      const sourceB = taskB.workspace.localPath ?? taskB.workspace.remote;
      const composeResult = composeCandidateCommits(
        repoDir,
        candidate.id,
        candidate.expectedAcceptedBase,
        taskA.currentCommit,
        taskB.currentCommit,
        taskA.contributor.name,
        taskB.contributor.name,
        sourceB
      );

      candidate.compositionMethod = composeResult.compositionMethod;

      let candidateCommit = composeResult.candidateCommit;

      // Step 4: If textual merge conflict, execute Step F (Repair)
      if (!composeResult.isClean || !candidateCommit) {
        this.emit("candidate.repairing", {
          candidateId: candidate.id,
          round: 1,
          conflictingFiles: composeResult.conflictingFiles,
        });

        const repairResult = await repairCandidate({
          repoDir,
          candidate,
          taskA,
          taskB,
          round: 1,
          conflictType: "text_conflict",
          conflictingFiles: composeResult.conflictingFiles,
          conflictDiff: composeResult.conflictDiff,
        });

        candidate.repairAttempts.push(repairResult.attempt);

        if (!repairResult.success || !repairResult.candidateCommit) {
          candidate.status = "failed";
          candidate.failureBlocker = repairResult.error;
          taskA.status = "blocked";
          taskB.status = "blocked";
          this.emit("candidate.failed", candidate);
          return { success: false, candidate, error: repairResult.error };
        }

        candidateCommit = repairResult.candidateCommit;
        candidate.candidateCommit = candidateCommit;
        candidate.compositionMethod = "repaired_merge";
      } else {
        candidate.candidateCommit = candidateCommit;
      }

      // Step 5: Protected Verification
      candidate.status = "verifying";
      taskA.status = "verifying";
      taskB.status = "verifying";
      this.emit("candidate.verifying", candidate);

      const policy = policyOverride ?? {
        groupDiscountPercent: 0.15,
        minTicketsForDiscount: 4,
        refundFeePerTicket: 5.0,
        discountAppliesToRefundFee: false,
      };

      let verifyResult = await verifyCandidateCommit({
        repoDir,
        candidate,
        policy,
      });

      // If behavioral check failed on a clean merge (Act II), attempt behavioral repair!
      if (!verifyResult.passed) {
        this.emit("candidate.repairing", {
          candidateId: candidate.id,
          round: 2,
          reason: "Protected behavior check failed after clean merge",
        });

        const failingFiles = ["src/catalog.ts", "src/pricing.ts"];
        const behaviorRepairResult = await repairCandidate({
          repoDir,
          candidate,
          taskA,
          taskB,
          round: 2,
          conflictType: "behavior_failure",
          conflictingFiles: failingFiles,
          failureEvidence: verifyResult.evidence,
        });

        candidate.repairAttempts.push(behaviorRepairResult.attempt);

        if (!behaviorRepairResult.success || !behaviorRepairResult.candidateCommit) {
          candidate.status = "failed";
          candidate.failureBlocker = "Behavioral verification check failed and repair was unsuccessful.";
          taskA.status = "blocked";
          taskB.status = "blocked";
          this.emit("candidate.failed", candidate);
          return {
            success: false,
            candidate,
            evidence: verifyResult.evidence,
            error: candidate.failureBlocker,
          };
        }

        candidate.candidateCommit = behaviorRepairResult.candidateCommit;
        // Re-verify exact repaired commit!
        verifyResult = await verifyCandidateCommit({
          repoDir,
          candidate,
          policy,
        });

        if (!verifyResult.passed) {
          candidate.status = "failed";
          candidate.failureBlocker = "Repaired candidate failed reverification.";
          taskA.status = "blocked";
          taskB.status = "blocked";
          this.emit("candidate.failed", candidate);
          return {
            success: false,
            candidate,
            evidence: verifyResult.evidence,
            error: candidate.failureBlocker,
          };
        }
      }

      // Candidate verified! Record evidence
      candidate.status = "verified";
      candidate.evidenceId = verifyResult.evidence.id;
      this.state.evidence[verifyResult.evidence.id] = verifyResult.evidence;
      this.emit("candidate.verified", { candidate, evidence: verifyResult.evidence });

      // Step 6: Exact-Version Acceptance and CAS publication
      const canonicalHandle = await this.artifacts.get(this.state.canonicalRepoName);
      const canonicalInfo = await canonicalHandle.info();
      const canonicalRepoDir = canonicalInfo.remote;

      const publishResult = publishAcceptedCandidate({
        canonicalRepoDir,
        candidate,
        evidence: verifyResult.evidence,
        currentCanonicalHead: this.state.acceptedState.currentCommit,
        tasks: [taskA, taskB],
        candidateRepoDir: repoDir,
      });

      this.state.journal.push(publishResult.journalEntry);

      if (!publishResult.success || !publishResult.acceptanceRecord) {
        if (publishResult.staleBase) {
          candidate.status = "stale";
          this.emit("candidate.stale", candidate);
        } else {
          candidate.status = "failed";
          candidate.failureBlocker = publishResult.error;
          this.emit("candidate.failed", candidate);
        }
        return {
          success: false,
          candidate,
          evidence: verifyResult.evidence,
          error: publishResult.error,
        };
      }

      // Step 7: Update Authoritative Accepted State
      candidate.status = "accepted";
      taskA.status = "accepted";
      taskB.status = "accepted";

      this.state.acceptedState.currentCommit = publishResult.acceptanceRecord.commit;
      this.state.acceptedState.buildDigest = publishResult.acceptanceRecord.outputDigest;
      this.state.acceptedState.acceptedAt = publishResult.acceptanceRecord.acceptedAt;
      this.state.acceptedState.history.push(publishResult.acceptanceRecord);

      for (const req of combinedReqs) {
        if (!this.state.acceptedState.activeRequirements.some((r) => r.id === req.id)) {
          this.state.acceptedState.activeRequirements.push(req);
        }
      }

      this.emit("candidate.accepted", {
        candidate,
        record: publishResult.acceptanceRecord,
        acceptedState: this.state.acceptedState,
      });

      return {
        success: true,
        candidate,
        evidence: verifyResult.evidence,
      };
    } finally {
      this.isProcessingIntegration = false;
    }
  }

  // 5. Resolve Product Decision (Act III)
  async resolveProductDecision(
    decisionId: string,
    selectedOptionId: string
  ): Promise<{ decision: ProductDecision; appliedPolicy: any }> {
    const decision = this.state.decisions[decisionId];
    if (!decision) throw new Error(`Decision ${decisionId} not found`);

    decision.selectedOptionId = selectedOptionId;
    decision.status = "resolved";
    decision.resolvedAt = new Date().toISOString();

    const [reqA_id, reqB_id] = decision.conflictingRequirementIds;
    // Supersede the rejected requirement across tasks
    for (const task of Object.values(this.state.tasks)) {
      task.requirements = task.requirements.filter((r) => {
        if (selectedOptionId === "discount_tickets_only" && r.id === reqA_id) {
          r.status = "superseded";
          return false;
        }
        if (selectedOptionId === "discount_includes_refund" && r.id === reqB_id) {
          r.status = "superseded";
          return false;
        }
        return true;
      });
    }

    const discountAppliesToRefundFee = selectedOptionId === "discount_includes_refund";

    this.emit("decision.resolved", { decision, discountAppliesToRefundFee });

    return {
      decision,
      appliedPolicy: {
        groupDiscountPercent: 0.15,
        minTicketsForDiscount: 4,
        refundFeePerTicket: 5.0,
        discountAppliesToRefundFee,
      },
    };
  }
}

