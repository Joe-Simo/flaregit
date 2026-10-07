import { apiFetch } from "./api";
import {z} from 'zod';

export type RecoveryDraft = { scope: string; commit: string; expectedGeneration: string | null; idempotencyKey: string };
interface RecoveryStorage{getItem(key:string):string|null;setItem(key:string,value:string):void}
const savedSchema=z.object({scope:z.string().min(1).max(512),commit:z.string().min(1).max(128),expectedGeneration:z.string().min(1).max(256).nullable(),idempotencyKey:z.uuid()}).strict();
const savedKey=(identity:string,scope:string)=>`flaregit.preview-generation.${JSON.stringify([identity,scope])}`;
export function readGenerationRecovery(storage:RecoveryStorage,identity:string,scope:string):RecoveryDraft|null{
 if(!identity)throw Error('Sign in before preparing a replacement preview.');
 const raw=storage.getItem(savedKey(identity,scope));if(raw===null)return null;if(raw.length>2048)throw Error('Saved replacement request is invalid.');
 const draft=savedSchema.parse(JSON.parse(raw));if(draft.scope!==scope)throw Error('Saved replacement scope changed.');return draft;
}
export function saveGenerationRecovery(storage:RecoveryStorage,identity:string,draft:RecoveryDraft):RecoveryDraft{
 const checked=savedSchema.parse(draft),prior=readGenerationRecovery(storage,identity,checked.scope);
 if(prior&&prior.commit===checked.commit&&prior.expectedGeneration===checked.expectedGeneration&&prior.idempotencyKey!==checked.idempotencyKey)throw Error('Recover the original replacement request first.');
 const key=savedKey(identity,checked.scope),raw=JSON.stringify(checked);storage.setItem(key,raw);if(storage.getItem(key)!==raw)throw Error('Replacement recovery could not be saved. No request was sent.');return checked;
}

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
