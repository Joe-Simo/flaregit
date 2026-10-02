import type { IntegrationCapability } from "./integration-auth.js";

export interface ServiceReadSignature { method: string; path: string; timestamp: number; nonce: string }
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
function message(input: ServiceReadSignature): string {
  if (input.method !== "GET" || !input.path.startsWith("/") || /[\x00-\x20\x7f]/.test(input.path) || !Number.isSafeInteger(input.timestamp) || !NONCE.test(input.nonce)) throw new Error("Invalid signed service read");
  return `flaregit-read-candidate-v1\n${input.method}\n${input.path}\n${input.timestamp}\n${input.nonce}`;
}
async function digest(secret: string, input: ServiceReadSignature): Promise<Uint8Array> {
  if (secret.length < 32) throw new Error("Service signing secret is not configured securely");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message(input))));
}
export async function signServiceRead(secret: string, input: ServiceReadSignature): Promise<string> {
  return [...await digest(secret, input)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
/** Verify the exact request path INCLUDING query string. The repository ledger
 * must atomically reject a reused (serviceId,nonce), recheck active capability,
 * and release only the exact frozen candidate's service-assigned metadata.
 */
export async function verifyServiceRead(input: ServiceReadSignature & { secret: string; signature: string; capabilities: readonly IntegrationCapability[]; now?: number }): Promise<boolean> {
  if (!input.capabilities.includes("read-candidate") || !/^[0-9a-f]{64}$/.test(input.signature) || Math.abs(Math.floor((input.now ?? Date.now()) / 1000) - input.timestamp) > 300) return false;
  let expected: Uint8Array;
  try { expected = await digest(input.secret, input); } catch { return false; }
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected[index]! ^ Number.parseInt(input.signature.slice(index * 2, index * 2 + 2), 16);
  return difference === 0;
}
