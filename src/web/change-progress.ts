import type { CandidateGeneration, Task } from "@/core/types";
import type { ChangeStepId } from "./lib/glossary";

export interface ChangeProgress {
  step: ChangeStepId;
  /** The newest combined preview that includes this change, when one exists. */
  previewId?: string;
  /** True when the change is stopped at its step (blocked, failed or cancelled). */
  halted: boolean;
}

/** Derives the single lifecycle position of a change from recorded task and preview state only. */
export function changeProgress(task: Task, previews: Record<string, CandidateGeneration>): ChangeProgress {
  const latest = Object.values(previews)
    .filter(preview => preview.participatingTaskIds.includes(task.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const previewId = latest?.id;
  if (task.status === "accepted") return { step: "merged", previewId, halted: false };
  if (task.status === "cancelled") return { step: "contribution", previewId, halted: true };
  if (task.status === "needs_decision") return { step: "review", previewId, halted: false };
  if (task.status === "integrating" || task.status === "verifying") {
    const awaitingHuman = latest !== undefined && (latest.status === "awaiting_review" || latest.status === "verified");
    return { step: awaitingHuman ? "review" : "verifying", previewId, halted: latest?.status === "failed" };
  }
  if (task.status === "ready") return { step: "ready", previewId, halted: false };
  if (task.status === "blocked") return { step: task.currentCommit ? "ready" : "contribution", previewId, halted: true };
  return { step: "contribution", previewId, halted: false };
}
