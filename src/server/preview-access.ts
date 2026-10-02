import type { Env } from "./env.js";

/**
 * Preview links are capabilities: HMAC(projectId, commit, expiry) with a Worker secret. Only members can mint
 * them (through the API), they expire, and builds are stored per repository, so a commit hash alone opens nothing.
 */
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function key(env: Env): Promise<CryptoKey> {
  if (!env.PREVIEW_SIGNING_KEY) throw new Error("PREVIEW_SIGNING_KEY is not configured");
  return crypto.subtle.importKey("raw", enc.encode(env.PREVIEW_SIGNING_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export const buildPrefix = (projectId: string, commit: string) => `builds/${projectId}/${commit}`;

export async function signPreview(env: Env, projectId: string, commit: string, ttlSeconds = 3600): Promise<{ exp: number; sig: string }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { exp, sig: hex(await crypto.subtle.sign("HMAC", await key(env), enc.encode(`${projectId}.${commit}.${exp}`))) };
}

export async function verifyPreview(env: Env, projectId: string, commit: string, exp: number, sig: string): Promise<boolean> {
  if (!Number.isInteger(exp) || exp < Date.now() / 1000 || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const bytes = Uint8Array.from(sig.match(/../g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", await key(env), bytes, enc.encode(`${projectId}.${commit}.${exp}`));
}
