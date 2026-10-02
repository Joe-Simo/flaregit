import { RepositoryController, WEBHOOK_EVENTS } from "./durable-object.js";
import { FlareGitIntegrationWorkflow } from "./workflow.js";
import { FlareGitScenarioWorkflow } from "./scenario-workflow.js";
import { FlareGitAgentWorkflow } from "./agent-workflow.js";
import { handleQueueBatch } from "./queue.js";
import { authenticate } from "./access.js";
import { gitAuthEnv, q } from "./shell.js";
import { ensureBuild } from "./build.js";
import { buildPrefix, signPreview, verifyPreview } from "./preview-access.js";
import { billingFromEvent, createCheckout, planLimits, reportUsage, verifyPolarWebhook } from "./polar.js";
import { TICKET_BOOKING_POLICY } from "../fixtures/ticket-booking/policy.js";
import { DEFAULT_PROTECTED_PATHS, isCommandPolicy, settingsFor, type CommandPolicy } from "../core/command-policy.js";
import { currentStatus, runProbes, statusIncidents, statusPage, workflowHealth } from "./status.js";
import { isPlausibleGithubToken, pushMirror, validateMirrorTarget } from "./mirror.js";
import { lookupTxt, normalizeDomain, txtHost, txtValue } from "./dns.js";
import { isSafeRef } from "../core/sanitize.js";
import { diffTrees, listCommits, listDirectory, readBlobByHash, readFileText, resolveCommit } from "./browse.js";
import { validateWebhookUrl } from "./webhooks.js";
import { PROJECT_ID, accountKeyFor, accountOf, admitRun, adoptLegacyProject, canonicalNameFor, globalOf, newProjectId, projectOf, taskRepoName } from "./projects.js";
import type { Env, QueueMessage } from "./env.js";
import type { Task } from "../core/types.js";
import { redactSecrets } from "../agents/prompt.js";
import { assertWorkflowControlPermission, controlWorkflow, WorkflowControlError } from "./workflow-control.js";
import { validateImportSource, validateRepositoryCommand } from "./import-source.js";

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
      const [rows, incidents, reports, workflows] = await Promise.all([currentStatus(env), statusIncidents(env), globalOf(env).reportBacklog(), workflowHealth(env)]);
      return Response.json({ degraded: rows.filter((r) => r.degradedNow).map((r) => r.label), components: rows, incidents, reports, workflows }, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
    }
    if (url.pathname === "/status") {
      const [rows, incidents, reports, workflows] = await Promise.all([currentStatus(env), statusIncidents(env), globalOf(env).reportBacklog(), workflowHealth(env)]);
      return new Response(statusPage(rows, incidents, Date.now(), reports, workflows), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }

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

    // Previews run contributor-built JavaScript, so they are served only from the separate preview origin,
    // only with a member-minted capability (query once, then a path-scoped cookie for the page's own assets).
    if (url.pathname.startsWith("/preview/")) {
      const previewHost = env.PREVIEW_ORIGIN ? new URL(env.PREVIEW_ORIGIN).hostname : null;
      if (!previewHost || url.hostname !== previewHost) return text("Not found", 404);
      const m = /^\/preview\/(p?[0-9a-f]{12})\/([0-9a-f]{40})(\/.*)?$/.exec(url.pathname);
      if (!m) return text("Not found", 404);
      const [, pid, sha] = m as unknown as [string, string, string];
      const rel = (m[3] ?? "/").replace(/^\/+/, "") || "index.html";
      if (rel.split("/").includes("..")) return text("Not found", 404);
      const scope = `/preview/${pid}/${sha}/`;
      const fromQuery = { exp: Number(url.searchParams.get("exp")), sig: url.searchParams.get("sig") ?? "" };
      const cookie = /(?:^|;\s*)fgp=(\d+)\.([0-9a-f]{64})/.exec(request.headers.get("Cookie") ?? "");
      const cred = fromQuery.sig ? fromQuery : cookie ? { exp: Number(cookie[1]), sig: cookie[2]! } : null;
      if (!cred || !(await verifyPreview(env, pid, sha, cred.exp, cred.sig))) return text("This preview link has expired. Open it again from FlareGit.", 403);
      const object = await env.EVIDENCE_BUCKET.get(`${buildPrefix(pid, sha)}/${rel}`);
      if (!object) return text("No verified build stored for this commit", 404);
      const headers = new Headers({
        "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
        "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'none'; frame-ancestors " + (env.CLERK_AUTHORIZED_PARTIES ?? "'none'").split(",").join(" "),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "private, max-age=3600",
      });
      if (fromQuery.sig) headers.append("Set-Cookie", `fgp=${cred.exp}.${cred.sig}; Path=${scope}; Max-Age=3600; Secure; HttpOnly; SameSite=Lax`);
      return new Response(object.body, { headers });
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

      // ----- abuse, impersonation and security reports: filed by anyone signed in, handled by named operators -----
      const KINDS = ["impersonation", "namespace_squatting", "malware", "harassment", "security", "other"];
      if (path === "/reports" && method === "POST") {
        const b = await body<{ kind?: string; target?: string; details?: string }>();
        if (!b.kind || !KINDS.includes(b.kind)) return text(`kind must be one of ${KINDS.join(", ")}`, 400);
        const target = clean(b.target, 300);
        const details = clean(b.details, 5000);
        if (!target || details.length < 10) return text("Say what you are reporting (a repository, handle or domain) and describe what happened", 400);
        const report = await globalOf(env).fileReport({ reporter: accountKey, kind: b.kind, target, details });
        return json({ id: report.id, status: report.status, note: "A person reviews every report. You can follow it under Account → Reports. The number of open reports and the age of the oldest one are public on /status." }, 201);
      }
      if (path === "/reports" && method === "GET") return json(await globalOf(env).listReports({ reporter: accountKey }));
      const operators = (env.OPERATOR_ACCOUNTS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      if (path.startsWith("/operator/")) {
        if (auth.viaToken || !operators.includes(accountKey)) return text("Not found", 404);
        if (path === "/operator/reports" && method === "GET") return json(await globalOf(env).listReports({ status: url.searchParams.get("status") === "resolved" ? "resolved" : "open" }));
        const resolveRoute = /^\/operator\/reports\/(rpt_[a-z0-9-]+)\/resolve$/.exec(path);
        if (resolveRoute && method === "POST") {
          const b = await body<{ resolution?: string }>();
          const resolution = clean(b.resolution, 2000);
          if (!resolution) return text("Write what was done", 400);
          const r = await globalOf(env).resolveReport(resolveRoute[1]!, resolution, (await account.getProfile()).displayName || accountKey);
          return r ? json(r) : text("Unknown report", 404);
        }
        return text("Not found", 404);
      }
      if (path === "/me" && method === "GET") return json({ operator: operators.includes(accountKey) });

      // ----- profile -----
      if (path === "/profile" && method === "GET") return json(await account.getProfile());
      if (path === "/profile" && method === "PUT") {
        if (auth.viaToken) return text("Edit your profile from the web app", 403);
        const b = await body<{ handle?: string; displayName?: string; bio?: string }>();
        const handle = clean(b.handle, 39).toLowerCase();
        if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(handle)) return text("Handle: 1-39 characters, a-z, 0-9 and single hyphens", 400);
        const displayName = clean(b.displayName, 60);
        if (!displayName || /[<>\u0000-\u001f]/.test(displayName)) return text("Enter a display name (no control characters or angle brackets)", 400);
        const current = await account.getProfile();
        if (!(await globalOf(env).claimHandle(handle, accountKey))) return text("That handle is taken", 409);
        await account.setProfile({ handle, displayName, bio: clean(b.bio, 300), joinedAt: current.handle ? current.joinedAt : new Date().toISOString() });
        return json({ ok: true });
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
          let source: URL;
          try { source = validateImportSource(b.url); }
          catch (error) { return text(error instanceof Error ? error.message : "Invalid import URL", 400); }
          if (b.branch !== undefined && (typeof b.branch !== "string" || (b.branch !== "" && !isSafeRef(b.branch)))) return text("Enter a valid Git branch name", 400);
          try { for (const command of [b.install, b.build, b.test]) validateRepositoryCommand(command); }
          catch (error) { return text(error instanceof Error ? error.message : "Invalid repository command", 400); }
          const created = await importRepository(env, { projectId, name, userId, url: source.toString(), branch: b.branch ?? "", install: clean(b.install, 300), build: clean(b.build, 300), test: clean(b.test, 300) });
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
        // Narrow (read/write) tokens may contribute but never administer: settings, members, webhooks, domains,
        // deletion and approving what becomes history need a signed-in session or a full-access token.
        const canAdminister = !auth.viaToken || auth.tokenScope === "full";
        const isOwner = role === "owner" && canAdminister;

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
          const candidateParam = url.searchParams.get("candidate");
          if (candidateParam) {
            const c = state.candidates[candidateParam];
            if (!c?.candidateCommit) return text("Unknown candidate", 404);
            baseCommit = c.expectedAcceptedBase;
            headCommit = c.candidateCommit;
          } else if (taskParam) {
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
          if ((baseCommit || head.parents[0]) && !base) return text("The comparison base could not be read; no complete diff is available. Retry.", 503);
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
          const b = await body<{ taskId?: string; goal?: string; name?: string; dependsOn?: string; issue?: number }>();
          const goal = clean(b.goal, 300);
          if (!b.taskId || !TASK_ID.test(b.taskId) || !goal) return text("taskId (3-41 chars: a-z, 0-9, -) and goal are required", 400);
          if (state.tasks[b.taskId]) return text("A change with that id already exists", 409);
          if (b.issue !== undefined && !(await project.getIssue(Number(b.issue)))) return text("Unknown issue", 400);
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
            contributor: { id: userId.slice(-12), name: (await account.getProfile()).displayName || clean(b.name, 60) || `member-${userId.slice(-6)}`, type: "human" },
            baseCommit: parent ? parent.currentCommit : state.acceptedState.currentCommit,
            ...(parent ? { dependsOn: parent.id } : {}),
            ...(b.issue !== undefined ? { issue: Number(b.issue) } : {}),
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
            // Cancellation stops integration, but the contributor's pushed branch remains recoverable.
            return json({ cancelled: task.id });
          }
          if (action === "ready") {
            const parent = task.dependsOn ? state.tasks[task.dependsOn] : undefined;
            if (parent && parent.status !== "accepted") return text(`Stacked on "${parent.id}", which is ${parent.status}; it must be accepted first`, 409);
            const repo = await env.ARTIFACTS.get(task.workspace.repoName);
            const head = (await repo.log({ ref: `refs/heads/${task.workspace.branch}`, limit: 1 }))[0]?.hash ?? (await repo.log({ ref: task.workspace.branch, limit: 1 }))[0]?.hash;
            if (!head) return text(`Nothing pushed to ${task.workspace.branch} yet`, 409);
            const [base, tip] = await Promise.all([resolveCommit(repo, task.baseCommit), resolveCommit(repo, head)]);
            if (!base || !tip) return text("Could not read the saved change and base; retry without marking ready", 503);
            const filesChanged = (await diffTrees(repo, base.treeHash, tip.treeHash)).map((file) => file.path);
            const { applied } = await project.ingestCheckpoint({ eventId: `ready-${task.id}-${head}`, taskId: task.id, commit: head, ready: true, filesChanged });
            return json({ task: task.id, commit: head, applied });
          }
          // AI agent works on this change
          if (["accepted", "cancelled", "integrating", "verifying"].includes(task.status)) return text("This change cannot start an agent in its current state", 409);
          const { plan } = await account.getBilling();
          const denied = await admitRun(env, account, planLimits(env)[plan]);
          if (denied) return denied;
          if (!(await project.beginAgentTask(task.id))) return text("Change can no longer start an agent", 409);
          let instance: WorkflowInstance;
          const instanceId = `agent-${projectId}-${task.id}-${crypto.randomUUID()}`;
          try {
            await project.registerWorkflow(instanceId, "agent", task.id, userId);
            instance = await env.AGENT_WORKFLOW.create({ id: instanceId, params: { projectId, taskId: task.id } });
          } catch {
            await project.failAgentTask(task.id);
            return text("Change is saved, but the agent could not start. Retry or continue on its saved branch.", 503);
          }
          ctx.waitUntil(reportUsage(env, accountKey, "agent_run", instance.id, { plan }));
          return json({ instanceId: instance.id }, 202);
        }

        if (sub === "/integrations" && method === "POST") {
          const b = await body<{ taskIds?: string[] }>();
          if (!Array.isArray(b.taskIds) || b.taskIds.length < 1 || b.taskIds.length > 8 || new Set(b.taskIds).size !== b.taskIds.length || !b.taskIds.every((t) => typeof t === "string" && TASK_ID.test(t))) {
            return text("taskIds must list one to eight different changes", 400);
          }
          const { plan } = await account.getBilling();
          const denied = await admitRun(env, account, planLimits(env)[plan]);
          if (denied) return denied;
          const eventId = `integ-${projectId}-${crypto.randomUUID()}`;
          await project.registerWorkflow(eventId, "integration", undefined, userId);
          await env.INTEGRATION_QUEUE.send({ type: "integration.requested", projectId, taskIds: b.taskIds as string[], eventId } satisfies QueueMessage);
          return json({ queued: eventId }, 202);
        }

        // ----- human review of a verified candidate -----
        const reviewRoute = /^\/candidates\/([a-z0-9_-]+)\/review$/.exec(sub);
        if (reviewRoute && method === "POST") {
          if (!canAdminister) return text("Approving or rejecting needs a signed-in session or a full-access token", 403);
          const b = await body<{ approved?: boolean; note?: string }>();
          if (typeof b.approved !== "boolean") return text("approved (true or false) is required", 400);
          const by = (await account.getProfile()).displayName || `member-${accountKey.slice(0, 6)}`;
          const r = await project.recordReview(reviewRoute[1]!, { approved: b.approved, by, note: clean(b.note, 500) || undefined });
          if (!r.ok || !r.instanceId) return text(r.error ?? "Review failed", 409);
          try {
            await (await env.INTEGRATION_WORKFLOW.get(r.instanceId)).sendEvent({ type: "review", payload: { approved: b.approved, by, note: clean(b.note, 500) || undefined } });
          } catch (e) {
            console.error("review notify failed", e instanceof Error ? e.message : String(e));
            return text("Your decision is saved, but the integration run did not receive it yet. Press the same button again to resend.", 502);
          }
          return json({ recorded: true, approved: b.approved });
        }

        if (sub === "/decisions/resolve" && method === "POST") {
          const b = await body<{ decisionId?: string; selectedOptionId?: string }>();
          if (!b.decisionId || !b.selectedOptionId) return text("decisionId and selectedOptionId required", 400);
          const { taskIds } = await project.resolveDecision(b.decisionId, b.selectedOptionId);
          if (taskIds.length > 0) {
            const eventId = `decision-${projectId}-${b.decisionId}`;
            await project.registerWorkflow(eventId, "integration", undefined, userId);
            await env.INTEGRATION_QUEUE.send({ type: "integration.requested", projectId, taskIds, eventId } satisfies QueueMessage);
          }
          return json({ resolved: true });
        }

        if (sub === "/scenarios/run" && method === "POST") {
          if (state.kind === "import") return text("Scenarios run only on the demo repository", 400);
          const b = await body<{ act?: string }>();
          if (b.act !== "act1" && b.act !== "act2" && b.act !== "act3") return text("act must be act1, act2 or act3", 400);
          const { plan } = await account.getBilling();
          const denied = await admitRun(env, account, planLimits(env)[plan]);
          if (denied) return denied;
          const runId = crypto.randomUUID();
          const instanceId = `scn-${projectId}-${runId}`;
          await project.registerWorkflow(instanceId, "scenario", undefined, userId);
          const instance = await env.SCENARIO_WORKFLOW.create({ id: instanceId, params: { projectId, act: b.act, runId } });
          ctx.waitUntil(reportUsage(env, accountKey, "scenario_run", `${projectId}-${runId}`, { act: b.act, plan }));
          return json({ instanceId: instance.id }, 202);
        }

        const wf = /^\/workflows\/([\w-]+)(?:\/(pause|resume))?$/.exec(sub);
        if (wf && ((method === "GET" && !wf[2]) || (method === "POST" && wf[2]))) {
          const id = wf[1]!;
          try {
            const run = await project.getWorkflowRun(id);
            if (!run) return text("Workflow not found in this repository", 404);
            if (method === "POST") assertWorkflowControlPermission(run, userId, isOwner);
            const result = await controlWorkflow(env, project, id, wf[2] === "pause" ? "pause" : wf[2] === "resume" ? "resume" : "status");
            if (method === "POST") await project.logActivity(userId, `workflow.${wf[2]}`, `${result.kind} run ${id}: ${result.status}`);
            return json(result);
          } catch (error) {
            if (error instanceof WorkflowControlError) return text(error.message, error.statusCode);
            throw error;
          }
        }

        // ----- collaborators -----
        // ----- previews: a member mints a short-lived link to the build of one commit of this repository -----
        if (sub === "/preview" && method === "GET") {
          const commit = url.searchParams.get("commit") ?? state.acceptedState.currentCommit;
          if (!/^[0-9a-f]{40}$/.test(commit)) return text("Invalid commit", 400);
          const ready = Boolean(await env.EVIDENCE_BUCKET.head(`${buildPrefix(projectId, commit)}/index.html`));
          if (!ready && commit === state.acceptedState.currentCommit && settings.fixture === "ticket-booking") ctx.waitUntil(ensureBuild(env, projectId, commit, state.canonicalRepoName).catch((e) => console.error("preview build failed", String(e))));
          if (!ready) return json({ ready: false });
          const { exp, sig } = await signPreview(env, projectId, commit);
          return json({ ready: true, url: `${env.PREVIEW_ORIGIN}/preview/${projectId}/${commit}/?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000).toISOString() });
        }

        // ----- issues -----
        const me = async () => (await account.getProfile()).displayName || `member-${userId.slice(-6)}`;
        if (sub === "/issues" && method === "GET") return json(await project.listIssues(url.searchParams.get("state") === "closed" ? "closed" : "open"));
        if (sub === "/issues" && method === "POST") {
          const b = await body<{ title?: string; body?: string }>();
          const title = clean(b.title, 200);
          if (!title) return text("A title is required", 400);
          return json(await project.createIssue({ title, body: clean(b.body, 20_000), author: await me() }), 201);
        }
        const issueRoute = /^\/issues\/(\d{1,7})$/.exec(sub);
        if (issueRoute && method === "GET") {
          const issue = await project.getIssue(Number(issueRoute[1]));
          if (!issue) return text("Unknown issue", 404);
          const linked = Object.values(state.tasks).filter((t) => t.issue === issue.number).map((t) => ({ id: t.id, goal: t.goal, status: t.status }));
          return json({ ...issue, linked, comments: await project.listComments(`issue:${issue.number}`) });
        }
        if (issueRoute && method === "PATCH") {
          const b = await body<{ state?: string }>();
          if (b.state !== "open" && b.state !== "closed") return text("state must be open or closed", 400);
          const issue = await project.setIssueState(Number(issueRoute[1]), b.state, await me());
          return issue ? json(issue) : text("Unknown issue", 404);
        }

        // ----- conversations on issues, changes and candidates (optionally anchored to a file line) -----
        const SUBJECT = /^(issue:\d{1,7}|change:[a-z0-9][a-z0-9-]{2,40}|candidate:[a-z0-9_-]{3,60})$/;
        const subjectExists = async (subject: string) => {
          const [kind, id] = subject.split(":") as [string, string];
          if (kind === "issue") return (await project.getIssue(Number(id))) !== null;
          if (kind === "change") return Boolean(state.tasks[id]);
          return Boolean(state.candidates[id]);
        };
        if (sub === "/comments" && method === "GET") {
          const subject = url.searchParams.get("subject") ?? "";
          if (!SUBJECT.test(subject)) return text("Invalid subject", 400);
          return json(await project.listComments(subject));
        }
        if (sub === "/comments" && method === "POST") {
          const b = await body<{ subject?: string; body?: string; path?: string; line?: number; commit?: string }>();
          const subject = b.subject ?? "";
          const text_ = clean(b.body, 10_000);
          if (!SUBJECT.test(subject) || !(await subjectExists(subject))) return text("Unknown subject", 404);
          if (!text_) return text("Write something first", 400);
          const path_ = b.path ? clean(b.path, 400) : undefined;
          if (path_ && (path_.startsWith("/") || path_.split("/").includes(".."))) return text("Invalid path", 400);
          const line = b.line === undefined ? undefined : Number(b.line);
          if (line !== undefined && !(Number.isInteger(line) && line > 0 && line < 10_000_000)) return text("Invalid line", 400);
          if (b.commit && !/^[0-9a-f]{40}$/.test(b.commit)) return text("Invalid commit", 400);
          return json(await project.addComment({ subject, author: await me(), body: text_, path: path_, line, commit: b.commit }), 201);
        }

        // ----- people: who works here and what they contributed (humans and agents, attributed separately) -----
        if (sub === "/people" && method === "GET") {
          const tasks = Object.values(state.tasks);
          const summarize = (mine: typeof tasks) => ({
            changes: mine.length,
            accepted: mine.filter((t) => t.status === "accepted").length,
            open: mine.filter((t) => !["accepted", "cancelled"].includes(t.status)).length,
            recent: mine.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5).map((t) => ({ id: t.id, goal: t.goal, status: t.status, updatedAt: t.updatedAt })),
          });
          const members = await project.listMembers();
          const humans = await Promise.all(
            members.map(async (m) => {
              const profile = await accountOf(env, await accountKeyFor(m.user_id)).getProfile().catch(() => null);
              const suffix = m.user_id.slice(-12);
              return { kind: "human" as const, role: m.role, joinedAt: m.added_at, handle: profile?.handle || null, name: profile?.displayName || m.label || `member-${m.user_id.slice(-6)}`, bio: profile?.bio || "", ...summarize(tasks.filter((t) => t.contributor.type === "human" && t.contributor.id === suffix)) };
            })
          );
          const agentNames = [...new Set(tasks.filter((t) => t.contributor.type === "agent").map((t) => t.contributor.name))];
          const agents = agentNames.map((name) => ({ kind: "agent" as const, name, ...summarize(tasks.filter((t) => t.contributor.type === "agent" && t.contributor.name === name)) }));
          return json({ humans, agents });
        }
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

        // ----- one-way mirror to GitHub (FlareGit stays the source of truth) -----
        if (sub === "/mirror" && method === "GET") {
          if (!isOwner) return text("Only the owner can view mirroring", 403);
          return json(await project.getMirror());
        }
        if (sub === "/mirror" && method === "PUT") {
          if (!isOwner) return text("Only the owner can configure mirroring", 403);
          const b = await body<{ target?: string; token?: string; enabled?: boolean }>();
          const target = b.target === undefined ? undefined : validateMirrorTarget(b.target);
          if (target === null) return text("Target must be https://github.com/<owner>/<repo>", 400);
          if (b.token !== undefined && !isPlausibleGithubToken(b.token)) return text("That does not look like a GitHub token", 400);
          try {
            await project.setMirror({ target, token: b.token, enabled: typeof b.enabled === "boolean" ? b.enabled : undefined });
          } catch (e) {
            return text(e instanceof Error ? e.message : "Invalid mirror settings", 400);
          }
          return json({ saved: true });
        }
        if (sub === "/mirror" && method === "DELETE") {
          if (!isOwner) return text("Only the owner can remove mirroring", 403);
          await project.deleteMirror();
          return json({ removed: true });
        }
        if (sub === "/mirror/run" && method === "POST") {
          if (!isOwner) return text("Only the owner can retry mirroring", 403);
          const cfg = await project.mirrorSecret();
          if (!cfg) return text("Mirroring is not enabled", 409);
          const repo = await env.ARTIFACTS.get(state.canonicalRepoName);
          const remote = String((await repo.info()).remote);
          const canonicalToken = (await repo.createToken("read", 900)).plaintext;
          const sb = env.INTEGRATOR.getByName(`${projectId}-mirror-retry`);
          const exec = (cmd: string, e?: Record<string, string>) => sb.exec(["sh", "-c", cmd], { env: e });
          const branch = (await exec(`git ls-remote --symref ${q(remote)} HEAD`, gitAuthEnv(canonicalToken))).stdout.match(/ref: refs\/heads\/(\S+)\s+HEAD/)?.[1] ?? state.defaultBranch ?? "main";
          const commit = state.acceptedState.currentCommit;
          ctx.waitUntil(
            pushMirror({ exec }, { canonicalRemote: remote, canonicalToken, target: cfg.target, githubToken: cfg.token, branch, commit })
              .then((r) => project.recordMirrorRun(commit, r.status, r.detail))
              .catch(() => project.recordMirrorRun(commit, "error", "Mirror run failed to start"))
          );
          return json({ queued: true }, 202);
        }

        if (sub === "/webhooks" && method === "GET") {
          // Receiver URLs can themselves contain private routing credentials.
          if (!isOwner) return text("Only the owner can view webhook settings; delivery history remains available", 403);
          return json(await project.listWebhooks());
        }
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
          if (b.events !== undefined && (!Array.isArray(b.events) || b.events.length === 0 || b.events.some((event) => !(WEBHOOK_EVENTS as readonly string[]).includes(event)))) return text("Choose supported webhook events", 400);
          const created = await project.addWebhook(target.toString(), b.events ?? ["change.accepted", "change.blocked"]);
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
          try { for (const command of [b.install, b.build, b.test]) validateRepositoryCommand(command); }
          catch (error) { return text(error instanceof Error ? error.message : "Invalid repository command", 400); }
          const next: CommandPolicy = {
            ...state.verificationPolicy,
            install: clean(b.install ?? state.verificationPolicy.install, 300) || undefined,
            build: clean(b.build ?? state.verificationPolicy.build, 300) || undefined,
            test: clean(b.test ?? state.verificationPolicy.test, 300) || state.verificationPolicy.test,
            protectedPaths: Array.isArray(b.protectedPaths) ? b.protectedPaths.map((x) => clean(x, 120)).filter(Boolean).slice(0, 60) : state.verificationPolicy.protectedPaths,
            landing: b.landing === "squash" || b.landing === "merge" ? b.landing : state.verificationPolicy.landing,
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
      const message = redactSecrets(err instanceof Error ? err.message : "Internal error");
      console.error("api error", method, path, message);
      return text(message, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runProbes(env));
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    await handleQueueBatch(batch, env);
  },
};

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
  const source = validateImportSource(o.url);
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
