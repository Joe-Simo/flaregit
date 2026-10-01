import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./env.js";

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Validates the Cloudflare Access JWT. Fails closed when Access is not configured. */
export async function authenticate(request: Request, env: Env): Promise<{ email: string } | Response> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return new Response("Access is not configured", { status: 503 });
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return new Response("Unauthorized", { status: 401 });
  let keys = jwks.get(env.ACCESS_TEAM_DOMAIN);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
    jwks.set(env.ACCESS_TEAM_DOMAIN, keys);
  }
  try {
    const { payload } = await jwtVerify(token, keys, { issuer: `https://${env.ACCESS_TEAM_DOMAIN}`, audience: env.ACCESS_AUD });
    return { email: String(payload.email ?? payload.sub ?? "unknown") };
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
}
