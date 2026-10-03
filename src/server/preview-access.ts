import type { Env } from "./env.js";

/**
 * Preview links are capabilities: HMAC(version, audience, projectId, commit, expiry) with a Worker secret. Only members can mint
 * them (through the API), they expire, and builds are stored per repository, so a commit hash alone opens nothing.
 */
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function key(env: Env): Promise<CryptoKey> {
  if (!env.PREVIEW_SIGNING_KEY) throw new Error("PREVIEW_SIGNING_KEY is not configured");
  return crypto.subtle.importKey("raw", enc.encode(env.PREVIEW_SIGNING_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export const buildPrefix = (projectId: string, commit: string) => `builds/${projectId}/${commit}`;

export async function signPreview(env: Env, projectId: string, commit: string, audience: string, ttlSeconds = 3600): Promise<{ exp: number; sig: string }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { exp, sig: hex(await crypto.subtle.sign("HMAC", await key(env), enc.encode(JSON.stringify(["preview-v2", audience, projectId, commit, exp])))) };
}

export async function verifyPreview(env: Env, projectId: string, commit: string, audience: string, exp: number, sig: string): Promise<boolean> {
  if (!Number.isInteger(exp) || exp < Date.now() / 1000 || !/^[0-9a-f]{64}$/.test(sig)) return false;
  const bytes = Uint8Array.from(sig.match(/../g)!.map((h) => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", await key(env), bytes, enc.encode(JSON.stringify(["preview-v2", audience, projectId, commit, exp])));
}

/** Configuration is trusted operator input; malformed or ambiguous mappings fail closed. */
function previewSite(hostname: string): string {
  return hostname.endsWith(".workers.dev") ? hostname.split(".").slice(-3).join(".") : hostname;
}

function previewOrigins(env: Env, appOrigin?: string): Map<string, string> | null {
  if (!env.REPOSITORY_PREVIEW_ORIGINS) return null;
  try {
    const value: unknown = JSON.parse(env.REPOSITORY_PREVIEW_ORIGINS);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const protectedHosts = new Set<string>();
    for (const origin of [appOrigin, env.CLERK_ISSUER, ...(env.CLERK_AUTHORIZED_PARTIES ?? "").split(",")]) {
      if (origin?.trim()) protectedHosts.add(previewSite(new URL(origin.trim()).hostname.toLowerCase()));
    }
    const entries = new Map<string, string>();
    const usedHosts = new Set<string>();
    for (const [repository, origin] of Object.entries(value)) {
      if (!/^[a-z0-9]{12,16}$/.test(repository) || typeof origin !== "string") return null;
      const url = new URL(origin);
      // Each repository receives a distinct Worker origin; authenticated sites cannot share its account site.
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash
        || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.workers\.dev$/.test(url.hostname)
        || (origin !== url.origin && origin !== `${url.origin}/`)
        || usedHosts.has(url.hostname) || protectedHosts.has(previewSite(url.hostname))) return null;
      entries.set(repository, url.origin);
      usedHosts.add(url.hostname);
    }
    return entries;
  } catch {
    return null;
  }
}

export function repositoryPreviewOrigin(env: Env, projectId: string, appOrigin?: string): string | null {
  return previewOrigins(env, appOrigin)?.get(projectId) ?? null;
}

export function repositoryForPreviewOrigin(env: Env, origin: string, appOrigin?: string): string | null {
  const entries = previewOrigins(env, appOrigin);
  if (!entries) return null;
  for (const [repository, configured] of entries) if (configured === origin) return repository;
  return null;
}
