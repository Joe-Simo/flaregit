import { z } from "zod";
const ack = z.object({ nonce: z.uuid(), prepared: z.literal(true) }).strict();
const confirmation = z.object({ nonce: z.uuid(), confirmed: z.literal(true) }).strict();
export const invitationClearReceipt = z.union([z.object({ nonce: z.uuid(), cleared: z.literal(true) }).strict(), z.object({ nonce: z.uuid(), cookieAbsent: z.literal(true) }).strict()]);
/** Invitation bearers are sent only in same-origin request bodies; never persist them. */
export async function prepareInvitationSignIn(projectId: string, token: string, signal: AbortSignal, nonce = crypto.randomUUID()): Promise<string> {
  const post = async (action: string, body: unknown) => {
    const response = await fetch(`/api/join-return/${action}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    if (!response.ok) throw Error("Invitation sign-in recovery was not confirmed");
    return response.json() as Promise<unknown>;
  };
  if (ack.parse(await post("prepare", { nonce, projectId, token })).nonce !== nonce) throw Error("Invitation context differs");
  if (confirmation.parse(await post("confirm", { nonce })).nonce !== nonce) throw Error("Invitation cookie was not confirmed");
  return `/join-resume?context=${nonce}`;
}
export async function cancelInvitationSignIn(nonce: string, signal: AbortSignal): Promise<void> {
  const response = await fetch("/api/join-return/clear", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce, reason: "cancel" }), signal });
  if (!response.ok) throw Error("Invitation cancellation unconfirmed");
  const saved = invitationClearReceipt.parse(await response.json());
  if (saved.nonce !== nonce) throw Error("Invitation cancellation scope differs");
}
