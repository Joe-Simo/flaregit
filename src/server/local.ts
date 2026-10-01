import * as path from "node:path";
import { createLocalRuntime } from "./runtime.js";
import { ACT1, ACT2, ACT3, runScenario, type TaskSpec } from "../scenarios/ticket-booking.js";
import * as fs from "node:fs";
import { ensureBuild } from "./preview.js";
import { ticketBookingVerifier } from "../fixtures/ticket-booking/verifier.js";

const baseDir = path.resolve(process.cwd(), ".flaregit-storage", "server");
const PORT = Number(process.env.PORT ?? 3000);
const { controller, ai, artifacts } = await createLocalRuntime(baseDir);
const artifactsHandle = () => artifacts.get(controller.getState().canonicalRepoName);
const ACTS: Record<string, [TaskSpec, TaskSpec]> = { act1: ACT1, act2: ACT2, act3: ACT3 };

const sse = new Set<(chunk: string) => void>();
controller.subscribe((event) => {
  const chunk = `data: ${JSON.stringify(event)}\n\n`;
  for (const send of sse) {
    try {
      send(chunk);
    } catch {
      sse.delete(send);
    }
  }
});

let scenarioRunning = false;

function sameOrigin(origin: string, host: string | null): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Local development server: binds to loopback only and accepts same-origin requests (Vite proxies /api).
Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    const origin = req.headers.get("origin");
    // Cross-origin browser requests may not reach the API (the sandboxed preview sends Origin: null).
    if (url.pathname.startsWith("/api/") && origin && !sameOrigin(origin, req.headers.get("host")) && !/^https?:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin)) {
      return new Response("Forbidden", { status: 403 });
    }

    const previewMatch = /^\/preview\/([0-9a-f]{40})(\/.*)?$/.exec(url.pathname);
    if (previewMatch && req.method === "GET") {
      try {
        const remote = (await (await artifactsHandle()).info()).remote;
        const dir = await ensureBuild(remote, previewMatch[1]!, path.join(baseDir, "builds"));
        const rel = path.normalize(previewMatch[2] && previewMatch[2] !== "/" ? previewMatch[2] : "/index.html");
        const file = path.join(dir, rel);
        if (!file.startsWith(dir + path.sep) || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
        return new Response(Bun.file(file), { headers: { "Content-Security-Policy": "default-src 'none'; script-src * 'unsafe-inline'; style-src * 'unsafe-inline'; img-src data: *; connect-src 'none'", "Access-Control-Allow-Origin": "*" } });
      } catch (err) {
        return new Response(err instanceof Error ? err.message : "build failed", { status: 500 });
      }
    }

    if (url.pathname === "/api/state" && req.method === "GET") return Response.json(controller.getState());

    if (url.pathname === "/api/config" && req.method === "GET") return Response.json({ aiConfigured: ai.isConfigured, previewBase: `http://127.0.0.1:${PORT}` });

    if (url.pathname === "/api/decisions/resolve" && req.method === "POST") {
      const body = (await req.json()) as { decisionId?: string; selectedOptionId?: string };
      if (!body.decisionId || !body.selectedOptionId) return new Response("decisionId and selectedOptionId required", { status: 400 });
      try {
        return Response.json(await controller.resolveProductDecision(body.decisionId, body.selectedOptionId));
      } catch (err) {
        return new Response(err instanceof Error ? err.message : "error", { status: 400 });
      }
    }

    if (url.pathname === "/api/scenarios/run" && req.method === "POST") {
      const body = (await req.json()) as { act?: string };
      const specs = ACTS[body.act ?? ""];
      if (!specs) return new Response("Unknown scenario", { status: 400 });
      if (!ai.isConfigured) return new Response("Workers AI is not configured (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN)", { status: 503 });
      if (scenarioRunning) return new Response("A scenario is already running", { status: 409 });
      scenarioRunning = true;
      try {
        // Unique task ids per run so scenarios can be repeated against the same project.
        const suffix = Date.now().toString(36);
        const unique = specs.map((s) => ({ ...s, taskId: `${s.taskId}-${suffix}` })) as [TaskSpec, TaskSpec];
        const result = await runScenario(controller, unique, ai.asModel(), ticketBookingVerifier.protectedPaths);
        return Response.json({ success: result.integration.success, error: result.integration.error, decision: result.integration.decision });
      } catch (err) {
        return new Response(err instanceof Error ? err.message : "scenario failed", { status: 500 });
      } finally {
        scenarioRunning = false;
      }
    }

    return new Response("Not found", { status: 404 });
  },
});
console.log(`FlareGit local server on http://127.0.0.1:${PORT} (Workers AI ${ai.isConfigured ? "configured" : "NOT configured"})`);
