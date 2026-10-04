import { z } from "zod";
import type { Identity } from "./access";
import { invitationReturnCookie, openInvitationReturn, readInvitationReturnCookie, sealInvitationReturn } from "./invitation-return";
interface Dependencies { master?: string; allowedOrigins: string; limit(ip: string): Promise<boolean>; authenticate(): Promise<Identity | Response>; role(projectId: string, actorId: string): Promise<string | null> }
const nonceSchema = z.object({ nonce: z.uuid() }).strict();
const prepareSchema = z.object({ nonce: z.uuid(), projectId: z.string().regex(/^[a-z0-9]{12,16}$/), token: z.string().regex(/^[a-f0-9]{48}$/) }).strict();
export async function invitationReturnHttp(request: Request, deps: Dependencies): Promise<Response> {
  const respond = (data: unknown, status = 200, cookie?: string) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", ...(cookie ? { "Set-Cookie": cookie } : {}) } });
  const url = new URL(request.url), action = url.pathname.split("/").at(-1);
  if (request.method !== "POST") return respond({ error: "Use the invitation return action" }, 405);
  if (url.protocol !== "https:" || url.search || request.headers.get("Origin") !== url.origin || request.headers.get("Sec-Fetch-Site") !== "same-origin" || !deps.allowedOrigins.split(",").map(value => value.trim()).includes(url.origin)) return respond({ error: "Same-origin invitation return required" }, 403);
  const ip = request.headers.get("CF-Connecting-IP");
  try { if (!ip || !await deps.limit(ip)) return respond({ error: "Invitation return capacity unavailable. Retry shortly." }, 429); }
  catch { return respond({ error: "Invitation return admission is unavailable. Keep the original invitation link." }, 503); }
  if (request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return respond({ error: "Invitation return requires JSON" }, 415);
  let body: unknown;
  const reader = request.body?.getReader();
  if (!reader) return respond({ error: "Invitation return body required" }, 400);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Invitation return body timed out")), 10_000); });
  try {
    let size = 0; const chunks: Uint8Array[] = [];
    while (true) {
      const part = await Promise.race([reader.read(), timedOut]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1024) throw Error("Body too large");
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch { void reader.cancel().catch(() => undefined); return respond({ error: "Invalid or unavailable invitation return body" }, 400); }
  finally { clearTimeout(deadline); }
  if (!deps.master || new TextEncoder().encode(deps.master).length < 32) return respond({ error: "Invitation sign-in recovery is unavailable. Keep the original invitation link." }, 503);
  try {
    if (action === "prepare") {
      const input = prepareSchema.parse(body);
      const existing = (request.headers.get("Cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith("__Host-flaregit-invitation-return-"));
      if (existing.length >= 4 && !existing.some(value => value.startsWith(`__Host-flaregit-invitation-return-${input.nonce}=`))) return respond({ error: "Finish or cancel an earlier invitation before opening another." }, 409);
      if (existing.some(value => value.startsWith(`__Host-flaregit-invitation-return-${input.nonce}=`))) { const old = await openInvitationReturn(deps.master, url.origin, readInvitationReturnCookie(request, input.nonce), input.nonce); if (old.projectId !== input.projectId || old.token !== input.token) return respond({ error: "Original invitation return scope changed. Reopen the intended invitation." }, 409); }
      const sealed = await sealInvitationReturn(deps.master, url.origin, input);
      return respond({ nonce: input.nonce, prepared: true }, 200, invitationReturnCookie(sealed, input.nonce));
    }
    const parsed = action === "clear" ? z.object({ nonce: z.uuid(), reason: z.enum(["joined", "cancel"]), projectId: z.string().regex(/^[a-z0-9]{12,16}$/).optional() }).strict().parse(body) : nonceSchema.parse(body);
    if (!["confirm", "resume", "clear"].includes(action ?? "")) return respond({ error: "Unknown invitation return action" }, 404);
    if ((action === "resume" || action === "clear" && "reason" in parsed && parsed.reason === "joined") && request.headers.get("Authorization")?.startsWith("Bearer fgt_")) return respond({ error: "A current signed-in human session is required" }, 403);
    // Human authentication precedes decrypting or returning a private invitation.
    const actor = action === "resume" || action === "clear" && "reason" in parsed && parsed.reason === "joined" ? await deps.authenticate() : null;
    if (actor instanceof Response) { const headers = new Headers(actor.headers); headers.set("Cache-Control", "no-store"); headers.set("Referrer-Policy", "no-referrer"); return new Response(actor.body, { status: actor.status, headers }); }
    if (actor?.viaToken || actor && (!actor.expiresAt || actor.expiresAt <= Date.now())) return respond({ error: "A current signed-in human session is required" }, 403);
    const cookieName = invitationReturnCookie(null, parsed.nonce).split("=")[0]!;
    const cookiePresent = (request.headers.get("Cookie") ?? "").split(";").some(value => value.trim().startsWith(`${cookieName}=`));
    if (action === "clear" && !cookiePresent) {
      if ("reason" in parsed && parsed.reason === "joined") {
        if (!actor) return respond({ error: "A current human session is required" }, 403);
        const fresh = await deps.authenticate(); if (fresh instanceof Response || fresh.viaToken || fresh.id !== actor.id || !fresh.expiresAt || fresh.expiresAt <= Date.now()) return respond({ error: "Joining session changed" }, 409);
      }
      // This proves only this nonce cookie is absent, not an invitation or membership.
      return respond({ cookieAbsent: true, nonce: parsed.nonce }, 200, invitationReturnCookie(null, parsed.nonce));
    }
    const context = await openInvitationReturn(deps.master, url.origin, readInvitationReturnCookie(request, parsed.nonce), parsed.nonce);
    if (action === "confirm") return respond({ nonce: context.nonce, confirmed: true });
    if (action === "clear") {
      if ("reason" in parsed && parsed.reason === "joined") { if (!actor || !("projectId" in parsed) || parsed.projectId !== context.projectId || !await deps.role(context.projectId, actor.id)) return respond({ error: "Membership is not confirmed" }, 409); }
      if (actor) { const fresh = await deps.authenticate(); if (fresh instanceof Response || fresh.viaToken || fresh.id !== actor.id || !fresh.expiresAt || fresh.expiresAt <= Date.now()) return respond({ error: "Joining session changed" }, 409); }
      return respond({ cleared: true, nonce: context.nonce }, 200, invitationReturnCookie(null, context.nonce));
    }
    const fresh = await deps.authenticate();
    if (!actor || fresh instanceof Response || fresh.viaToken || fresh.id !== actor.id || !fresh.expiresAt || fresh.expiresAt <= Date.now()) return respond({ error: "Joining session changed" }, 409);
    return respond({ nonce: context.nonce, projectId: context.projectId, token: context.token });
  } catch { return respond({ error: "Invitation sign-in context expired, was replaced, or could not be confirmed. Reopen the original invitation." }, 409); }
}
