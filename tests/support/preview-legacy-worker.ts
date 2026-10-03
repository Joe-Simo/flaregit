import worker from "../../src/server/worker";
import type { Env } from "../../src/server/env";

// Synthetic fixtures only. Any storage read means the retired shared-origin route
// reached private content; no customer repository or authentication is involved.
const fixtureEnv = {
  PREVIEW_ORIGIN: "https://preview.flaregit.com",
  PREVIEW_SIGNING_KEY: "legacy-route-test-only-signing-secret",
  EVIDENCE_BUCKET: { get: async () => { throw new Error("Retired preview route read private storage"); } },
  ASSETS: { fetch: async () => new Response("app asset fallback", { status: 200 }) },
} as unknown as Env;
export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/fixture") {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", encoder.encode(fixtureEnv.PREVIEW_SIGNING_KEY!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`abcdef123456.${"a".repeat(40)}.${exp}`));
      const sig = [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      return Response.json({ exp, sig });
    }
    const target = url.searchParams.get("target");
    if (!target) return new Response("Missing test target", { status: 400 });
    return worker.fetch(new Request(target, { method: request.method, headers: request.headers }), fixtureEnv, ctx);
  },
};
