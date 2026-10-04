import { CompactEncrypt, compactDecrypt } from "jose";
import { z } from "zod";
export const INVITATION_RETURN_COOKIE = "__Host-flaregit-invitation-return";
const TTL = 900;
const contextSchema = z.object({ version: z.literal(1), nonce: z.uuid(), projectId: z.string().regex(/^[a-z0-9]{12,16}$/), token: z.string().regex(/^[a-f0-9]{48}$/), origin: z.string().url(), issuedAt: z.number().int(), expiresAt: z.number().int() }).strict();
export type InvitationReturnContext = z.infer<typeof contextSchema>;
const encode = new TextEncoder();
async function key(master: string, origin: string) {
  if (encode.encode(master).length < 32) throw Error("Invitation return encryption unavailable");
  const source = await crypto.subtle.importKey("raw", encode.encode(master), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: encode.encode(origin), info: encode.encode("flaregit-invitation-return-aes-gcm-v1") }, source, 256));
}
export async function sealInvitationReturn(master: string, origin: string, input: Pick<InvitationReturnContext, "nonce" | "projectId" | "token">, now = Math.floor(Date.now() / 1000)) {
  const value = contextSchema.parse({ ...input, version: 1, origin, issuedAt: now, expiresAt: now + TTL });
  return new CompactEncrypt(encode.encode(JSON.stringify(value))).setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "flaregit-invitation-return-v1", origin }).encrypt(await key(master, origin));
}
export async function openInvitationReturn(master: string, origin: string, sealed: string, nonce: string, now = Math.floor(Date.now() / 1000)): Promise<InvitationReturnContext> {
  if (sealed.length > 2000) throw Error("Invitation return unavailable");
  const result = await compactDecrypt(sealed, await key(master, origin), { keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
  if (result.protectedHeader.typ !== "flaregit-invitation-return-v1" || result.protectedHeader.origin !== origin) throw Error("Invitation return scope differs");
  const value = contextSchema.parse(JSON.parse(new TextDecoder().decode(result.plaintext)));
  if (value.origin !== origin || value.nonce !== nonce || value.issuedAt > now || value.expiresAt <= now || value.expiresAt - value.issuedAt !== TTL) throw Error("Invitation return expired or replaced");
  return value;
}
function cookieName(nonce: string) { z.uuid().parse(nonce); return `${INVITATION_RETURN_COOKIE}-${nonce}`; }
export function invitationReturnCookie(value: string | null, nonce: string): string { return `${cookieName(nonce)}=${value ?? ""}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${value === null ? 0 : TTL}`; }
export function readInvitationReturnCookie(request: Request, nonce: string): string {
  const name = cookieName(nonce);
  const matches = (request.headers.get("Cookie") ?? "").split(";").map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  if (matches.length !== 1) throw Error("Invitation return cookie unavailable");
  return matches[0]!.slice(name.length + 1);
}
