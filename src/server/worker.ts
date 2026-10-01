import { RepositoryController } from "./durable-object.js";
import { FlareGitIntegrationWorkflow } from "./workflow.js";
import { handleQueueBatch } from "./queue.js";
import { authenticate } from "./access.js";
import { FlareGitScenarioWorkflow, ledgerOf } from "./scenario-workflow.js";
import { PROTECTED_PATHS, gitAuthEnv, projectIdFor, q } from "./shell.js";
import { billingFromEvent, createCheckout, planLimits, reportUsage, verifyPolarWebhook } from "./polar.js";
import { TICKET_BOOKING_POLICY } from "../fixtures/ticket-booking/policy.js";
import type { Env, QueueMessage } from "./env.js";

export { RepositoryController, FlareGitIntegrationWorkflow, FlareGitScenarioWorkflow };
export { IntegratorSandbox, AgentSandbox } from "./integrator.js";

const COMMIT = /^[0-9a-f]{40}$/;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // The publishable key is public by design; the SPA needs it before the user can sign in.
    if (url.pathname === "/auth-config" && request.method === "GET") {
      return Response.json({ publishableKey: env.CLERK_PUBLISHABLE_KEY ?? null });
    }

    // Polar webhooks are not behind login (Polar cannot log in); the HMAC signature is the authentication.
    if (url.pathname === "/webhooks/polar" && request.method === "POST") {
      const body = await request.text();
      let event: unknown;
      try {
        event = await verifyPolarWebhook(body, request.headers, env.POLAR_WEBHOOK_SECRET);
      } catch {
        return new Response("Invalid signature", { status: 401 });
      }
      const change = billingFromEvent(event, env.POLAR_PRODUCT_ID);
      if (change) await ledgerOf(env, change.projectId).setBilling(change.billing);
      return new Response(null, { status: 202 });
    }

    if (url.pathname.startsWith("/api/")) {
      const auth = await authenticate(request, env);
      if (auth instanceof Response) return auth;
      const projectId = await projectIdFor(auth.id);
      const ledger = ledgerOf(env, projectId);

      if (url.pathname === "/api/config" && request.method === "GET") return Response.json({ aiConfigured: true, previewBase: env.PREVIEW_ORIGIN });
      // Create the canonical Artifacts repo, seed it from the fixture inside the integrator container,
      // and initialize the ledger with the real head. Idempotent.
      if (url.pathname === "/api/projects/bootstrap" && request.method === "POST") {
        try {
          return Response.json(await bootstrap(env, projectId));
        } catch (err) {
          return new Response(err instanceof Error ? err.message : "bootstrap failed", { status: 500 });
        }
      }

      if (url.pathname === "/api/scenarios/run" && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as { act?: string };
        if (body.act !== "act1" && body.act !== "act2" && body.act !== "act3") return new Response("act must be act1, act2 or act3", { status: 400 });
        const { plan } = await ledger.getBilling();
        const limit = planLimits(env)[plan];
        const quota = await ledger.consumeRun(limit);
        if (!quota.allowed) {
          return new Response(`Daily run limit reached on the ${plan} plan (${quota.used}/${limit}). Upgrade at /api/billing/checkout.`, { status: 429 });
        }
        const runId = Date.now().toString(36);
        ctx.waitUntil(reportUsage(env, projectId, "scenario_run", `${projectId}-${runId}`, { act: body.act ?? "", plan }));
        const instance = await env.SCENARIO_WORKFLOW.create({ id: `scn-${projectId}-${runId}`, params: { projectId, act: body.act, runId } });
        return Response.json({ instanceId: instance.id }, { status: 202 });
      }

      // Humans (or any git client) participate with plain git: create a task, push to its fork, mark it ready.
      if (url.pathname === "/api/tasks" && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as { taskId?: string; goal?: string; allowedScope?: string[] };
        if (!body.taskId || !/^[a-z0-9][a-z0-9-]{2,40}$/.test(body.taskId) || !body.goal) {
          return new Response("taskId (3-41 chars: a-z, 0-9, -) and goal are required", { status: 400 });
        }
        try {
          const state = await ledger.getState();
          const canonical = await env.ARTIFACTS.get(state.canonicalRepoName);
          const repoName = `task-${projectId}-${body.taskId}`;
          const fork = await canonical.fork(repoName, { description: body.goal });
          const forkRepo = await env.ARTIFACTS.get(repoName);
          const token = (await forkRepo.createToken("write", 3600)).plaintext;
          const now = new Date().toISOString();
          await ledger.createTask({
            id: body.taskId,
            goal: body.goal,
            contributor: { id: `human-${await projectIdFor(auth.id)}`, name: auth.email ?? `user-${auth.id.slice(-6)}`, type: "human" },
            baseCommit: state.acceptedState.currentCommit,
            allowedScope: body.allowedScope ?? ["src/"],
            status: "working",
            requirements: [],
            workspace: { repoName, remote: fork.remote, branch: `task/${body.taskId}` },
            checkpoints: [],
            currentCommit: state.acceptedState.currentCommit,
            createdAt: now,
            updatedAt: now,
          });
          return Response.json({
            remote: fork.remote,
            branch: `task/${body.taskId}`,
            token,
            howTo: `git -c http.extraHeader="Authorization: Bearer <token>" clone ${fork.remote} && git checkout -b task/${body.taskId} && (edit, commit) && git -c http.extraHeader="Authorization: Bearer <token>" push origin task/${body.taskId}`,
          });
        } catch (err) {
          return new Response(err instanceof Error ? err.message : "could not create task", { status: 500 });
        }
      }

      const ready = /^\/api\/tasks\/([a-z0-9-]+)\/ready$/.exec(url.pathname);
      if (ready && request.method === "POST") {
        const state = await ledger.getState();
        const task = state.tasks[ready[1]!];
        if (!task) return new Response("Unknown task", { status: 404 });
        const repo = await env.ARTIFACTS.get(task.workspace.repoName);
        const head = (await repo.log({ ref: `refs/heads/${task.workspace.branch}`, limit: 1 }))[0]?.hash ?? (await repo.log({ ref: task.workspace.branch, limit: 1 }))[0]?.hash;
        if (!head) return new Response(`Nothing pushed to ${task.workspace.branch} yet`, { status: 409 });
        const { applied } = await ledger.ingestCheckpoint({ eventId: `ready-${task.id}-${head}`, taskId: task.id, commit: head, ready: true });
        return Response.json({ task: task.id, commit: head, applied });
      }

      if (url.pathname === "/api/integrations" && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as { taskIds?: string[] };
        if (!Array.isArray(body.taskIds) || body.taskIds.length !== 2) return new Response("taskIds must list exactly two tasks", { status: 400 });
        const { plan } = await ledger.getBilling();
        const quota = await ledger.consumeRun(planLimits(env)[plan]);
        if (!quota.allowed) return new Response("Daily run limit reached", { status: 429 });
        const eventId = `integ-${projectId}-${Date.now().toString(36)}`;
        await env.INTEGRATION_QUEUE.send({ type: "integration.requested", projectId, taskIds: body.taskIds as [string, string], eventId } satisfies QueueMessage);
        return Response.json({ queued: eventId }, { status: 202 });
      }

      const cancel = /^\/api\/tasks\/([\w-]+)\/cancel$/.exec(url.pathname);
      if (cancel && request.method === "POST") {
        try {
          await ledger.cancelTask(cancel[1]!);
          return Response.json({ cancelled: cancel[1] });
        } catch (err) {
          return new Response(err instanceof Error ? err.message : "cannot cancel", { status: 409 });
        }
      }

      if (url.pathname.startsWith("/api/workflows/") && request.method === "GET") {
        const id = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        if (!id.includes(projectId)) return new Response("Not found", { status: 404 });
        const wf = id.startsWith("scn-") ? env.SCENARIO_WORKFLOW : env.INTEGRATION_WORKFLOW;
        return Response.json(await (await wf.get(id)).status());
      }

      if (url.pathname === "/api/billing" && request.method === "GET") {
        const billing = await ledger.getBilling();
        const limit = planLimits(env)[billing.plan];
        return Response.json({ ...billing, runsToday: await ledger.usageToday(), runsPerDay: limit, checkoutConfigured: Boolean(env.POLAR_PRODUCT_ID && env.POLAR_ACCESS_TOKEN) });
      }

      if (url.pathname === "/api/billing/checkout" && request.method === "POST") {
        try {
          const checkoutUrl = await createCheckout(env, { projectId, email: auth.email ?? "", successUrl: `${url.origin}/?checkout=success` });
          return Response.json({ url: checkoutUrl });
        } catch (err) {
          return new Response(err instanceof Error ? err.message : "checkout failed", { status: 503 });
        }
      }

      if (url.pathname === "/api/state" && request.method === "GET") {
        try {
          return Response.json(await ledger.getState());
        } catch {
          return Response.json({ error: "not_initialized" }, { status: 404 });
        }
      }

      if (url.pathname === "/api/decisions/resolve" && request.method === "POST") {
        const body = (await request.json()) as { decisionId?: string; selectedOptionId?: string };
        if (!body.decisionId || !body.selectedOptionId) return new Response("decisionId and selectedOptionId required", { status: 400 });
        const { taskIds } = await ledger.resolveDecision(body.decisionId, body.selectedOptionId);
        if (taskIds.length === 2) {
          const eventId = `decision-${projectId}-${body.decisionId}`;
          await env.INTEGRATION_QUEUE.send({ type: "integration.requested", projectId, taskIds: taskIds as [string, string], eventId } satisfies QueueMessage);
        }
        return Response.json({ resolved: true });
      }

      // Git push notifications (from Artifacts hooks or the contributor tooling) become queue events.
      if (url.pathname === "/api/events/push" && request.method === "POST") {
        const body = (await request.json()) as Partial<Extract<QueueMessage, { type: "git.push" }>>;
        if (!body.taskId || !body.commit || !COMMIT.test(body.commit) || !body.eventId) return new Response("taskId, 40-hex commit and eventId required", { status: 400 });
        await env.INTEGRATION_QUEUE.send({ type: "git.push", projectId, taskId: body.taskId, commit: body.commit, ready: Boolean(body.ready), eventId: body.eventId });
        return new Response(null, { status: 202 });
      }
      return new Response("Not found", { status: 404 });
    }

    // Preview of the exact accepted build: served only from builds stored against a verified commit.
    const preview = /^\/preview\/([0-9a-f]{40})(\/.*)?$/.exec(url.pathname);
    if (url.pathname.startsWith("/preview/")) {
      if (!preview) return new Response("Not found", { status: 404 });
      const rel = (preview[2] ?? "/").replace(/^\/+/, "") || "index.html";
      if (rel.split("/").includes("..")) return new Response("Not found", { status: 404 });
      const object = await env.EVIDENCE_BUCKET.get(`builds/${preview[1]}/${rel}`);
      if (!object) return new Response("No verified build stored for this commit", { status: 404 });
      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
          "Content-Security-Policy": "default-src 'none'; script-src * 'unsafe-inline'; style-src * 'unsafe-inline'; img-src data: *; connect-src 'none'",
          "X-Content-Type-Options": "nosniff",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    return env.ASSETS.fetch(request);
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    await handleQueueBatch(batch, env);
  },
};

async function bootstrap(env: Env, projectId: string) {
  const ledger = ledgerOf(env, projectId);
  const canonicalName = `${env.CANONICAL_REPO}-${projectId}`;
  try {
    const existing = await ledger.getState();
    return { status: "already_initialized", head: existing.acceptedState.currentCommit };
  } catch {
    /* not initialized yet */
  }
  // Resumable: the repo may exist from an interrupted earlier attempt.
  let remote: string;
  let token: string;
  try {
    const created = await env.ARTIFACTS.create(canonicalName, { description: "FlareGit canonical repository" });
    remote = created.remote;
    token = created.token ?? "";
  } catch {
    const repo = await env.ARTIFACTS.get(canonicalName);
    remote = String((await repo.info()).remote);
    token = (await repo.createToken("write", 1800)).plaintext;
  }
  const sb = env.INTEGRATOR.getByName(`bootstrap-${projectId}`);
  const run = (cmd: string, e?: Record<string, string>) => sb.exec(["sh", "-c", cmd], { env: e });
  const seed = "/workspace/seed";
  const auth = gitAuthEnv(token);
  let head = (await run(`git ls-remote ${q(remote)} refs/heads/main`, auth)).stdout.split("\t")[0]?.trim() ?? "";
  if (!head) {
    const r = await run(
      `rm -rf ${seed} && mkdir -p ${seed} && cp -r /opt/flaregit/src/fixtures/ticket-booking/template/. ${seed}/ && cd ${seed} && git init -q -b main && git add -A && git -c user.name=FlareGit -c user.email=system@flaregit.com commit -q -m ${q("Initial accepted version")} && git push -q ${q(remote)} main:main`,
      auth
    );
    if (!r.success) throw new Error(`seed failed: ${r.stderr.slice(-400)}`);
    head = (await run(`git -C ${seed} rev-parse HEAD`)).stdout.trim();
  }
  await sb.destroy();
  await ledger.initialize({
    projectId,
    projectName: "Ticket checkout",
    canonicalRepoName: canonicalName,
    head,
    verificationPolicy: { ...TICKET_BOOKING_POLICY },
  });
  return { status: "initialized", head, protectedPaths: PROTECTED_PATHS };
}
