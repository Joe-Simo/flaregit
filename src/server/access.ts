import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env.js";
import { accountOf } from "./projects.js";

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function keysFor(url: string) {
  let keys = jwks.get(url);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(url));
    jwks.set(url, keys);
  }
  return keys;
}

export interface Identity {
  /** Stable, unique subject (Clerk user id or Access subject); the tenant key is derived from it. */
  id: string;
  email?: string;
  /** Verified session expiry in milliseconds; personal tokens are rechecked by their stored hash. */
  expiresAt?: number;
  /** True when the request used a personal API token (such requests cannot create or manage tokens). */
  viaToken?: boolean;
  /** Set for API tokens: what the token may do and which repository it is pinned to. */
  tokenScope?: "full" | "read" | "write";
  tokenRepo?: string | null;
  oauthClientId?: string;
  oauthScopes?: readonly string[];
}

/**
 * Authenticates a customer request with a Clerk session token (Authorization: Bearer). Verifies signature,
 * issuer, expiry and authorized party. Fails closed when Clerk is not configured.
 */
export async function authenticate(request: Request, env: Env): Promise<Identity | Response> {
  const bearer = request.headers.get("Authorization");
  const raw = bearer?.startsWith("Bearer ") ? bearer.slice(7) : undefined;
  // Personal API token: fgt_<accountKey>_<secret>. The account instance holds the hash and the owning user id.
  if (raw?.startsWith("fgt_")) {
    const m = /^fgt_([0-9a-f]{12})_([A-Za-z0-9]{32,64})$/.exec(raw);
    if (!m) return new Response("Unauthorized", { status: 401 });
    const t = await accountOf(env, m[1]!).verifyApiToken(raw).catch(() => null);
    return t ? { id: t.userId, viaToken: true, tokenScope: t.scope, tokenRepo: t.repo } : new Response("Unauthorized", { status: 401 });
  }
  if (raw?.startsWith("fgo_")) {
    if (!/^fgo_[A-Za-z0-9_-]{43}$/.test(raw)) return new Response("Unauthorized", {status:401});
    const token = await env.AUTHORITY.get(env.AUTHORITY.idFromName("authority")).introspect(raw).catch(() => ({active:false as const}));
    if (!token.active || !token.repositoryId) return new Response("Unauthorized", {status:401});
    const url = new URL(request.url), match = /^\/api\/p\/([a-z0-9]{12,16})(\/.*)$/.exec(url.pathname);
    if (!match || match[1] !== token.repositoryId) return new Response("App access is limited to its installed repository", {status:403});
    const method=request.method, path=match[2]!;
    const read=method==="GET";
    const resource=/^\/issues(?:\/\d{1,7})?$/.test(path) && (read || path==="/issues" && method==="POST" || /^\/issues\/\d{1,7}$/.test(path) && method==="PATCH") ? "issues" : /^\/candidates\/[a-z0-9_-]+\/checks$/.test(path) && (read || method==="POST") ? "checks" : null;
    if (!resource || !token.scopes.includes(`${resource}:${read?"read":"write"}`)) return new Response("App scope does not permit this operation", {status:403});
    return {id:token.userId,viaToken:true,tokenScope:read?"read":"write",tokenRepo:token.repositoryId,oauthClientId:token.clientId,oauthScopes:token.scopes,expiresAt:token.expiresAt};
  }
  if (!env.CLERK_ISSUER) return new Response("Authentication is not configured", { status: 503 });
  const allowed = (env.CLERK_AUTHORIZED_PARTIES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return new Response("Authentication authorized parties are not configured", { status: 503 });
  const header = request.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) return new Response("Unauthorized", { status: 401 });
  try {
    const { payload } = await jwtVerify(token, keysFor(`${env.CLERK_ISSUER}/.well-known/jwks.json`), { issuer: env.CLERK_ISSUER });
    // `azp` is the origin that requested the session; reject tokens minted for any other site.
    if (!(typeof payload.azp === "string" && allowed.includes(payload.azp))) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (!payload.sub || typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp)) return new Response("Unauthorized", { status: 401 });
    return { id: payload.sub, email: typeof payload.email === "string" ? payload.email : undefined, expiresAt: payload.exp * 1000 };
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
}
