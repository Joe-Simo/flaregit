import * as fs from "node:fs";
import * as path from "node:path";
import { getArtifactsClient } from "../artifacts/index.js";
import { FlareGitRepositoryController } from "../core/controller.js";
import type { FlareGitProjectState, Requirement } from "../core/types.js";
import { runAct1TextConflict } from "../scenarios/act1-text-conflict.js";
import { runAct2CleanMergeBrokenBehavior } from "../scenarios/act2-clean-broken.js";
import { runAct3ContradictoryRequirements } from "../scenarios/act3-contradiction.js";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Initialize in-memory / local storage controller for the live server
const baseDir = path.resolve(process.cwd(), ".flaregit-storage", "server");
if (!fs.existsSync(baseDir)) {
  fs.mkdirSync(baseDir, { recursive: true });
}

const artifacts = getArtifactsClient({
  forceLocal: true,
  baseDir: path.join(baseDir, "artifacts"),
});

const baseRequirement: Requirement = {
  id: "REQ-BASE-SINGLE-TICKET",
  title: "Baseline Ticket Checkout",
  description: "1 ticket @ $40 without extras equals exactly $40.00",
  version: 1,
  status: "approved",
  originTaskId: "task-seed",
  approvedAt: new Date().toISOString(),
  assertions: [],
};

const initialState: FlareGitProjectState = {
  projectId: "flaregit-local",
  projectName: "FlareGit Platform (Local)",
  canonicalRepoName: "flaregit-canonical",
  acceptedState: {
    currentCommit: "b84a5f8",
    acceptedAt: new Date().toISOString(),
    buildDigest: "sha256:verified_init",
    activeRequirements: [baseRequirement],
    history: [],
  },
  tasks: {},
  candidates: {},
  evidence: {},
  decisions: {},
  journal: [],
  policyVersion: 1,
};

const controller = new FlareGitRepositoryController(artifacts, initialState, baseDir);

// SSE connection pool
const sseClients = new Set<(msg: string) => void>();

controller.subscribe((event) => {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const send of sseClients) {
    try {
      send(data);
    } catch {
      sseClients.delete(send);
    }
  }
});

console.log(`Starting FlareGit Local Server on http://localhost:${PORT}...`);

Bun.serve({
  port: PORT,
  async fetch(req: Request) {
    const url = new URL(req.url);

    // CORS headers for Vite dev server proxy
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. SSE Events Stream
    if (url.pathname === "/api/events") {
      const stream = new ReadableStream({
        start(c) {
          const send = (msg: string) => c.enqueue(new TextEncoder().encode(msg));
          sseClients.add(send);
          // Send initial keepalive
          send(`data: ${JSON.stringify({ type: "connected", payload: { timestamp: new Date().toISOString() } })}\n\n`);
          req.signal.addEventListener("abort", () => {
            sseClients.delete(send);
          });
        },
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // 2. State API
    if (url.pathname === "/api/state" && req.method === "GET") {
      return Response.json(controller.getState(), { headers: corsHeaders });
    }

    // 3. Resolve Decision API
    if (url.pathname === "/api/decisions/resolve" && req.method === "POST") {
      const body = await req.json() as any;
      const result = await controller.resolveProductDecision(body.decisionId, body.selectedOptionId);
      return Response.json(result, { headers: corsHeaders });
    }

    // 4. Run Scenario API
    if (url.pathname === "/api/scenarios/run" && req.method === "POST") {
      const body = await req.json() as any;
      const act = body.act || "act1";
      let result: any;

      if (act === "act1") {
        result = await runAct1TextConflict(controller);
      } else if (act === "act2") {
        result = await runAct2CleanMergeBrokenBehavior(controller);
      } else if (act === "act3") {
        result = await runAct3ContradictoryRequirements(controller);
      } else {
        return new Response("Unknown scenario act", { status: 400, headers: corsHeaders });
      }

      return Response.json({ success: true, act, result }, { headers: corsHeaders });
    }

    // Default 404
    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
});
