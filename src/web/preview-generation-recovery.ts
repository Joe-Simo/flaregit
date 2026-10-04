import { apiFetch } from "./api";

export type RecoveryDraft = { scope: string; commit: string; expectedGeneration: string | null; idempotencyKey: string };

/** Keep uncertain requests addressable until the displayed generation changes. */
export function generationRecoveryDraft(previous: RecoveryDraft | null, scope: string, commit: string, expectedGeneration: string | null): RecoveryDraft {
  return previous?.scope === scope && previous.commit === commit && previous.expectedGeneration === expectedGeneration
    ? previous
    : { scope, commit, expectedGeneration, idempotencyKey: crypto.randomUUID() };
}

export type RecoveryResult = { status: "requested" | "building" | "ready" | "failed" | "quarantined" | "forbidden" | "conflict"; detail?: string };

export async function requestGenerationRecovery(projectId: string, draft: RecoveryDraft): Promise<RecoveryResult> {
  const response = await apiFetch(`/api/p/${projectId}/preview/recover-generation`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commit: draft.commit, expectedGeneration: draft.expectedGeneration, idempotencyKey: draft.idempotencyKey }),
  });
  const message = await response.text();
  if (response.status === 403) return { status: "forbidden", detail: message };
  if (response.status === 409) return { status: "conflict", detail: message };
  if (!response.ok) throw new Error(message || `Request failed (${response.status})`);
  const confirmation: unknown = JSON.parse(message);
  if (response.status !== 202 || typeof confirmation !== "object" || confirmation === null || !("generationId" in confirmation) || typeof confirmation.generationId !== "string" || !confirmation.generationId || !("status" in confirmation) || typeof confirmation.status !== "string") {
    throw new Error("Replacement request was not confirmed. Check status before trying again.");
  }
  switch (confirmation.status) {
    case "requested": case "building": case "ready": case "failed": case "quarantined": return { status: confirmation.status };
    default: throw new Error("Replacement request was not confirmed. Check status before trying again.");
  }
}
