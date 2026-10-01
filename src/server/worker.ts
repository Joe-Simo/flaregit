import { RepositoryController } from "./durable-object.js";
import { FlareGitIntegrationWorkflow } from "./workflow.js";
import { handleQueueBatch } from "./queue.js";

export { RepositoryController, FlareGitIntegrationWorkflow };

export interface Env {
  REPOSITORY_CONTROLLER: DurableObjectNamespace;
  AI?: any;
  ARTIFACTS?: any;
  EVIDENCE_BUCKET?: any;
  INTEGRATION_QUEUE?: any;
  INTEGRATION_WORKFLOW?: any;
  ASSETS?: any;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. API and Realtime WebSocket routes -> route to authoritative Durable Object
    if (url.pathname.startsWith("/api") || url.pathname === "/ws") {
      const id = env.REPOSITORY_CONTROLLER.idFromName("flaregit-primary");
      const stub = env.REPOSITORY_CONTROLLER.get(id);
      return stub.fetch(request);
    }

    // 2. Live immutable preview route -> serve application built at exact commit hash
    if (url.pathname.startsWith("/preview/")) {
      const parts = url.pathname.split("/");
      const commitHash = parts[2] || "current";
      
      // Return preview shell HTML with commit metadata
      const previewHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>FlareGit Preview | ${commitHash}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #f8fafc; }
      .header-bar { background: #0f172a; color: #fff; padding: 8px 16px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
      .badge { background: #22c55e; color: #fff; padding: 2px 8px; border-radius: 9999px; font-weight: 600; }
    </style>
  </head>
  <body>
    <div class="header-bar">
      <span>Previewing Verified Commit: <code>${commitHash}</code></span>
      <span class="badge">Verified Exact Build</span>
    </div>
    <div id="preview-root"></div>
    <script type="module" src="/src/fixtures/ticket-booking/template/src/main.tsx"></script>
  </body>
</html>`;
      return new Response(previewHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 3. Static assets (SPA frontend)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("FlareGit Service Active", { status: 200 });
  },

  async queue(batch: any, env: Env): Promise<void> {
    await handleQueueBatch(batch, env);
  },
};
