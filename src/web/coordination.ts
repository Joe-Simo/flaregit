import { useState } from "react";
import { z } from "zod";
import type { Task } from "@/core/types";
import { apiJson, isTransientReadFailure } from "./api";
import { useVisiblePolling } from "./use-visible-polling";
import { useRepositoryActivity } from "./repository-activity";

/** Client view of merge queue, requirement decisions and post-land updates (validated, never trusted raw). */

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const queueEntrySchema = z.object({
  taskId: z.string(), position: z.number().int(),
  status: z.enum(["queued", "landing", "landed", "waiting_rebase", "needs_decision", "awaiting_revision", "refused", "removed"]),
  checkedBase: sha.nullable(), checkedCommit: sha.nullable(), reason: z.string().nullable(), eventId: z.string().nullable(),
  attempts: z.number().int(), actorId: z.string(), requestId: z.string(), enqueuedAt: z.string(), updatedAt: z.string(),
  goal: z.string(), contributor: z.string(),
});
const proofSideSchema = z.object({
  taskId: z.string(), requirementId: z.string(), requirementTitle: z.string(), commit: sha,
  expected: z.unknown(), actual: z.unknown().optional(), error: z.string().optional(),
  meetsOwnRequirement: z.boolean(), meetsOtherRequirement: z.boolean(),
});
const proofSchema = z.object({
  version: z.literal(1), decisionId: z.string(), input: z.record(z.string(), z.unknown()),
  probe: z.object({ module: z.string(), export: z.string() }),
  sides: z.tuple([proofSideSchema, proofSideSchema]),
  verdict: z.enum(["proven", "not_reproduced", "execution_failed"]), summary: z.string(), executedAt: z.string(),
});
const revisionSchema = z.object({
  decisionId: z.string(), taskId: z.string(), winningRequirementId: z.string(), losingRequirementId: z.string(),
  startCommit: sha.nullable(), workflowId: z.string(),
  status: z.enum(["planned", "dispatched", "revised", "needs_author", "failed"]), reason: z.string().optional(), updatedAt: z.string(),
});
const updateSchema = z.object({
  taskId: z.string(), landedCommit: sha, fromCommit: sha, fromBase: sha,
  status: z.enum(["pending", "updated", "verification_failed", "conflict_revising", "needs_author", "skipped", "failed", "agent_waiting"]),
  overlappingFiles: z.array(z.string()), conflictingFiles: z.array(z.string()), newCommit: sha.nullable(),
  verification: z.object({ status: z.enum(["passed", "failed", "deferred"]), failures: z.array(z.object({ testId: z.string(), description: z.string(), message: z.string().optional() })) }).nullable(),
  reason: z.string(), workflowId: z.string(), revisionWorkflowId: z.string().nullable(), updatedAt: z.string(),
  retry: z.object({ refusal: z.enum(["budget", "transient", "access"]), refusedReason: z.string(), attempts: z.number().int(), nextAttemptAt: z.string().nullable() }).nullable().optional(),
});
export const coordinationViewSchema = z.object({
  queue: z.array(queueEntrySchema),
  decisions: z.array(z.object({ decisionId: z.string(), proof: proofSchema.nullable(), revisions: z.array(revisionSchema) })),
  updates: z.array(updateSchema),
});
export type CoordinationView = z.infer<typeof coordinationViewSchema>;
export type QueueEntryView = CoordinationView["queue"][number];
export type ProofView = z.infer<typeof proofSchema>;
export type RevisionView = z.infer<typeof revisionSchema>;
export type UpdateView = z.infer<typeof updateSchema>;

export const QUEUE_STATUS: Record<QueueEntryView["status"], { label: string; variant: "info" | "warning" | "success" | "destructive" | "purple" | "outline" | "secondary" }> = {
  queued: { label: "Waiting", variant: "secondary" },
  landing: { label: "Landing", variant: "info" },
  landed: { label: "Landed", variant: "success" },
  waiting_rebase: { label: "Updating to latest", variant: "warning" },
  needs_decision: { label: "Needs a decision", variant: "purple" },
  awaiting_revision: { label: "Being revised", variant: "warning" },
  refused: { label: "Refused", variant: "destructive" },
  removed: { label: "Removed", variant: "outline" },
};

export const UPDATE_STATUS: Record<UpdateView["status"], { label: string; variant: "info" | "warning" | "success" | "destructive" | "outline" }> = {
  pending: { label: "Updating onto latest", variant: "info" },
  updated: { label: "Up to date", variant: "success" },
  verification_failed: { label: "Checks fail after update", variant: "destructive" },
  conflict_revising: { label: "Conflict · agent redoing", variant: "warning" },
  needs_author: { label: "Author update needed", variant: "warning" },
  skipped: { label: "Not updated", variant: "outline" },
  failed: { label: "Update failed", variant: "destructive" },
  agent_waiting: { label: "Agent waiting to re-run", variant: "warning" },
};

type RunTask = Pick<Task, "status" | "baseCommit" | "agentWorkflowInstanceId" | "contributor">;

/** The change's agent re-run on the latest version started and then failed, leaving the change blocked. */
export function agentRunFailed(update: UpdateView, task?: RunTask): boolean {
  return Boolean(task && update.revisionWorkflowId !== null && (update.status === "conflict_revising" || update.status === "verification_failed") && task.contributor.type === "agent" && task.status === "blocked" && task.agentWorkflowInstanceId === update.revisionWorkflowId && task.baseCommit === update.landedCommit);
}

/** True when the agent's re-run on the latest version was refused or failed and can be sent again. */
export function canRunAgentAgain(update: UpdateView, task?: RunTask): boolean {
  return update.revisionWorkflowId !== null && (update.status === "agent_waiting" || update.status === "failed" && update.reason.startsWith("The agent could not be re-run") || agentRunFailed(update, task));
}

/** When FlareGit next tries on its own, in words. */
export function nextTryText(update: UpdateView, now = Date.now()): string | null {
  const at = update.retry?.nextAttemptAt;
  if (!at) return update.status === "agent_waiting" ? "FlareGit will not try again on its own." : null;
  const minutes = Math.max(1, Math.round((Date.parse(at) - now) / 60_000));
  return minutes >= 90 ? `FlareGit tries again in about ${Math.round(minutes / 60)} hours.` : `FlareGit tries again in about ${minutes} minutes.`;
}

/**
 * Background read cadence when nothing is reported live. Board activity refreshes sooner (coalesced),
 * and every caller shares one in-flight read per repository.
 */
export const COORDINATION_FALLBACK_INTERVAL_MS = 30_000;

/** Reads the coordination view on live-board activity, with a slow fallback read while the page is visible. */
export function useCoordination(projectId: string, enabled = true): { view: CoordinationView | null; error: string | null; refresh: () => Promise<void> } {
  const [loaded, setLoaded] = useState<{ projectId: string; view: CoordinationView } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useVisiblePolling({
    scope: projectId,
    enabled,
    intervalMs: COORDINATION_FALLBACK_INTERVAL_MS,
    read: async (signal) => coordinationViewSchema.parse(await apiJson<unknown>(`/p/${encodeURIComponent(projectId)}/coordination`, { signal })),
    onValue: (view) => { setLoaded({ projectId, view }); setError(null); },
    // Rate limiting and superseded reads recover on the next read; the last view stays shown meanwhile.
    onError: (cause) => isTransientReadFailure(cause) ? undefined : setError(cause instanceof Error ? cause.message : "Coordination status is unavailable"),
  });
  useRepositoryActivity(projectId, () => void refresh(), enabled);
  return { view: loaded?.projectId === projectId ? loaded.view : null, error, refresh };
}

/** Plain-language value for people: `{ total: 153 }` becomes `total 153`. */
export function plainValue(value: unknown): string {
  if (value === undefined) return "nothing";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value && typeof value === "object" && !Array.isArray(value)) return Object.entries(value).map(([key, item]) => `${humanKey(key)} ${plainValue(item)}`).join(", ") || "empty";
  return JSON.stringify(value) ?? String(value);
}

function humanKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
}
