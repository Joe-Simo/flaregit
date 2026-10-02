import { RepositoryController, type Ledger } from "./durable-object.js";
import { FlareGitIntegrationWorkflow } from "./workflow.js";
import { FlareGitScenarioWorkflow } from "./scenario-workflow.js";
import { FlareGitAgentWorkflow } from "./agent-workflow.js";
import { handleQueueBatch } from "./queue.js";
import { authenticate } from "./access.js";
import { gitAuthEnv, q } from "./shell.js";
import { ensureBuild } from "./build.js";
import { billingFromEvent, createCheckout, planLimits, reportUsage, verifyPolarWebhook } from "./polar.js";
import { TICKET_BOOKING_POLICY } from "../fixtures/ticket-booking/policy.js";
import { DEFAULT_PROTECTED_PATHS, isCommandPolicy, settingsFor, type CommandPolicy } from "../core/command-policy.js";
import { currentStatus, runProbes, statusPage } from "./status.js";
import { lookupTxt, normalizeDomain, txtHost, txtValue } from "./dns.js";
import { isSafeRef } from "../core/sanitize.js";
import { diffTrees, listCommits, listDirectory, readBlobByHash, readFileText, resolveCommit } from "./browse.js";
import { validateWebhookUrl } from "./webhooks.js";
import { PROJECT_ID, accountKeyFor, accountOf, admitRun, canonicalNameFor, globalOf, newProjectId, projectOf, taskRepoName } from "./projects.js";
import type { Env, QueueMessage } from "./env.js";
import type { Task } from "../core/types.js";

export { RepositoryController, FlareGitIntegrationWorkflow, FlareGitScenarioWorkflow, FlareGitAgentWorkflow };
export { IntegratorSandbox, AgentSandbox } from "./integrator.js";

const TASK_ID = /^[a-z0-9][a-z0-9-]{2,40}$/;
const json = (data: unknown, status = 200) => Response.json(data, { status });
const text = (message: string, status: number) => new Response(message, { status });
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") return json({ ok: true });
    if (url.pathname === "/status.json") {
      const rows = await currentStatus(env);
      return Response.json({ degraded: rows.filter((r) => r.degradedNow).map((r) => r.label), components: rows }, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
    }
    if (url.pathname === "/status") return new Response(statusPage(await currentStatus(env)), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

    // The publishable key is public by design; the SPA needs it before the user can sign in.
    if (url.pathname === "/auth-config" && request.method === "GET") return json({ publishableKey: env.CLERK_PUBLISHABLE_KEY ?? null });

    // Polar webhooks cannot log in; the HMAC signature is the authentication.
    if (url.pathname === "/webhooks/polar" && request.method === "POST") {
      const body = await request.text();
      let event: unknown;
      try {
        event = await verifyPolarWebhook(body, request.headers, env.POLAR_WEBHOOK_SECRET);
      } catch {
        return text("Invalid signature", 401);
      }
      const change = billingFromEvent(event, env.POLAR_PRODUCT_ID);
      if (change) await accountOf(env, change.projectId).setBilling(change.billing);
      return new Response(null, { status: 202 });
    }

    const preview = /^\/preview\/([0-9a-f]{40})(\/.*)?$/.exec(url.pathname);
    if (url.pathname.startsWith("/preview/")) {
      if (!preview) return text("Not found", 404);
      const rel = (preview[2] ?? "/").replace(/^\/+/, "") || "index.html";
      if (rel.split("/").includes("..")) return text("Not found", 404);
      const object = await env.EVIDENCE_BUCKET.get(`builds/${preview[1]}/${rel}`);
      if (!object) return text("No verified build stored for this commit", 404);
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

    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const auth = await authenticate(request, env);
    if (auth instanceof Response) return auth;
    const userId = auth.id;
    const accountKey = await accountKeyFor(userId);
    const { success: withinLimit } = await env.API_LIMITER.limit({ key: accountKey });
    if (!withinLimit) return new Response("Too many requests. Please slow down.", { status: 429, headers: { "Retry-After": "60" } });
    const account = accountOf(env, accountKey);
    const path = url.pathname.slice(4); // strip "/api"
    const method = request.method;
    // Scoped tokens: read-only tokens may only read (and ask for a read-only clone credential); repo-pinned tokens see one repository.
    if (auth.viaToken) {
      const pinned = auth.tokenRepo;
      if (pinned && !path.startsWith(`/p/${pinned}/`) && path !== `/p/${pinned}`) return text("This token is limited to one repository", 403);
      if (auth.tokenScope === "read" && method !== "GET" && !/^\/p\/[a-z0-9]+\/clone$/.test(path)) return text("This token is read-only", 403);
    }
    const body = async <T>() => ((await request.json().catch(() => ({}))) as T) ?? ({} as T);

    try {
      // ---------- account level ----------
      if (path === "/config" && method === "GET") return json({ previewBase: env.PREVIEW_ORIGIN });

      if (path === "/account" && method === "GET") {
        let projects = await account.listProjects();
        if (projects.length === 0) projects = await adoptLegacyProject(env, account, accountKey, userId);
        // Hide repositories this user no longer belongs to (deleted, or removed as a member).
        const visible = [];
        for (const p of projects) {
          const role = await projectOf(env, p.id).roleOf(userId).catch(() => null);
          if (role) visible.push({ ...p, role });
          else await account.removeProject(p.id);
        }
        const billing = await account.getBilling();
        return json({
          userId: accountKey,
          projects: visible,
          plan: billing.plan,
          runsToday: await account.usageToday(),
          runsPerDay: planLimits(env)[billing.plan],
          checkoutConfigured: Boolean(env.POLAR_PRODUCT_ID && env.POLAR_ACCESS_TOKEN),
        });
      }

      if (path === "/account" && method === "DELETE") {
        if (auth.viaToken) return text("Delete your account from the web app", 403);
        const b = await body<{ confirm?: string }>();
        if (b.confirm !== "delete my account") return text('Send {"confirm":"delete my account"} to confirm', 400);
        const billing = await account.getBilling();
        if (billing.plan === "pro" && billing.status === "active") return text("Cancel your Pro subscription first (Account → Billing), then delete your account", 409);
        for (const p of await account.listProjects()) {
          const ledger = projectOf(env, p.id);
          const role = await ledger.roleOf(userId).catch(() => null);
          if (role === "owner") {
            const st = await ledger.getState().catch(() => null);
            if (st) {
              for (const t of Object.values(st.tasks)) await env.ARTIFACTS.delete(t.workspace.repoName).catch(() => false);
              await env.ARTIFACTS.delete(st.canonicalRepoName).catch(() => false);
            }
            await ledger.destroy();
          } else if (role) {
            await ledger.removeMember(userId).catch(() => undefined);
          }
        }
        await account.destroy();
        return json({ deleted: true });
      }

      // ----- notification inbox -----
      if (path === "/inbox" && method === "GET") {
        const f = url.searchParams.get("filter");
        const filter = f === "activity" || f === "snoozed" || f === "archived" ? f : "direct";
        return json({ items: await account.listInbox(filter), unread: await account.inboxUnread() });
      }
      const inboxRoute = /^\/inbox\/(\d+)$/.exec(path);
      if (inboxRoute && method === "POST") {
        const b = await body<{ state?: string }>();
        if (b.state !== "unread" && b.state !== "archived" && b.state !== "snoozed") return text("state must be unread, archived or snoozed", 400);
        await account.setInboxState(Number(inboxRoute[1]), b.state);
        return json({ ok: true });
      }

      if (path === "/billing" && method === "GET") {
        const billing = await account.getBilling();
        return json({ ...billing, runsToday: await account.usageToday(), runsPerDay: planLimits(env)[billing.plan], checkoutConfigured: Boolean(env.POLAR_PRODUCT_ID && env.POLAR_ACCESS_TOKEN) });
      }
      if (path === "/billing/checkout" && method === "POST") {
        return json({ url: await createCheckout(env, { projectId: accountKey, email: auth.email ?? "", successUrl: `${url.origin}/?checkout=success` }) });
      }

      // ----- personal API tokens (Clerk session only: a token cannot mint or list tokens) -----
      if (path === "/tokens" || path.startsWith("/tokens/")) {
        // A full-access token may only mint narrower, short-lived tokens; it cannot list or revoke.
        if (auth.viaToken && !(auth.tokenScope === "full" && path === "/tokens" && method === "POST")) return text("Manage tokens from the web app", 403);
        if (path === "/tokens" && method === "GET") return json(await account.listApiTokens());
        if (path === "/tokens" && method === "POST") {
          const b = await body<{ label?: string; scope?: string; repo?: string; ttlSeconds?: number }>();
          const scope = b.scope === "read" || b.scope === "write" ? b.scope : "full";
          const ttl = Number(b.ttlSeconds);
          if (auth.viaToken && (scope === "full" || !(ttl > 0 && ttl <= 86_400))) return text("Tokens minted from a token must have scope read|write and a ttl of at most 24 hours", 400);
          if (b.repo && !/^[a-z0-9]{12,16}$/.test(b.repo)) return text("Invalid repo", 400);
          const secret = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
          const token = `fgt_${accountKey}_${secret}`;
          const expiresAt = ttl > 0 ? Date.now() + Math.min(ttl, 365 * 86_400) * 1000 : undefined;
          const created = await account.createApiToken(userId, clean(b.label, 60) || "CLI", token, { scope, ...(b.repo ? { repo: b.repo } : {}), ...(expiresAt ? { expiresAt } : {}) });
          return json({ id: created.id, token, scope, repo: b.repo ?? null, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, note: "Copy this token now; it is not shown again." }, 201);
        }
        const tokRoute = /^\/tokens\/(tok_[a-z0-9-]+)$/.exec(path);
        if (tokRoute && method === "DELETE") {
          await account.revokeApiToken(tokRoute[1]!);
          return json({ revoked: tokRoute[1] });
        }
      }

      if (path === "/projects" && method === "POST") {
        const b = await body<{ kind?: string; name?: string; url?: string; branch?: string; install?: string; build?: string; test?: string }>();
        const existing = await account.listProjects();
        if (existing.length >= 10) return text("Repository limit reached (10).", 409);
        const name = clean(b.name, 60) || "my-repo";
        if (!/^[A-Za-z0-9._ -]{1,60}$/.test(name)) return text("Use letters, numbers, spaces, '.', '_' and '-' in the name.", 400);
        const projectId = newProjectId();
        if (b.kind === "import") {
          const created = await importRepository(env, { projectId, name, userId, url: clean(b.url, 300), branch: isSafeRef(clean(b.branch, 80)) ? clean(b.branch, 80) : "", install: clean(b.install, 300), build: clean(b.build, 300), test: clean(b.test, 300) });
          await account.addProject({ id: projectId, name, role: "owner", kind: "import" });
          return json({ id: projectId, ...created }, 201);
        }
        const created = await createDemoRepository(env, projectId, name, userId);
        await account.addProject({ id: projectId, name, role: "owner", kind: "demo" });
        return json({ id: projectId, ...created }, 201);
      }

      if (path === "/join" && method === "POST") {
        const b = await body<{ projectId?: string; token?: string; name?: string }>();
        if (!b.projectId || !PROJECT_ID.test(b.projectId) || !b.token) return text("Invalid invite", 400);
        const project = projectOf(env, b.projectId);
        const ok = await project.acceptInvite(b.token, userId, clean(b.name, 60) || `member-${userId.slice(-6)}`);
        if (!ok) return text("This invite is invalid, expired or already used.", 410);
        const state = await project.getState();
        await account.addProject({ id: b.projectId, name: state.projectName, role: "member", kind: state.kind ?? "demo" });
        return json({ id: b.projectId });
      }

      // ---------- project level: /p/:id/... ----------
      const m = /^\/p\/([a-z0-9]{12,16})(\/.*)?$/.exec(path);
      if (m) {
        const projectId = m[1]!;
        const sub = m[2] ?? "";
        const project = projectOf(env, projectId);
        const role = await project.roleOf(userId).catch(() => null);
        if (!role) return text("Not found", 404);
        const state = await project.getState().catch(() => null);
        if (!state) return text("Not found", 404);
        const settings = settingsFor(state.verificationPolicy);
        const isOwner = role === "owner";

        if (sub === "" && method === "GET") return json({ id: projectId, role, kind: state.kind ?? "demo", name: state.projectName, source: state.source ?? null, verification: state.verificationPolicy, protectedPaths: settings.protectedPaths });

        if (sub === "/state" && method === "GET") {
          if (settings.fixture === "ticket-booking") {
            ctx.waitUntil(ensureBuild(env, projectId, state.acceptedState.currentCommit, state.canonicalRepoName).catch((e) => console.error("preview build failed", String(e))));
          }
          return json({ ...state, role });
        }

        if (sub === "/activity" && method === "GET") return json(await project.listActivity(60));

        // ----- code browser -----
        if (sub === "/commits" && method === "GET") {
          const repo = await env.ARTIFACTS.get(state.canonicalRepoName);
          const ref = url.searchParams.get("ref") ?? undefined;
          if (ref !== undefined && !isSafeRef(ref)) return text("Invalid ref", 400);
          return json(await listCommits(repo, ref, Number(url.searchParams.get("limit") ?? 30), Number(url.searchParams.get("offset") ?? 0)));
        }
        if ((sub === "/tree" || sub === "/blob") && method === "GET") {
          const repo = await env.ARTIFACTS.get(state.canonicalRepoName);
          const refParam = url.searchParams.get("ref") ?? undefined;
          if (refParam !== undefined && !isSafeRef(refParam)) return text("Invalid ref", 400);
          const commit = await resolveCommit(repo, refParam);
          if (!commit) return text("Nothing here yet", 404);
          const p = url.searchParams.get("path") ?? "";
          try {
            return json(sub === "/tree" ? { commit, entries: await listDirectory(repo, commit, p) } : { commit, path: p, ...(await readFileText(repo, commit, p)) });
          } catch (e) {
            return text(e instanceof Error ? e.message : "Not found", 404);
          }
        }

        // ----- diffs: a commit against its parent, or a change against the commit it started from -----
        if (sub === "/diff" && method === "GET") {
          const commitParam = url.searchParams.get("commit");
          const taskParam = url.searchParams.get("task");
          let repoName = state.canonicalRepoName;
          let baseCommit: string | undefined;
          let headCommit: string | undefined;
          if (taskParam) {
            const task = state.tasks[taskParam];
            if (!task) return text("Unknown change", 404);
            repoName = task.workspace.repoName;
            baseCommit = task.baseCommit;
            headCommit = task.currentCommit;
          } else if (commitParam && /^[0-9a-f]{40}$/.test(commitParam)) {
            headCommit = commitParam;
          } else if (commitParam && /^[0-9a-f]{7,39}$/.test(commitParam)) {
            // Abbreviated hash, as `git log --oneline` prints it: resolve against recent history.
            const recent = await listCommits(await env.ARTIFACTS.get(state.canonicalRepoName), undefined, 500, 0);
            const matches = recent.filter((c) => c.hash.startsWith(commitParam));
            if (matches.length !== 1) return text(matches.length ? "Abbreviated hash is ambiguous" : "No recent commit matches that hash", matches.length ? 400 : 404);
            headCommit = matches[0]!.hash;
          } else {
            return text("Pass ?commit=<sha> or ?task=<id>", 400);
          }
          const repo = await env.ARTIFACTS.get(repoName);
          const head = await resolveCommit(repo, headCommit);
          if (!head) return text("Commit not found", 404);
          const base = baseCommit ? await resolveCommit(repo, baseCommit) : head.parents[0] ? await resolveCommit(repo, head.parents[0]) : null;
          const files = await diffTrees(repo, base?.treeHash, head.treeHash);
          return json({ repo: taskParam ? `task:${taskParam}` : "canonical", base: base?.hash ?? null, head, files });
        }
        if (sub === "/blob-by-hash" && method === "GET") {
          const hash = url.searchParams.get("hash") ?? "";
          const taskParam = url.searchParams.get("task");
          if (!/^[0-9a-f]{40}$/.test(hash)) return text("Invalid hash", 400);
          const repoName = taskParam ? state.tasks[taskParam]?.workspace.repoName : state.canonicalRepoName;
          if (!repoName) return text("Unknown change", 404);
          const repo = await env.ARTIFACTS.get(repoName);
          // Content-addressed: the bytes behind a hash never change, so the browser may keep them forever.
          return Response.json(await readBlobByHash(repo, hash), { headers: { "Cache-Control": "private, max-age=31536000, immutable" } });
        }

        // ----- clone credentials (read-only, short-lived) -----
        if (sub === "/clone" && method === "POST") {
          const repo = await env.ARTIFACTS.get(state.canonicalRepoName);
          const remote = String((await repo.info()).remote);
          const token = (await repo.createToken("read", 3600)).plaintext;
          return json({ remote, token, expiresInSeconds: 3600, command: `git -c http.extraHeader="Authorization: Bearer ${token}" clone ${remote}` });
        }

        // ----- changes (tasks) -----
        if (sub === "/tasks" && method === "POST") {
          const b = await body<{ taskId?: string; goal?: string; name?: string; dependsOn?: string }>();
          const goal = clean(b.goal, 300);
          if (!b.taskId || !TASK_ID.test(b.taskId) || !goal) return text("taskId (3-41 chars: a-z, 0-9, -) and goal are required", 400);
          if (state.tasks[b.taskId]) return text("A change with that id already exists", 409);
          const parent = b.dependsOn ? state.tasks[b.dependsOn] : undefined;
          if (b.dependsOn && (!parent || parent.status === "cancelled")) return text("dependsOn must name an existing, uncancelled change", 400);
          const source = await env.ARTIFACTS.get(parent ? parent.workspace.repoName : state.canonicalRepoName);
          const repoName = taskRepoName(projectId, b.taskId);
          const fork = await source.fork(repoName, { description: goal });
          const forkRepo = await env.ARTIFACTS.get(repoName);
          const token = (await forkRepo.createToken("write", 3600)).plaintext;
          const now = new Date().toISOString();
          const task: Task = {
            id: b.taskId,
            goal,
            contributor: { id: userId.slice(-12), name: clean(b.name, 60) || `member-${userId.slice(-6)}`, type: "human" },
            baseCommit: parent ? parent.currentCommit : state.acceptedState.currentCommit,
            ...(parent ? { dependsOn: parent.id } : {}),
            allowedScope: settings.allowedScope,
            status: "working",
            requirements: [],
            workspace: { repoName, remote: fork.remote, branch: `task/${b.taskId}` },
            checkpoints: [],
            currentCommit: state.acceptedState.currentCommit,
            createdAt: now,
            updatedAt: now,
          };
          await project.createTask(task);
          return json({
            task: b.taskId,
            remote: fork.remote,
            branch: task.workspace.branch,
            token,
            expiresInSeconds: 3600,
            commands: [
              `git -c http.extraHeader="Authorization: Bearer ${token}" clone ${fork.remote} ${b.taskId} && cd ${b.taskId}`,
              ...(parent ? [`git checkout ${parent.workspace.branch}   # stacked: start from the parent change`] : []),
              `git checkout -b ${task.workspace.branch}   # edit, then commit`,
              `git -c http.extraHeader="Authorization: Bearer ${token}" push origin ${task.workspace.branch}`,
            ],
          }, 201);
        }

        const tokenRoute = /^\/tasks\/([a-z0-9-]+)\/token$/.exec(sub);
        if (tokenRoute && method === "POST") {
          const task = state.tasks[tokenRoute[1]!];
          if (!task || task.status === "accepted" || task.status === "cancelled") return text("Change is not open", 404);
          const token = (await (await env.ARTIFACTS.get(task.workspace.repoName)).createToken("write", 3600)).plaintext;
          return json({ remote: task.workspace.remote, branch: task.workspace.branch, token, expiresInSeconds: 3600 });
        }

        const taskRoute = /^\/tasks\/([a-z0-9-]+)\/(ready|cancel|agent)$/.exec(sub);
        if (taskRoute && method === "POST") {
          const task = state.tasks[taskRoute[1]!];
          if (!task) return text("Unknown change", 404);
          const action = taskRoute[2];
          if (action === "cancel") {
            await project.cancelTask(task.id);
            ctx.waitUntil(env.ARTIFACTS.delete(task.workspace.repoName).catch(() => false));
            return json({ cancelled: task.id });
          }
          if (action === "ready") {
            const parent = task.dependsOn ? state.tasks[task.dependsOn] : undefined;
            if (parent && parent.status !== "accepted") return text(`Stacked on "${parent.id}", which is ${parent.status}; it must be accepted first`, 409);
            const repo = await env.ARTIFACTS.get(task.workspace.repoName);
            const head = (await repo.log({ ref: `refs/heads/${task.workspace.branch}`, limit: 1 }))[0]?.hash ?? (await repo.log({ ref: task.workspace.branch, limit: 1 }))[0]?.hash;
            if (!head) return text(`Nothing pushed to ${task.workspace.branch} yet`, 409);
            const { applied } = await project.ingestCheckpoint({ eventId: `ready-${task.id}-${head}`, taskId: task.id, commit: head, ready: true });
            return json({ task: task.id, commit: head, applied });
          }
          // AI agent works on this change
          const { plan } = await account.getBilling();
          const denied = await admitRun(env, account, planLimits(env)[plan]);
          if (denied) return denied;
          const instance = await env.AGENT_WORKFLOW.create({ id: `agent-${projectId}-${task.id}-${Date.now().toString(36)}`, params: { projectId, taskId: task.id } });
          ctx.waitUntil(reportUsage(env, accountKey, "agent_run", instance.id, { plan }));
          return json({ instanceId: instance.id }, 202);
        }

        if (sub === "/integrations" && method === "POST") {
          const b = await body<{ taskIds?: string[] }>();
          if (!Array.isArray(b.taskIds) || b.taskIds.length !== 2 || b.taskIds[0] === b.taskIds[1]) return text("taskIds must list exactly two different changes", 400);
          const { plan } = await account.getBilling();
          const denied = await admitRun(env, account, planLimits(env)[plan]);
          if (denied) return denied;
          const eventId = `integ-${projectId}-${Date.now().toString(36)}`;
          await env.INTEGRATION_QUEUE.send({ type: "integration.requested", projectId, taskIds: b.taskIds as [string, string], eventId } satisfies QueueMessage);
          return json({ queued: eventId }, 202);
        }

        if (sub === "/decisions/resolve" && method === "POST") {
          const b = await body<{ decisionId?: string; selectedOptionId?: string }>();
          if (!b.decisionId || !b.selectedOptionId) return text("decisionId and selectedOptionId required", 400);
          const { taskIds } = await project.resolveDecision(b.decisionId, b.selectedOptionId);
          if (taskIds.length === 2) await env.INTEGRATION_QUEUE.send({ type: "integration.requested", projectId, taskIds: taskIds as [string, string], eventId: `decision-${projectId}-${b.decisionId}` } satisfies QueueMessage);
          return json({ resolved: true });
        }

        if (sub === "/scenarios/run" && method === "POST") {
          if (state.kind === "import") return text("Scenarios run only on the demo repository", 400);
          const b = await body<{ act?: string }>();
          if (b.act !== "act1" && b.act !== "act2" && b.act !== "act3") return text("act must be act1, act2 or act3", 400);
          const { plan } = await account.getBilling();
          const denied = await admitRun(env, account, planLimits(env)[plan]);
          if (denied) return denied;
          const runId = Date.now().toString(36);
          const instance = await env.SCENARIO_WORKFLOW.create({ id: `scn-${projectId}-${runId}`, params: { projectId, act: b.act, runId } });
          ctx.waitUntil(reportUsage(env, accountKey, "scenario_run", `${projectId}-${runId}`, { act: b.act, plan }));
          return json({ instanceId: instance.id }, 202);
        }

        const wf = /^\/workflows\/([\w-]+)$/.exec(sub);
        if (wf && method === "GET") {
          const id = wf[1]!;
          if (!id.includes(projectId)) return text("Not found", 404);
          const flow = id.startsWith("scn-") ? env.SCENARIO_WORKFLOW : id.startsWith("agent-") ? env.AGENT_WORKFLOW : env.INTEGRATION_WORKFLOW;
          return json(await (await flow.get(id)).status());
        }

        // ----- collaborators -----
        if (sub === "/members" && method === "GET") return json(await project.listMembers());
        if (sub === "/invites" && method === "POST") {
          if (!isOwner) return text("Only the owner can invite", 403);
          const token = await project.createInvite(userId);
          return json({ url: `${url.origin}/#/join/${projectId}/${token}`, expiresInDays: 7 });
        }
        const memberRoute = /^\/members\/([\w-]+)$/.exec(sub);
        if (memberRoute && method === "DELETE") {
          if (!isOwner && memberRoute[1] !== userId) return text("Only the owner can remove members", 403);
          await project.removeMember(memberRoute[1]!);
          return json({ removed: memberRoute[1] });
        }

        // ----- outgoing webhooks -----
        // ----- domain verification (DNS TXT) -----
        if (sub === "/domains" && method === "GET") {
          const rows = await globalOf(env).domainsFor(projectId);
          return json(rows.map((r) => ({ domain: r.domain, verified: r.verified_at !== null, verifiedAt: r.verified_at, host: txtHost(r.domain), value: txtValue(r.token) })));
        }
        if (sub === "/domains" && method === "POST") {
          if (!isOwner) return text("Only the owner can claim a domain", 403);
          const b = await body<{ domain?: string }>();
          const domain = normalizeDomain(b.domain ?? "");
          if (!domain) return text("Enter a valid domain, e.g. example.com", 400);
          if ((await globalOf(env).domainsFor(projectId)).length >= 5) return text("Domain limit reached (5)", 409);
          const row = await globalOf(env).claimDomain(domain, projectId);
          return json({ domain, verified: row.verified_at !== null, host: txtHost(domain), value: txtValue(row.token) }, 201);
        }
        const domainRoute = /^\/domains\/([a-z0-9.-]+)\/(verify)$/.exec(sub);
        if (domainRoute && method === "POST") {
          if (!isOwner) return text("Only the owner can verify a domain", 403);
          const domain = normalizeDomain(domainRoute[1]!);
          const row = domain ? (await globalOf(env).domainsFor(projectId)).find((r) => r.domain === domain) : undefined;
          if (!domain || !row) return text("Claim the domain first", 404);
          const records = await lookupTxt(txtHost(domain)).catch((e: Error) => { throw new Error(`Could not check DNS: ${e.message}`); });
          if (!records.includes(txtValue(row.token))) return json({ verified: false, expected: { host: txtHost(domain), value: txtValue(row.token) }, found: records }, 200);
          const { lostBy } = await globalOf(env).verifyDomain(domain, projectId);
          for (const other of lostBy) await projectOf(env, other).logActivity("FlareGit", "domain.lost", `${domain} is now verified by another repository whose owner controls its DNS; this repository no longer holds it`).catch(() => undefined);
          await project.logActivity("FlareGit", "domain.verified", `${domain} verified by DNS`);
          return json({ verified: true, displaced: lostBy.length });
        }
        const domainDelete = /^\/domains\/([a-z0-9.-]+)$/.exec(sub);
        if (domainDelete && method === "DELETE") {
          if (!isOwner) return text("Only the owner can release a domain", 403);
          await globalOf(env).releaseDomain(domainDelete[1]!, projectId);
          return json({ released: domainDelete[1] });
        }

        if (sub === "/webhooks" && method === "GET") return json(await project.listWebhooks());
        if (sub === "/webhooks" && method === "POST") {
          if (!isOwner) return text("Only the owner can add webhooks", 403);
          const b = await body<{ url?: string; events?: string[] }>();
          let target: URL;
          try {
            target = validateWebhookUrl(clean(b.url, 300));
          } catch (e) {
            return text(e instanceof Error ? e.message : "Invalid URL", 400);
          }
          if ((await project.listWebhooks()).length >= 10) return text("Webhook limit reached (10).", 409);
          const created = await project.addWebhook(target.toString(), Array.isArray(b.events) && b.events.length > 0 ? b.events : ["change.accepted", "change.blocked"]);
          return json({ ...created, note: "Store this signing secret now; it is not shown again." }, 201);
        }
        const hookRoute = /^\/webhooks\/(wh_[a-z0-9-]+)$/.exec(sub);
        if (hookRoute && method === "DELETE") {
          if (!isOwner) return text("Only the owner can remove webhooks", 403);
          await project.removeWebhook(hookRoute[1]!);
          return json({ removed: hookRoute[1] });
        }
        if (sub === "/deliveries" && method === "GET") return json(await project.listDeliveries(50));
        const redeliverRoute = /^\/deliveries\/(dlv_[a-z0-9-]+)\/redeliver$/.exec(sub);
        if (redeliverRoute && method === "POST") {
          if (!isOwner) return text("Only the owner can redeliver", 403);
          return (await project.redeliver(redeliverRoute[1]!)) ? json({ queued: redeliverRoute[1] }) : text("Unknown delivery", 404);
        }

        // ----- settings -----
        if (sub === "/config" && method === "PATCH") {
          if (!isOwner) return text("Only the owner can change settings", 403);
          if (!isCommandPolicy(state.verificationPolicy)) return text("The demo repository's checks are fixed", 400);
          const b = await body<Partial<CommandPolicy>>();
          const next: CommandPolicy = {
            ...state.verificationPolicy,
            install: clean(b.install ?? state.verificationPolicy.install, 300) || undefined,
            build: clean(b.build ?? state.verificationPolicy.build, 300) || undefined,
            test: clean(b.test ?? state.verificationPolicy.test, 300) || state.verificationPolicy.test,
            protectedPaths: Array.isArray(b.protectedPaths) ? b.protectedPaths.map((x) => clean(x, 120)).filter(Boolean).slice(0, 60) : state.verificationPolicy.protectedPaths,
          };
          await project.setVerificationPolicy(next as unknown as Record<string, unknown>);
          return json({ ok: true });
        }

        if (sub === "" && method === "DELETE") {
          if (!isOwner) return text("Only the owner can delete a repository", 403);
          for (const t of Object.values(state.tasks)) await env.ARTIFACTS.delete(t.workspace.repoName).catch(() => false);
          await env.ARTIFACTS.delete(state.canonicalRepoName).catch(() => false);
          await project.destroy();
          await account.removeProject(projectId);
          return json({ deleted: projectId });
        }
      }

      return text("Not found", 404);
    } catch (err) {
      console.error("api error", method, path, err instanceof Error ? err.message : String(err));
      return text(err instanceof Error ? err.message : "Internal error", 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runProbes(env));
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    await handleQueueBatch(batch, env);
  },
};

/** Existing customers had a single hash-keyed project before multi-repo support; keep it as their first repository. */
async function adoptLegacyProject(env: Env, account: Ledger, accountKey: string, userId: string) {
  try {
    const legacy = projectOf(env, accountKey);
    const state = await legacy.getState();
    if (!(await legacy.roleOf(userId))) await legacy.addMember(userId, "owner");
    await account.addProject({ id: accountKey, name: state.projectName || "demo", role: "owner", kind: state.kind ?? "demo" });
    return account.listProjects();
  } catch {
    return [];
  }
}

async function createDemoRepository(env: Env, projectId: string, name: string, userId: string) {
  const ledger = projectOf(env, projectId);
  const canonicalName = canonicalNameFor(projectId);
  const created = await env.ARTIFACTS.create(canonicalName, { description: `FlareGit demo repository for ${name}` });
  const sb = env.INTEGRATOR.getByName(`bootstrap-${projectId}`);
  const run = (cmd: string, e?: Record<string, string>) => sb.exec(["sh", "-c", cmd], { env: e });
  const seed = "/workspace/seed";
  try {
    const r = await run(
      `rm -rf ${seed} && mkdir -p ${seed} && cp -r /opt/flaregit/src/fixtures/ticket-booking/template/. ${seed}/ && cd ${seed} && git init -q -b main && git add -A && git -c user.name=FlareGit -c user.email=system@flaregit.com commit -q -m ${q("Initial accepted version")} && git push -q ${q(created.remote)} main:main`,
      gitAuthEnv(created.token ?? "")
    );
    if (!r.success) throw new Error(`seed failed: ${r.stderr.slice(-400)}`);
    const head = (await run(`git -C ${seed} rev-parse HEAD`)).stdout.trim();
    await ledger.initialize({ projectId, projectName: name, canonicalRepoName: canonicalName, head, verificationPolicy: { ...TICKET_BOOKING_POLICY }, kind: "demo", defaultBranch: "main", ownerId: userId });
    return { head, kind: "demo" };
  } catch (e) {
    await env.ARTIFACTS.delete(canonicalName).catch(() => false);
    throw e;
  } finally {
    await sb.destroy().catch(() => undefined);
  }
}

async function importRepository(
  env: Env,
  o: { projectId: string; name: string; userId: string; url: string; branch: string; install: string; build: string; test: string }
) {
  let source: URL;
  try {
    source = new URL(o.url);
  } catch {
    throw new Error("Enter a valid repository URL, for example https://github.com/owner/repo");
  }
  if (source.protocol !== "https:" || source.username || source.password) throw new Error("Only public https:// repository URLs are supported (no embedded credentials).");
  if (!o.test) throw new Error("A test command is required: it is the protected check every change must pass.");
  const canonicalName = canonicalNameFor(o.projectId);
  const imported = await env.ARTIFACTS.import({
    source: { url: source.toString(), ...(o.branch ? { branch: o.branch } : {}), depth: 200 },
    target: { name: canonicalName, opts: { description: `Imported from ${source.host}${source.pathname}` } },
  });
  try {
    const repo = await env.ARTIFACTS.get(canonicalName);
    const head = (await repo.log({ limit: 1 }))[0]?.hash;
    if (!head) throw new Error("The imported repository has no commits.");
    const defaultBranch = String((await repo.info()).defaultBranch ?? "main");
    const policy: CommandPolicy = {
      kind: "command",
      ...(o.install ? { install: o.install } : {}),
      ...(o.build ? { build: o.build } : {}),
      test: o.test,
      allowedScope: ["*"],
      protectedPaths: DEFAULT_PROTECTED_PATHS,
    };
    await projectOf(env, o.projectId).initialize({
      projectId: o.projectId,
      projectName: o.name,
      canonicalRepoName: canonicalName,
      head,
      verificationPolicy: policy as unknown as Record<string, unknown>,
      kind: "import",
      defaultBranch,
      ownerId: o.userId,
      source: source.toString(),
    });
    return { head, kind: "import", remote: imported.remote };
  } catch (e) {
    await env.ARTIFACTS.delete(canonicalName).catch(() => false);
    throw e;
  }
}
