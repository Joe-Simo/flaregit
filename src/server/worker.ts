import {gitCloneCommand,taskGitCommands} from "./git-command-metadata.js";
import { artifactStorageSlots } from "./storage-allocation.js";
import {observeRerunInputs} from "./rerun-input-observations.js";
import {LegacyRerunError} from "./legacy-candidate-rerun.js";
export {FlareGitRebaseResumeWorkflow} from "./rebase-resume-workflow.js";
import { openRepositoryRead, RepositoryReadError } from "./repository-read-budget.js";
import {taskCreationInputSchema} from "./task-creation.js";
import {storageReconciliationReport,type StorageReconciliationSnapshot} from "./storage-reconciliation-report.js";
import {createHash} from "node:crypto";
import type {PreviewGenerationRecord} from "./preview-generations.js";
import type {PreviewStorageIdentity} from "./preview-storage-upload.js";
import {buildPreviewGeneration} from "./preview-generation-build.js";
import {cleanupRepositoryCopies} from "./preview-storage-cleanup.js";
import { z } from "zod";
import type { PublicationModerationState } from "./publication-moderation.js";
import { publicationModerationInput } from "./publication-moderation.js";
import type { ReportPublicationTarget } from "./durable-object.js";
import { cleanupPrivateRecoveryRepositoryOutcome, cleanupPrivateRecoveryOutcome, privateRecoveryCleanupAdvice } from "./private-recovery-cleanup.js";
import {FlareGitPrivateRecoveryWorkflow} from "./private-recovery-workflow.js";
import {recoveryBundleKey,recoveryScopeId} from "./private-recovery.js";
import {downloadPrivateRecovery} from "./private-recovery-download.js";
import {admitCredentialLookup} from "./lookup-admission.js";
import { directoryQuerySchema, directoryUpdateSchema, projectPublicDirectory } from "./public-directory.js";
import { publicPeople, privatePeople } from "./community-people-http.js";
import { projectPublicCommunityActivity } from "./public-community-activity.js";
import { recoverNativeCompute, claimNativeCompute, admitNativeCompute, NativeComputeAdmissionError } from "./native-compute.js";
import { allocateArtifact } from "./storage-allocation.js";
import { gitRemote, gitParentTokenHash } from "./git-gateway-handler.js";
import { scenarioAgentRunIds } from "./scenario-workflow.js";
import { reserveManagedAgents } from "./projects.js";
import { searchAccountMetadata } from "./metadata-search.js";
import { communityQuerySchema } from "./platform-community.js";
import { RepositoryController, WEBHOOK_EVENTS } from "./durable-object.js";
import { FlareGitIntegrationWorkflow } from "./workflow.js";
import { FlareGitScenarioWorkflow } from "./scenario-workflow.js";
import { FlareGitAgentWorkflow } from "./agent-workflow.js";
import { FlareGitImportHistoryWorkflow, importHistoryReceiptKey } from "./import-history-workflow.js";
import { handleQueueBatch } from "./queue.js";
import { authenticate } from "./access.js";
import { handleGitGateway } from "./git-gateway-handler.js";
import { admitGitOperation } from "./core-git-budget.js";
import { gitAuthEnv, q } from "./shell.js";
import { ensureBuild } from "./build.js";
import { buildPrefix, generationBuildPrefix, signPreviewGeneration, signPreview, validPreviewRegistration } from "./preview-access.js";
import { lookupRepositoryPreviewOrigin } from "./preview-registry.js";
import { handlePreviewAsset } from "./preview-broker.js";
import { WorkerEntrypoint } from "cloudflare:workers";
import { billingFromEvent, createCheckout, planLimits, reportUsage, verifyPolarWebhook } from "./polar.js";
import { TICKET_BOOKING_POLICY } from "../fixtures/ticket-booking/policy.js";
import { DEFAULT_PROTECTED_PATHS, isCommandPolicy, settingsFor, type CommandPolicy } from "../core/command-policy.js";
import { currentStatus, runProbes, statusIncidents, statusPage, workflowHealth } from "./status.js";
import { isPlausibleGithubToken, pushMirror, validateMirrorTarget } from "./mirror.js";
import { lookupTxt, normalizeDomain, txtHost, txtValue } from "./dns.js";
import { isSafeRef } from "../core/sanitize.js";
import { diffTrees, listCommits, listDirectory, readBlobByHash, readFileText, resolveCommit } from "./browse.js";
import { validateWebhookUrl } from "./webhooks.js";
import { PROJECT_ID, accountKeyFor, accountOf, admitRun, adoptLegacyProject, canonicalNameFor, globalOf, managedSpendStatus, newProjectId, projectOf, taskRepoName } from "./projects.js";
import type { Env, QueueMessage } from "./env.js";
import type { Task } from "../core/types.js";
import { assertAgentWrites, redactSecrets } from "../agents/prompt.js";
import { assertWorkflowControlPermission, controlWorkflow, WorkflowControlError } from "./workflow-control.js";
import { inspectImport, startImport, type ImportJob, type ImportReadiness } from "./import-job.js";
import { retainDeploymentTarget } from "./retain-deployment.js";
import { deploymentRequestParametersSchema } from "./deployments.js";
import { readPublicPlanPrice } from "./plan-price.js";
import type { PublicCommunityPolicy } from "./public-community.js";
import type { Ledger } from "./durable-object.js";
import { validateImportSource, validateRepositoryCommand } from "./import-source.js";
import { integrationCapabilities, verifyIntegrationCallback } from "./integration-auth.js";
import type { ExternalCheckPolicy } from "../core/external-checks.js";
import { verifyServiceRead } from "./service-read-auth.js";
import { publicProfileProjection, type PublicContribution } from "./public-profile.js";
import { parsePublicBrowseRequest, readPublicRepository, RepositoryBrowseRequestError, parseSignedRepositoryBrowseRequest } from "./public-repositories.js";

function ownerModerationNotice(state: PublicationModerationState | undefined) { return state ? {suppressed:state.suppressed,version:state.version,reason:state.reason,reportId:state.reportId,decidedAt:state.decidedAt} : undefined; }

/** Service binding entrypoint: contributor Workers can only request signed build assets. */
export class PreviewAssetBroker extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return handlePreviewAsset(request, this.env, request.headers.get("x-preview-repository-id") ?? "");
  }
}

export { FlareGitPrivateRecoveryWorkflow, RepositoryController, FlareGitIntegrationWorkflow, FlareGitScenarioWorkflow, FlareGitAgentWorkflow, FlareGitImportHistoryWorkflow };
export { IntegratorSandbox, AgentSandbox } from "./integrator.js";

const TASK_ID = /^[a-z0-9][a-z0-9-]{2,100}$/;
const json = (data: unknown, status = 200) => Response.json(data, { status });
const text = (message: string, status: number) => new Response(message, { status });
const repositoryReadJson = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const repositoryReadText = (message: string, status: number) => new Response(message, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
class RequestBodyError extends Error {}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if(url.pathname.startsWith("/api/")||url.pathname.startsWith("/git/")){const denied=await admitCredentialLookup(request,env);if(denied)return denied;}

    if (url.pathname === "/health") return json({ ok: true });
    if (url.pathname.startsWith("/git/")) return handleGitGateway(request, env, async (_account, userId, _route, operationId) => {
      const admission = await admitGitOperation(env, userId, operationId);
      return admission instanceof Response ? admission : { finish: admission.finish ?? (async () => {}) };
    },true);
    if (url.pathname === "/pricing" && request.method === "GET" && request.headers.get("Accept")?.includes("text/html")) return env.ASSETS.fetch(request);
    if (["/pricing", "/plan-price"].includes(url.pathname) && request.method === "GET") {
      const ip = request.headers.get("CF-Connecting-IP");
      if (!ip) return text("Public pricing is unavailable", 503);
      if (!(await env.API_LIMITER.limit({ key: `plan-price:${ip}` })).success) return text("Too many price requests; retry shortly", 429);
    }
    if (url.pathname === "/plan-price" && request.method === "GET") return Response.json({ price: await readPublicPlanPrice(env), limits: planLimits(env), repositoryLimit: 10, sharedRetainedRepositorySlots: artifactStorageSlots(env.ARTIFACT_STORAGE_GLOBAL_SLOTS) }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    if (url.pathname === "/pricing" && request.method === "GET") {
      const limited = await env.API_LIMITER.limit({ key: `pricing:${request.headers.get("CF-Connecting-IP") ?? "unknown"}` });
      if (!limited.success) return text("Too many requests", 429);
      return Response.json(await readPublicPlanPrice(env), { headers: { "Cache-Control": "no-store" } });
    }
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

    // The authenticated Worker never serves contributor code. Existing shared links fail closed.
    if (url.pathname.startsWith("/preview/")) {
      return new Response("This preview link is no longer supported. Open the repository in FlareGit to request its isolated preview.", {
        status: 410,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" },
      });
    }

    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    if (url.pathname.startsWith("/api/profiles/")) {
      const respond = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      const match = /^\/api\/profiles\/([a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?)$/.exec(url.pathname);
      if (!match || request.method !== "GET" || url.search) return respond({ error: "Not found" }, 404);
      const ip = request.headers.get("CF-Connecting-IP");
      if (!ip) return respond({ error: "Public profiles unavailable" }, 503);
      if (!(await env.API_LIMITER.limit({ key: `public-profile:${ip}` })).success) return respond({ error: "Too many requests" }, 429);
      const handle = match[1]!;
      const registry = globalOf(env);
      const key = await registry.accountForHandle(handle);
      if (!key) return respond({ error: "Profile not found" }, 404);
      const profileAccount = accountOf(env, key);
      const publication = await profileAccount.publicProfileState();
      const projection = publicProfileProjection(handle, publication);
      if (!projection) return respond({ error: "Profile not found" }, 404);
      const contributions: PublicContribution[] = [];
      const references = (await profileAccount.listProjects()).slice(0, 10);
      const observed: Array<{ id: string; version: number; commit: string }> = [];
      for (const reference of references) {
        try {
          const repository = projectOf(env, reference.id);
          const publicContributions = await repository.publicContributionsFor(publication.ownerId!);
          if (!publicContributions) continue;
          const { grant, contributions: records } = publicContributions;
          for (const record of records) contributions.push({ repository: { id: reference.id, name: grant.name }, commit: record.commit, acceptedAt: record.acceptedAt });
          observed.push({ id: reference.id, version: grant.version, commit: grant.acceptedCommit });
        } catch { /* Unavailable public repositories contribute no private or inferred counts. */ }
      }
      for (const value of observed) {
        const current = (await projectOf(env, value.id).publicContributionsFor(publication.ownerId!))?.grant;
        if (!current || current.version !== value.version || current.acceptedCommit !== value.commit) return respond({ error: "Public contribution visibility changed; reload" }, 409);
      }
      const current = await profileAccount.publicProfileState();
      if (await registry.accountForHandle(handle) !== key || current.version !== publication.version || !publicProfileProjection(handle, current)) return respond({ error: "Profile publication changed; reload" }, 409);
      return respond({ profile: projection, contributions: contributions.sort((a,b) => b.acceptedAt.localeCompare(a.acceptedAt)).slice(0,100), contributionScope: "Accepted FlareGit contributions from up to 10 currently accessible public member repositories and their latest 100 acceptance records; not a complete lifetime history" });
    }

    const discussionRoute=/^\/api\/public\/(p?[0-9a-f]{12})\/discussions(?:\/(permissions|discussion_[a-f0-9-]{36})(?:\/(replies|control))?)?$/.exec(url.pathname);
    if(discussionRoute&&request.method==="GET"&&discussionRoute[2]!=="permissions"){
      const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
      const ip=request.headers.get("CF-Connecting-IP");if(!ip)return respond({error:"Public browsing unavailable"},503);
      if(!(await env.API_LIMITER.limit({key:`public-discussions:${discussionRoute[1]}:${ip}`})).success)return respond({error:"Too many requests"},429);
      const project=projectOf(env,discussionRoute[1]!);const grant=await project.publicGrant().catch(()=>null);if(!grant)return respond({error:"Not found"},404);
      try{const value=discussionRoute[2]?await project.discussionTopic(discussionRoute[2],true):await project.discussionList(true);const current=await project.publicGrant();if(!current||current.version!==grant.version||current.acceptedCommit!==grant.acceptedCommit)return respond({error:"Published repository changed; reload"},409);return value?respond(value):respond({error:"Discussion unavailable"},404);}catch{return respond({error:"Repository discussions unavailable"},404);}
    }
    const publicRoute = /^\/api\/public\/(p?[0-9a-f]{12})\/(meta|history|tree|file|diff|community)$/.exec(url.pathname);
    const publicParticipationRoute = /^\/api\/public\/(p?[0-9a-f]{12})\/community\/(posts|requests)(?:\/(post_[a-f0-9-]{36}))?$/.exec(url.pathname);
    if (url.pathname.startsWith("/api/public/") && !publicParticipationRoute && !discussionRoute) {
      const publicResponse = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      if (!publicRoute || request.method !== "GET") return publicResponse({ error: "Not found" }, 404);
      const projectId = publicRoute[1]!;
      if (publicRoute[2] === "community") {
        const project = projectOf(env, projectId);
        const grant = await project.publicGrant().catch(() => null);
        if (!grant) return publicResponse({ error: "Not found" }, 404);
        const ip = request.headers.get("CF-Connecting-IP");
        if (!ip) return publicResponse({ error: "Public browsing unavailable" }, 503);
        const limited = await env.API_LIMITER.limit({ key: `public:${projectId}:${ip}` });
        if (!limited.success) return publicResponse({ error: "Too many requests" }, 429);
        const community = await project.publicCommunity(true);
        const current = await project.publicGrant().catch(() => null);
        if (!current || current.version !== grant.version) return publicResponse({ error: "Published state changed; retry" }, 409);
        return publicResponse(community);
      }
      const ip = request.headers.get("CF-Connecting-IP");
      if (!ip) return publicResponse({ error: "Public browsing unavailable" }, 503);
      let limited;
      try { limited = await env.API_LIMITER.limit({ key: `public:${projectId}:${ip}` }); }
      catch { return publicResponse({ error: "Public request admission is unavailable; retry" }, 503); }
      if (!limited.success) return publicResponse({ error: "Too many requests" }, 429);
      let browseRequest;
      try { browseRequest = parsePublicBrowseRequest(publicRoute[2]!, url.searchParams); }
      catch (error) { return publicResponse({ error: error instanceof RepositoryBrowseRequestError ? error.message : "Invalid public browse request" }, error instanceof RepositoryBrowseRequestError ? error.status : 400); }
      const project = projectOf(env, projectId);
      let grant;
      try { grant = await project.publicGrant(); }
      catch { return publicResponse({ error: "Published repository scope is unavailable; retry" }, 503); }
      if (!grant) return publicResponse({ error: "Repository not found" }, 404);
      try {
        let result: unknown;
        let authorizeRepositoryRead: (() => Promise<void>) | undefined;
        if (browseRequest.kind === "meta") result = { id: projectId, name: grant.name, acceptedCommit: grant.acceptedCommit, visibility: "public", version: grant.version };
        else {
          const readContext = await project.repositoryReadContext(null, null);
          if (!readContext || readContext.canonicalRepoName !== grant.canonicalRepoName || readContext.publicationVersion !== grant.version || readContext.acceptedCommit !== grant.acceptedCommit) return publicResponse({ error: "Published repository scope changed; reload" }, 409);
          const authorize = async () => {
            if (!await project.assertRepositoryReadContext(readContext, null, null)) throw new RepositoryReadError(503, "authorization");
          };
          authorizeRepositoryRead = authorize;
          using repo = await openRepositoryRead(env, { repoName: grant.canonicalRepoName, authorize, reserveGroup: (operationId) => globalOf(env).reserveRepositoryReadOperation(operationId, readContext.accountKey), ...(browseRequest.kind === "diff" ? { limits: { maxProviderCalls: 10_016, deadlineMs: 120_000 } } : {}) });
          result = await readPublicRepository(repo, grant, browseRequest);
        }
        if (authorizeRepositoryRead) await authorizeRepositoryRead();
        else {
          const current = await project.publicGrant();
          if (!current || current.version !== grant.version || current.acceptedCommit !== grant.acceptedCommit || current.canonicalRepoName !== grant.canonicalRepoName) return publicResponse({ error: "Repository visibility or accepted history changed; reload" }, 409);
        }
        return publicResponse(result);
      } catch (error) {
        if (error instanceof RepositoryReadError) return publicResponse({ error: error.message, reason: error.reason }, error.status);
        if (error instanceof RepositoryBrowseRequestError) return publicResponse({ error: error.message }, error.status);
        if (error instanceof Error && error.message.includes("5,000-file inspection limit")) return publicResponse({ error: "Diff exceeds the supported 5,000-file inspection limit; no complete diff is available" }, 413);
        if (error instanceof Error && ["Path not found", "File not found"].includes(error.message)) return publicResponse({ error: "Repository content not found" }, 404);
        return publicResponse({ error: "Repository content unavailable; no complete response is available. Retry." }, 503);
      }
    }

    const serviceReadRoute = /^\/api\/p\/([a-z0-9]{12,16})\/connections\/(svc_[a-f0-9-]{36})\/candidates\/([a-z0-9_-]+)$/.exec(url.pathname);
    if (serviceReadRoute && request.method === "GET") {
      const project = projectOf(env, serviceReadRoute[1]!);
      const config = await project.connectionSigningConfig(serviceReadRoute[2]!).catch(() => null);
      if (!config) return text("Unauthorized", 401);
      const limited = await env.API_LIMITER.limit({ key: `service:${serviceReadRoute[1]}:${serviceReadRoute[2]}` });
      if (!limited.success) return text("Too many requests", 429);
      const nonce = request.headers.get("X-Flaregit-Nonce") ?? "";
      const timestamp = Number(request.headers.get("X-Flaregit-Timestamp"));
      const verified = await verifyServiceRead({ ...config, method: request.method, path: url.pathname + url.search, timestamp, nonce, signature: request.headers.get("X-Flaregit-Signature") ?? "" });
      if (!verified) return text("Invalid signed request", 401);
      const commit = url.searchParams.get("commit") ?? "";
      if (!/^[a-f0-9]{40}$/.test(commit)) return text("Exact candidate commit required", 400);
      const snapshot = await project.serviceCandidateSnapshot(serviceReadRoute[2]!, serviceReadRoute[3]!, commit, nonce);
      if (!snapshot) return text("Candidate unavailable or request already used", 404);
      return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
    }

    const callbackRoute = /^\/api\/p\/([a-z0-9]{12,16})\/connections\/(svc_[a-f0-9-]{36})\/events$/.exec(url.pathname);
    if (callbackRoute && request.method === "POST") {
      const project = projectOf(env, callbackRoute[1]!);
      const config = await project.connectionSigningConfig(callbackRoute[2]!).catch(() => null);
      if (!config) return text("Unauthorized", 401);
      const limited = await env.API_LIMITER.limit({ key: `service:${callbackRoute[1]}:${callbackRoute[2]}` });
      if (!limited.success) return text("Too many requests", 429);
      const reader = request.body?.getReader();
      if (!reader) return text("Body required", 400);
      const chunks: Uint8Array[] = []; let size = 0;
      for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 65_536) { await reader.cancel(); return text("Report too large", 413); } chunks.push(next.value); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const callback = await verifyIntegrationCallback({ ...config, raw: new TextDecoder().decode(bytes), signature: request.headers.get("X-Flaregit-Signature") ?? "", serviceId: callbackRoute[2]!, repositoryId: callbackRoute[1]! });
      if (!callback) return text("Invalid signed report", 401);
      const result = await project.acceptIntegrationCallback(callback);
      return json(result, result.kind === "rejected" ? 409 : 200);
    }

    if ((url.pathname === "/api/community/repositories" || url.pathname === "/api/community/activity") && request.method === "GET") {
      const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
      if (!(await env.API_LIMITER.limit({key:`directory:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`})).success) return Response.json({error:"Too many requests"},{status:429,headers});
      if (url.pathname.endsWith("/activity") && [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) return Response.json({error:"Invalid activity query"},{status:400,headers});
      const query = directoryQuerySchema.safeParse(Object.fromEntries(url.searchParams));
      if (!query.success) return Response.json({error:"Invalid directory query"},{status:400,headers});
      try {
        const page = await globalOf(env).directoryPage(query.data.cursor);
        const projection = await (url.pathname.endsWith("/activity") ? projectPublicCommunityActivity : projectPublicDirectory)({rows:page.rows,query:query.data.q,repository:(id)=>projectOf(env,id)});
        return Response.json({...projection,nextCursor:page.nextCursor},{headers});
      } catch { return Response.json({...(url.pathname.endsWith("/activity") ? {items:[]} : {repositories:[]}),nextCursor:null,incomplete:true,checked:0},{status:503,headers}); }
    }

    if (request.method === "GET" && (url.pathname === "/api/community" || /^\/api\/community\/topics\/forum_[a-f0-9-]{36}$/.test(url.pathname))) {
      const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
      const ip=request.headers.get("CF-Connecting-IP");if(!ip)return respond({error:"Community browsing unavailable"},503);
      if(!(await env.API_LIMITER.limit({key:`community:${ip}`})).success)return respond({error:"Too many requests"},429);
      const query=communityQuerySchema.safeParse({...(url.searchParams.has("category")?{category:url.searchParams.get("category")!}:{}),...(url.searchParams.has("q")?{q:url.searchParams.get("q")!}:{}),...(url.searchParams.has("sort")?{sort:url.searchParams.get("sort")!}:{})});
      if(!query.success)return respond({error:"Invalid community request"},400);
      try {
        if(url.pathname === "/api/community") return respond(await globalOf(env).forumList(query.data));
        const topic=await globalOf(env).forumTopic(url.pathname.split("/").at(-1)!);return topic?respond(topic):respond({error:"Topic unavailable"},404);
      }catch{return respond({error:"Community is temporarily unavailable; retry"},503);}
    }

    if(url.pathname==="/api/community/people"&&request.method==="GET"){
      const ip=request.headers.get("CF-Connecting-IP");if(!ip)return Response.json({error:"People discovery unavailable"},{status:503,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
      if(!(await env.API_LIMITER.limit({key:`people:${ip}`})).success)return Response.json({error:"Too many requests"},{status:429,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
      return publicPeople(env,url);
    }
    const auth = await authenticate(request, env);
    if (auth instanceof Response) return auth;
    const userId = auth.id;
    const accountKey = await accountKeyFor(userId);
    const { success: withinLimit } = await env.API_LIMITER.limit({ key: accountKey });
    if (!withinLimit) return new Response("Too many requests. Please slow down.", { status: 429, headers: { "Retry-After": "60" } });
    const account = accountOf(env, accountKey);
    const lifecycle=await account.accountLifecycle();
    const storageReportRequest=request.method==="GET"&&/^\/api\/p\/[a-z0-9]{12,16}\/storage-reconciliation$/.test(url.pathname)&&!auth.viaToken;
    if(lifecycle!=="active"&&!(lifecycle==="deleting"&&((url.pathname==="/api/account"&&request.method==="DELETE")||storageReportRequest)))return text(lifecycle==="deleted"?"Account was deleted":"Account deletion is in progress; retry deletion from Account",403);
    const path = url.pathname.slice(4); // strip "/api"
    const method = request.method;
    // Scoped tokens: read-only tokens may only read (and ask for a read-only clone credential); repo-pinned tokens see one repository.
    if (auth.viaToken) {
      const pinned = auth.tokenRepo;
      if (pinned && !path.startsWith(`/p/${pinned}/`) && path !== `/p/${pinned}` && !path.startsWith(`/public/${pinned}/`) && path !== `/public/${pinned}`) return text("This token is limited to one repository", 403);
      if (auth.tokenScope === "read" && method !== "GET" && !/^\/p\/[a-z0-9]+\/clone$/.test(path)) return text("This token is read-only", 403);
    }
    const body = async <T>() => {
      const reader = request.body?.getReader();
      if (!reader) return {} as T;
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 131_072) { await reader.cancel(); throw new RequestBodyError("Request body is too large"); }
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const raw = new TextDecoder().decode(bytes);
      if (!raw.trim()) return {} as T;
      let value: unknown;
      try { value = JSON.parse(raw); } catch { throw new RequestBodyError("Invalid JSON request body"); }
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new RequestBodyError("Request body must be an object");
      return value as T;
    };

    try {
      if(path==="/profile/discovery"||path.startsWith("/following")||path==="/community/following-activity"){
        const social=await privatePeople({env,url,accountKey,userId,viaToken:auth.viaToken===true,method,body:()=>body<unknown>()});if(social)return social;
      }
      if (path.startsWith("/community")) {
        if(auth.viaToken && (auth.tokenScope !== "full" || auth.tokenRepo)) return text("Community publishing requires an account session or full account token",403);
        const profile=await account.getProfile(),actor={userId,accountKey,displayName:profile.displayName||"Contributor"};
        const reply=/^\/community\/topics\/(forum_[a-f0-9-]{36})\/replies$/.exec(path);
        const entry=/^\/community\/entries\/(forum_[a-f0-9-]{36})$/.exec(path);
        try {
          if(path === "/community/permissions" && method === "GET") {
            const topic=url.searchParams.get("topic")??"";if(!/^forum_[a-f0-9-]{36}$/.test(topic))return text("Invalid topic",400);
            return json(await globalOf(env).forumPermissions(actor,topic,!auth.viaToken&&(env.OPERATOR_ACCOUNTS??"").split(",").map(x=>x.trim()).includes(accountKey)));
          }
          if(path === "/community/topics" && method === "POST")return json(await globalOf(env).forumCreate(actor,await body<unknown>()),201);
          if(reply && method === "POST")return json(await globalOf(env).forumCreate(actor,await body<unknown>(),reply[1]!),201);
          if(entry && method === "PUT")return json(await globalOf(env).forumEdit(actor,entry[1]!,await body<unknown>()));
          if(entry && method === "DELETE")return json(await globalOf(env).forumRemove(actor,entry[1]!,await body<unknown>(),!auth.viaToken&&(env.OPERATOR_ACCOUNTS??"").split(",").map(x=>x.trim()).includes(accountKey)));
          return text("Not found",404);
        }catch(error){if(error instanceof RequestBodyError)throw error;return text("Community change was not saved; check confirmation, content, ownership and version before retrying",409);}
      }
      if(discussionRoute){
        const project=projectOf(env,discussionRoute[1]!);if(!await project.publicGrant())return text("Not found",404);
        const profile=await account.getProfile(),actor={userId,accountKey,displayName:profile.displayName||"Contributor"};
        try{
          if(discussionRoute[2]==="permissions"&&method==="GET"){const id=url.searchParams.get("topic")??"";if(!/^discussion_[a-f0-9-]{36}$/.test(id))return text("Invalid discussion",400);return json(await project.discussionPermissions(actor,id,true,!auth.viaToken||auth.tokenScope==="full"));}
          const operation=!discussionRoute[2]&&method==="POST"?"create":discussionRoute[3]==="replies"&&method==="POST"?"reply":discussionRoute[3]==="control"&&method==="POST"?"control":!discussionRoute[3]&&method==="PATCH"?"edit":!discussionRoute[3]&&method==="DELETE"?"remove":null;
          if(!operation)return text("Not found",404);const input=await body<Record<string,unknown>>(),admin=!auth.viaToken||auth.tokenScope==="full";if(!admin&&(operation==="control"&&input.locked!==undefined||operation==="create"&&input.category==="announcements"))return text("Owner account administration required",403);return json(await project.discussionMutate(actor,operation,input,discussionRoute[2],true,admin),operation==="create"||operation==="reply"?201:200);
        }catch(error){if(error instanceof RequestBodyError)throw error;return text("Discussion change was not saved; check access, confirmation and current version",409);}
      }
      if (publicParticipationRoute) {
        const project = projectOf(env, publicParticipationRoute[1]!);
        const participationGrant = await project.publicGrant().catch(() => null);
        if (!participationGrant) return text("Not found", 404);
        const profile = await account.getProfile();
        const actor = { userId, accountKey, displayName: profile.displayName || "Contributor" };
        const postId = publicParticipationRoute[3];
        if (postId && publicParticipationRoute[2] !== "posts") return text("Not found", 404);
        if (publicParticipationRoute[2] === "posts" && !postId && method === "GET") {
          const posts = await project.signedPublicPosts(actor);
          const current = await project.publicGrant().catch(() => null);
          if (!current || current.version !== participationGrant.version) return text("Published state changed; reload", 409);
          return Response.json(posts, {headers:{"Cache-Control":"no-store"}});
        }
        if (postId && method === "PATCH") {
          try { return json(await project.editPublicPost(actor, postId, await body<{ title: string; body: string; expectedVersion: number }>())); }
          catch (error) { if (error instanceof RequestBodyError) throw error; return text("Post was not changed; only its author or maintainer may edit public content", 409); }
        }
        if (postId && method === "DELETE") {
          try { const value = await body<{expectedVersion:number}>(); await project.removePublicPost(actor, postId, value.expectedVersion); return json({ removed: true }); }
          catch (error) { if (error instanceof RequestBodyError) throw error; return text("Post was not removed; check permission and reload the latest version", 409); }
        }
        if (publicParticipationRoute[2] === "posts" && !postId && method === "POST") {
          try { return json(await project.createPublicPost(actor, await body<Parameters<typeof project.createPublicPost>[1]>()), 201); }
          catch (error) { if (error instanceof RequestBodyError) throw error; return text("Public post was not saved; check enabled scopes, content and the retry key", 409); }
        }
        if (publicParticipationRoute[2] === "requests" && method === "POST") {
          try { return json(await project.requestPublicContribution(actor, await body<Parameters<typeof project.requestPublicContribution>[1]>()), 201); }
          catch (error) { if (error instanceof RequestBodyError) throw error; return text("Contribution request was not saved; check enabled scopes and content", 409); }
        }
        if (publicParticipationRoute[2] === "requests" && method === "GET") {
          const requests = await project.publicContributionRequests(actor);
          const currentRole = await project.roleOf(userId);
          const current = await project.publicGrant().catch(() => null);
          if (!current || current.version !== participationGrant.version) return text("Published state changed; reload", 409);
          return Response.json({requests:currentRole === "owner" ? requests : requests.filter((item)=>item.requesterUserId===userId),accessActive:currentRole!==null},{headers:{"Cache-Control":"no-store"}});
        }
        return text("Not found", 404);
      }
      if (path === "/search" && method === "GET") {
        const query = url.searchParams.get("q") ?? "";
        if (query.length > 200) return json({ error: "Search is limited to 200 characters" }, 400);
        return Response.json(await searchAccountMetadata({ query, userId, references: await account.listProjects(), repository: (id) => projectOf(env, id), lifecycle: () => account.accountLifecycle() }), { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      }

      // ---------- account level ----------
      if (path === "/config" && method === "GET") return json({ previewIsolation: "repository-origin" });

      if (path === "/account" && method === "GET") {
        let projects = await account.listProjects();
        if (projects.length === 0) projects = await adoptLegacyProject(env, account, accountKey, userId);
        // Hide repositories this user no longer belongs to (deleted, or removed as a member).
        const visible = [];
        for (const p of projects) {
          const role = await projectOf(env, p.id).roleOf(userId).catch(() => null);
          if (role) visible.push({ ...p, role });
          // Hide pending/revoked/unavailable membership from navigation, but retain
          // its durable reference for account cleanup. Reading must not delete it.
        }
        const billing = await account.getBilling();
        return json({
          userId: accountKey,
          projects: visible,
          plan: billing.plan,
          runsToday: await account.usageToday(),
          runsPerDay: planLimits(env)[billing.plan],
          checkoutConfigured: env.PAID_CHECKOUT_ENABLED === "true" && Boolean(env.POLAR_PRODUCT_ID && env.POLAR_ACCESS_TOKEN),
        });
      }

      if (path === "/account" && method === "DELETE") {
        if (auth.viaToken) return text("Delete your account from the web app", 403);
        const b = await body<{ confirm?: string }>();
        if (b.confirm !== "delete my account") return text('Send {"confirm":"delete my account"} to confirm', 400);
        const billing = await account.getBilling();
        if (billing.plan === "pro" && billing.status === "active") return text("Cancel your Pro subscription first (Account → Billing), then delete your account", 409);
        await account.beginAccountDeletion();
        const removeArtifact=async(name:string)=>{
          if(await account.accountArtifactDeleted(name)) { await globalOf(env).recordArtifactDeletion(name, true); return true; }
          const deleted=await env.ARTIFACTS.delete(name).catch(()=>false);
          if(!deleted)return false;
          await account.recordAccountArtifactDeleted(name); await globalOf(env).recordArtifactDeletion(name, true); return true;
        };
        const imports = (await account.listImportJobs()).filter((job) => job.ownerId === userId);
        // Cancel only operations durably attributed to this account/import. Unknown
        // workflow state is retained rather than claiming its work has stopped.
        for (const operation of await account.listImportHistoryOperations()) {
          if (operation.ownerId !== userId || !imports.some((job) => job.id === operation.projectId && job.canonicalRepoName === operation.canonicalRepoName)) continue;
          if (operation.protocolVersion === 2) {
            const repository = projectOf(env, operation.projectId);
            if (await repository.roleOf(userId) !== "owner") return json({ deleted: false, status: "deleting", reason: "Import inspection ownership is unconfirmed; metadata is preserved" }, 202);
            await repository.beginRepositoryDeletion();
            // Protocol 2 is frozen with the account operation before any
            // dispatch. Every dispatch requires an atomic attempt record first;
            // a fenced operation without one was never sent to the provider.
            if (!await stopImportHistoryAttempts(env, repository)) return json({ deleted: false, status: "deleting", reason: "Import inspection shutdown is unconfirmed; metadata is preserved" }, 202);
            continue;
          }
          try {
            const handle = await env.IMPORT_HISTORY_WORKFLOW.get(operation.instanceId);
            const status = await handle.status();
            if (!["complete", "errored", "terminated"].includes(status.status)) {
              await handle.terminate();
              if ((await handle.status()).status !== "terminated") return json({ deleted: false, status: "deleting", reason: "Import inspection shutdown is unconfirmed; retry deletion" }, 202);
            }
          } catch { return json({ deleted: false, status: "deleting", reason: "Import inspection state is unavailable; retry deletion" }, 202); }
        }
        for (const reference of await account.listProjects()) {
          const ledger = projectOf(env, reference.id);
          if (await ledger.roleOf(userId) !== "owner") continue;
          await ledger.beginRepositoryDeletion();
          if (!await stopRepositoryWorkflows(env, ledger)) return json({ deleted: false, status: "deleting", reason: "Repository workflow shutdown is unconfirmed; retry deletion" }, 202);
          const recoveryCleanup = await cleanupPrivateRecoveryRepositoryOutcome(env, ledger);
          if (!recoveryCleanup.deleted) return json({ ...recoveryCleanup, status: "deleting", reason: recoveryCleanup.detail }, 202);
          const copiesCleanup=await cleanupRepositoryCopies(env,ledger);
          if(!copiesCleanup.cleaned)return json({deleted:false,status:"deleting",...copiesCleanup,reason:copiesCleanup.detail},202);
        }
        if (!await reconcileSealedAllocations(env, account)) return json({ deleted: false, status: "deleting", reason: "An in-flight repository allocation remains unconfirmed; retry deletion" }, 202);
        for (const job of imports) {
          if (await account.accountArtifactDeleted(job.canonicalRepoName)) continue;
          if (job.status !== "ready") {
            const readiness = await inspectImport(env.ARTIFACTS, job.canonicalRepoName);
            if (readiness.status !== "ready") return json({ deleted: false, status: "deleting", reason: "Saved import may still allocate repository storage; cleanup is unconfirmed. Retry deletion." }, 202);
          }
          if (!await removeArtifact(job.canonicalRepoName)) return json({ deleted: false, status: "deleting", reason: "Imported repository storage cleanup is unconfirmed; retry deletion" }, 202);
        }
        for (const p of await account.listProjects()) {
          const ledger = projectOf(env, p.id);
          const role = await ledger.roleOf(userId).catch(() => null);
          if (role === "owner") {
            const st = await ledger.getState().catch(() => null);
            if(!st)return json({deleted:false,status:"deleting",reason:"Repository cleanup metadata is unavailable; retry deletion"},202);
            if (st) {
              for (const t of Object.values(st.tasks)) if(!await removeArtifact(t.workspace.repoName))return json({deleted:false,status:"deleting",reason:"Repository storage cleanup is unconfirmed; retry deletion"},202);
              if(!await removeArtifact(st.canonicalRepoName))return json({deleted:false,status:"deleting",reason:"Repository storage cleanup is unconfirmed; retry deletion"},202);
            }
            await account.removeProject(p.id);
            await ledger.destroy();
          } else {
            await ledger.cancelContributorRegistration(userId);
          }
        }
        for (const allocation of await globalOf(env).artifactOwnerManifest(accountKey)) {
          if (allocation.state === "deleted") continue;
          if (await account.accountArtifactDeleted(allocation.name)) { await globalOf(env).recordArtifactDeletion(allocation.name, true); continue; }
          if (!await allocatedArtifactReadable(env, allocation.name) || !await removeArtifact(allocation.name)) return json({ deleted: false, status: "deleting", reason: "Reserved repository allocation cleanup is unconfirmed; retry deletion" }, 202);
        }
        await account.finishAccountDeletion();
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
        let publicationTarget: ReportPublicationTarget | undefined;
        const profileReference = /^\/#\/profile\/([a-z0-9-]{1,39})$/.exec(target);
        const repositoryReference = /^\/#\/(?:p|public)\/(p?[a-f0-9]{12})(?:\/|$)/.exec(target) ?? /^\/community#repo=(p?[a-f0-9]{12})(?:&|$)/.exec(target);
        if (profileReference) {
          const key = await globalOf(env).accountForHandle(profileReference[1]!);
          if (key) { const saved = await accountOf(env,key).publicProfileState(); if (saved.ownerId && saved.profile.handle === profileReference[1]) publicationTarget = {kind:"profile",targetId:saved.ownerId,accountKey:key}; }
        } else if (repositoryReference) {
          const targetId=repositoryReference[1]!;
          const saved=await projectOf(env,targetId).getState().catch(()=>null);
          if (saved?.projectId===targetId) publicationTarget={kind:"repository",targetId};
        }
        const report = await globalOf(env).fileReport({ reporter: accountKey, kind: b.kind, target, details, publicationTarget });
        return json({ id: report.id, status: report.status, note: "Your report is saved for operator review. You can track its status under Account → Reports. The number of open reports and the age of the oldest one are public on /status." }, 201);
      }
      if (path === "/reports" && method === "GET") { if(url.searchParams.getAll("cursor").length>1)return text("Invalid report cursor",400); try { return json(await globalOf(env).listReportsPage({ reporter: accountKey, cursor: url.searchParams.get("cursor") })); } catch (error) { if (String(error).includes("Invalid report cursor")) return text("Invalid report cursor; reload the report list",400); throw error; } }
      const operators = (env.OPERATOR_ACCOUNTS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      if (path.startsWith("/operator/")) {
        if (auth.viaToken || !operators.includes(accountKey)) return text("Not found", 404);
        if (path === "/operator/reservation-attribution" && method === "GET") {
          const keys=[...url.searchParams.keys()];
          if(keys.some(key=>!["month","cursor"].includes(key)||url.searchParams.getAll(key).length!==1)||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(url.searchParams.get("month")??"")||(url.searchParams.get("cursor")?.length??0)>512)return text("Invalid reservation page",400);
          if(url.searchParams.has("cursor")){
            try{const value:unknown=JSON.parse(atob(url.searchParams.get("cursor")!));if(typeof value!=="object"||value===null||Array.isArray(value))throw Error();const cursor=value as Record<string,unknown>;if(Object.keys(cursor).sort().join(",")!=="after,month,through,version"||cursor.version!==1||cursor.month!==url.searchParams.get("month")||typeof cursor.after!=="number"||typeof cursor.through!=="number"||!Number.isSafeInteger(cursor.after)||!Number.isSafeInteger(cursor.through)||cursor.after<0||cursor.through<cursor.after)throw Error();}catch{return text("Invalid reservation cursor",400);}
          }
          let page;
          try{page=await globalOf(env).managedReservationAttribution({month:url.searchParams.get("month")!,...(url.searchParams.has("cursor")?{cursor:url.searchParams.get("cursor")!}:{})});}catch{return text("Reservation page unavailable; retry",503);}
          const current=await authenticate(request,env);
          if(current instanceof Response||current.id!==userId||current.viaToken||!operators.includes(await accountKeyFor(current.id))||await account.accountLifecycle()!=="active")return text("Not found",404);
          return Response.json(page,{headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
        }
        const publicationRoute = /^\/operator\/reports\/(rpt_[a-z0-9-]+)\/publication$/.exec(path);
        if (publicationRoute) {
          const report = await globalOf(env).getReport(publicationRoute[1]!);
          if (!report?.publication_target) return text("This report has no frozen publication target; file a report from its current profile or repository page",409);
          const target = JSON.parse(report.publication_target) as ReportPublicationTarget;
          const ledger = target.kind === "profile" ? accountOf(env,target.accountKey) : projectOf(env,target.targetId);
          if (method === "GET") return json({target, state:target.kind === "profile" ? await ledger.profileModerationState(target.targetId) : await ledger.repositoryModerationState(), history:await ledger.moderationHistory(target.kind,target.targetId)});
          if (method === "POST") {
            const input=publicationModerationInput.extend({confirmedTarget:z.string()}).strict().safeParse(await body<unknown>());
            if (!input.success || input.data.reportId !== report.id || input.data.confirmedTarget !== `${target.kind}:${target.targetId}`) return text("Confirm the exact frozen publication target and report reference",400);
            const {confirmedTarget: _confirmation,...decision}=input.data;
            try { return json(target.kind === "profile" ? await ledger.moderateProfile(target.targetId,decision,accountKey) : await ledger.moderateRepository(decision,accountKey)); }
            catch(error) { return text(error instanceof Error ? error.message : "Publication decision failed",409); }
          }
          return text("Method not allowed",405);
        }
        const previewRegistration = /^\/operator\/preview-origins\/([a-z0-9]{12,16})$/.exec(path);
        if (previewRegistration) {
          const repository = previewRegistration[1]!;
          const registry = globalOf(env);
          if (method === "GET") return json({ registration: await registry.previewOrigin(repository, url.origin) });
          if (method === "PUT") {
            const value = await body<{ origin?: unknown; remoteConfigurationVerified?: unknown }>();
            if (typeof value.origin !== "string" || value.remoteConfigurationVerified !== true || validPreviewRegistration(env, repository, value.origin, url.origin) !== value.origin) return text("Confirm the remote child's exact repository, only its broker binding, and no secrets before registering its exact native origin", 400);
            if (!(await projectOf(env, repository).getState().catch(() => null))) return text("Repository not found", 404);
            try { return json({ registration: await registry.registerPreviewOrigin(repository, value.origin, accountKey, url.origin) }); }
            catch (cause) { return text(cause instanceof Error ? cause.message : "Preview origin registration conflicts", 409); }
          }
          if (method === "DELETE") return json({ registration: await registry.retirePreviewOrigin(repository, accountKey, url.origin) });
          return text("Method not allowed", 405);
        }
        if (path === "/operator/reports" && method === "GET") { if(url.searchParams.getAll("cursor").length>1||url.searchParams.getAll("status").length>1)return text("Invalid report cursor",400); try { return json(await globalOf(env).listReportsPage({ status: url.searchParams.get("status") === "resolved" ? "resolved" : "open", cursor: url.searchParams.get("cursor") })); } catch (error) { if (String(error).includes("Invalid report cursor")) return text("Invalid report cursor; reload the report list",400); throw error; } }
        const resolveRoute = /^\/operator\/reports\/(rpt_[a-z0-9-]+)\/resolve$/.exec(path);
        if (resolveRoute && method === "POST") {
          const b = await body<{ resolution?: string; expectedStatus?: string }>();
          if (b.expectedStatus !== undefined && b.expectedStatus !== "open") return text("Resolve an open report", 400);
          const resolution = clean(b.resolution, 2000);
          if (!resolution) return text("Write what was done", 400);
          try {
            const r = await globalOf(env).resolveReport(resolveRoute[1]!, resolution, accountKey);
            return r ? json(r) : text("Unknown report", 404);
          } catch (error) {
            if (error instanceof Error && error.message === "Report was already resolved") return text("Report was already resolved; reload its saved resolution", 409);
            throw error;
          }
        }
        return text("Not found", 404);
      }
      if (path === "/me" && method === "GET") return json({ operator: operators.includes(accountKey) });

      // ----- profile -----
      if (path === "/profile" && method === "GET") { const publication = await account.publicProfileState(); return json({ ...publication.profile, visibility: publication.visibility, version: publication.version, moderation: ownerModerationNotice(publication.moderation) }); }
      if (path === "/profile/visibility" && method === "PUT") {
        if (auth.viaToken) return text("Change profile publication from the web app", 403);
        const value = await body<{ visibility?: string; confirmed?: boolean; expectedVersion?: number }>();
        if (value.visibility !== "public" && value.visibility !== "private") return text("Invalid profile visibility",400);
        if (value.visibility === "public" && value.confirmed !== true) return text("Confirm publication of your profile and accepted contributions from public repositories",400);
        if (value.visibility === "public" && (!Number.isSafeInteger(value.expectedVersion) || value.expectedVersion! < 0)) return text("A saved profile version is required for publication",400);
        try { await account.setPublicProfileVisibility(value.visibility, value.confirmed === true, userId, value.expectedVersion); }
        catch (error) { if (String(error).includes("Profile version changed")) return text("Profile changed on another device. Your publication was not applied; refresh and review before confirming.",409); throw error; }
        return json({ visibility: value.visibility });
      }
      if (path === "/profile" && method === "PUT") {
        if (auth.viaToken) return text("Edit your profile from the web app", 403);
        const b = await body<{ handle?: string; displayName?: string; bio?: string; expectedVersion?: number }>();
        if (!Number.isSafeInteger(b.expectedVersion) || b.expectedVersion! < 0) return text("A saved profile version is required",400);
        const handle = clean(b.handle, 39).toLowerCase();
        if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(handle)) return text("Handle: 1-39 characters, a-z, 0-9 and single hyphens", 400);
        const displayName = clean(b.displayName, 60);
        if (!displayName || /[<>\u0000-\u001f]/.test(displayName)) return text("Enter a display name (no control characters or angle brackets)", 400);
        const current = await account.getProfile();
        if (!(await globalOf(env).claimHandle(handle, accountKey))) return text("That handle is taken", 409);
        try { await account.setProfile({ handle, displayName, bio: clean(b.bio, 300), joinedAt: current.handle ? current.joinedAt : new Date().toISOString() }, b.expectedVersion); }
        catch(error) { if(String(error).includes("Profile version changed")) return text("Profile changed on another device. Your edits were not saved; keep your draft and refresh the saved profile.",409); throw error; }
        await globalOf(env).commitHandle(handle, accountKey);
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
        const managed = await managedSpendStatus(env, accountKey).catch(() => ({ status: "unavailable" as const }));
        return json({ ...billing, managed, runsToday: await account.usageToday(), runsPerDay: planLimits(env)[billing.plan], checkoutConfigured: env.PAID_CHECKOUT_ENABLED === "true" && Boolean(env.POLAR_PRODUCT_ID && env.POLAR_ACCESS_TOKEN) });
      }
      if (path === "/billing/checkout" && method === "POST") {
        if (env.PAID_CHECKOUT_ENABLED !== "true") return text("Paid plans are still being validated. Free collaboration remains available.", 503);
        const price = await readPublicPlanPrice(env);
        if (price.status !== "known" || price.environment !== "production") return text("The paid price could not be confirmed. Checkout is unavailable; free collaboration remains available.", 503);
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

      if (path === "/imports" && method === "GET") return json({ imports: (await account.listImportJobs()).filter((job) => job.ownerId === userId) });
      const resumeImport = /^\/imports\/([a-z0-9]{12,16})\/resume$/.exec(path);
      if (resumeImport && method === "POST") {
        const job = await account.getImportJob(resumeImport[1]!);
        if (!job || job.ownerId !== userId) return text("Import not found", 404);
        const result = await finishImport(env, account, job, job.status === "failed" ? { status: "failed", detail: job.detail } : await inspectImport(env.ARTIFACTS, job.canonicalRepoName));
        return json(result, result.status === "ready" ? 201 : result.status === "failed" ? 409 : 202);
      }

      if (path === "/projects" && method === "POST") {
        const b = await body<{ kind?: string; name?: string; url?: string; branch?: string; install?: string; build?: string; test?: string }>();
        const existing = await account.listProjects();
        const pendingImports = (await account.listImportJobs()).filter((job) => job.status !== "ready");
        if (existing.filter((project)=>project.role==="owner").length + pendingImports.length >= 10) return text("Owned repository limit reached (10).", 409);
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
          const created = await importRepository(env, account, { projectId, name, userId, url: source.toString(), branch: b.branch ?? "", install: clean(b.install, 300), build: clean(b.build, 300), test: clean(b.test, 300) });
          return json(created, created.status === "ready" ? 201 : created.status === "failed" ? 409 : 202);
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
        if(sub==="/storage-reconciliation"&&method==="GET"){
          if(auth.viaToken||role!=="owner")return text("A signed-in repository owner must inspect storage",403);
          if([...url.searchParams.keys()].some(key=>key!=="cursor"&&key!=="plansCursor")||url.searchParams.getAll("cursor").length>1||url.searchParams.getAll("plansCursor").length>1)return text("Invalid storage report query",400);
          if(["cursor","plansCursor"].some(key=>url.searchParams.has(key)&&(!url.searchParams.get(key)||url.searchParams.get(key)!.length>1000)))return text("Invalid storage report cursor",400);
          const planCursor=url.searchParams.get("plansCursor"),parsed=planCursor?/^(copy|private):(0|[1-9][0-9]*):([a-f0-9]{64})$/.exec(planCursor):null;
          if(planCursor&&!parsed)return text("Invalid storage report cursor",400);
          const phase=parsed?.[1]??"copy",after=parsed?Number(parsed[2]):0;
          if(!Number.isSafeInteger(after))return text("Invalid storage report cursor",400);
          try{
            const context=await project.ownerStorageContext(userId);
            if(!context||context.projectId!==projectId)return text("Not found",404);
            if(!context.incarnation)return text("This repository has no recorded storage incarnation, so its report is unavailable. No state was created. Older untracked copies, if any, require provider reconciliation.",409);
            const global=globalOf(env),copies=await global.storageCopyReportPage(projectId,context.incarnation,phase==="copy"?after:0);
            if(!context.metadataComplete||!copies.complete)return text("Stored metadata exceeds this report's bounded epoch capacity. No reconciliation or hold release was performed.",503);
            const epoch=createHash("sha256").update(JSON.stringify([context.epoch,copies.epoch])).digest("hex");
            if(parsed&&parsed[3]!==epoch)return text("Storage report context changed; refresh from the first page",409);
            const privatePage=phase==="private"?await project.storagePrivateReportPage(projectId,context.incarnation,after):null;
            const next=phase==="copy"?(copies.nextCursor??(context.privateOperations?"private:0":null)):privatePage?.nextCursor??null;
            const snapshot:StorageReconciliationSnapshot={scope:{projectId,incarnation:context.incarnation,epoch},plans:privatePage?.plans??copies.plans,legacyInventory:context.legacyInventory,legacyEvidence:context.legacyEvidence,plansComplete:next===null,plansNextCursor:next?`${next}:${epoch}`:undefined};
            const authorize=async()=>{
              const freshAuth=await authenticate(request,env);if(freshAuth instanceof Response||freshAuth.viaToken||freshAuth.id!==userId)return false;
              const life=await account.accountLifecycle();if(life!=="active"&&life!=="deleting")return false;
              const fresh=await project.ownerStorageContext(userId);return !!fresh&&fresh.projectId===projectId&&fresh.incarnation===context.incarnation&&fresh.canonicalRepoName===context.canonicalRepoName&&fresh.epoch===context.epoch;
            };
            const report=await storageReconciliationReport({snapshot,cursor:url.searchParams.get("cursor")??undefined},{authorize,head:key=>env.EVIDENCE_BUCKET.head(key),list:options=>env.EVIDENCE_BUCKET.list(options)});
            const finalCopies=await global.storageCopyReportPage(projectId,context.incarnation,phase==="copy"?after:0);
            if(finalCopies.epoch!==copies.epoch||!await authorize())return text("Storage report context changed; refresh",409);
            return Response.json({...report,deletionPending:context.deletionPending,workflows:context.workflows,native:copies.native,coverage:"Recorded plans and bounded provider observations; no hold release or cancellation proof"},{headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
          }catch{return text("Storage report is unavailable or its scope changed. Refresh; saved holds remain intact.",409);}
        }

        if (await project.repositoryDeletionPending() && !(sub === "" && method === "DELETE")) return json({ status: "deleting", detail: "Repository storage cleanup is pending; the owner can retry deletion.",canInspectStorage:!auth.viaToken&&role==="owner" }, 409);
        const state = await project.getState().catch(() => null);
        if (!state) return text("Not found", 404);
        const settings = settingsFor(state.verificationPolicy);
        // Narrow (read/write) tokens may contribute but never administer: settings, members, webhooks, domains,
        // deletion and approving what becomes history need a signed-in session or a full-access token.
        const canAdminister = !auth.viaToken || auth.tokenScope === "full";
        const isOwner = role === "owner" && canAdminister;


        if (sub === "/git-sharing" && (method === "GET" || method === "PUT")) {
          if (auth.viaToken || role !== "owner") return text("A signed-in repository owner must decide Git sharing",403);
          if (await account.accountLifecycle() !== "active") return text("Account is unavailable",409);
          try {
            return json(method === "GET" ? await project.publicGitSharingState(userId) : await project.decidePublicGitSharing(userId,await body<unknown>()));
          } catch { return text("Git sharing decision was not confirmed. Reload or retry the identical request.",409); }
        }

        if(sub==="/recovery"&&method==="GET"){
          const targets=await project.privateRecoveryTargets();
          return Response.json({snapshots:(await project.privateRecoveryList()).map(op=>({id:op.id,commit:op.commit,tree:op.tree,status:op.status,createdAt:op.createdAt,error:op.error,size:op.receipt?.size,cacheState:op.cacheState,...(op.cacheState === "deleting" ? {cleanupAdvice:privateRecoveryCleanupAdvice(op)} : {}),canRetry:isOwner&&op.ownerId===userId&&!op.cacheState})),target:targets.at(-1)??null,targets},{headers:{"Cache-Control":"no-store"}});
        }
        if(sub==="/recovery"&&method==="POST"){
          if(!isOwner)return text("Only the owner can prepare recovery snapshots",403);
          if(!env.PRIVATE_RECOVERY_WORKFLOW)return text("Private recovery preparation is not configured",503);
          const b=await body<{commit:string;expectedTree:string|null;idempotencyKey:string}>();
          if(Object.keys(b).some(key=>!["commit","expectedTree","idempotencyKey"].includes(key))||! /^[a-f0-9]{40}$/.test(b.commit)||(b.expectedTree!==null&&(typeof b.expectedTree!=="string"||! /^[a-f0-9]{40}$/.test(b.expectedTree)))||! /^[a-f0-9-]{36}$/.test(b.idempotencyKey))return text("Invalid recovery snapshot request",400);
          try{
            const op=await project.privateRecoveryPrepare(b.idempotencyKey,b.commit,b.expectedTree,userId,accountKey);
            if (op.cacheState) return text("This recovery snapshot is being removed or has been removed", 409);
            await globalOf(env).reservePrivateRecoveryStorage(recoveryScopeId(op),accountKey);
            if(op.status==="ready")return json(op);
            const existing=await env.PRIVATE_RECOVERY_WORKFLOW.get(recoveryScopeId(op)).then(async handle=>({handle,status:await handle.status()})).catch(()=>null);
            if (!existing || existing.status.status === "errored" || existing.status.status === "terminated") {
              await project.privateRecoveryMarkDispatch(op.id, "uncertain", recoveryScopeId(op));
              if (!existing) await env.PRIVATE_RECOVERY_WORKFLOW.create({ id: recoveryScopeId(op), params: { projectId, operationId: op.id } });
              else await existing.handle.restart();
              await project.privateRecoveryMarkDispatch(op.id, "started", recoveryScopeId(op));
            }
            return json(op,202);
          }catch{return text("Preparation was not confirmed. Retry the same request to reconcile its saved state.",409);}
        }
        const recoveryRemoval = /^\/recovery\/([a-f0-9-]{36})$/.exec(sub);
        if (recoveryRemoval && method === "DELETE") {
          if (!isOwner) return text("Only the owner can remove cached recovery bundles", 403);
          const confirmation = await body<{ confirmation: string }>();
          if (Object.keys(confirmation).some(key => key !== "confirmation") || confirmation.confirmation !== `DELETE CACHED BUNDLE ${recoveryRemoval[1]}`) return text("Exact cached-bundle deletion confirmation required", 400);
          try {
            const operation = await project.privateRecoveryBeginDeletion(recoveryRemoval[1]!, userId);
            const outcome = await cleanupPrivateRecoveryOutcome(env, project, operation);
            return json({ ...outcome, status: outcome.deleted ? "deleted" : "deleting" }, outcome.deleted ? 200 : 202);
          } catch { return text("Cached recovery removal was not confirmed", 409); }
        }
        const recoveryDownload=/^\/recovery\/([a-f0-9-]{36})\/bundle$/.exec(sub);
        if(recoveryDownload&&(method==="GET"||method==="HEAD")){
          const op=await project.privateRecoveryOperation(recoveryDownload[1]!);
          if(!op?.receipt||op.status!=="ready")return text("Saved recovery bundle is not ready",409);
          const receipt=op.receipt;
          return downloadPrivateRecovery(request,{snapshot:receipt,receipt,objectKey:recoveryBundleKey(op),getObject:key=>env.EVIDENCE_BUCKET.get(key),authorize:async()=>{
            try{const current=await authenticate(request,env);return !(current instanceof Response)&&current.id===userId&&(!current.tokenRepo||current.tokenRepo===projectId)&&await account.accountLifecycle()==="active"&&await project.canGitAccess(userId,null,false)&&await project.privateRecoveryReadable(op.id);}catch{return false;}
          }});
        }
        if (sub === "" && method === "GET") return json({ id: projectId, role, kind: state.kind ?? "demo", name: state.projectName, source: state.source ?? null, verification: state.verificationPolicy, protectedPaths: settings.protectedPaths, visibility: await project.repositoryVisibility(), ...(role === "owner" ? {moderation:ownerModerationNotice(await project.repositoryModerationState())} : {}) });
        const historyOperationRoute = /^\/import-history\/(import-history-[a-f0-9-]{36})$/.exec(sub);
        if((sub==="/import-history"&&method==="POST")||(historyOperationRoute&&method==="GET")){
          if(!isOwner)return text("Only the owner can inspect import history",403);
          const authorizeHistoryOwner=async()=>{const current=await authenticate(request,env);return !(current instanceof Response)&&current.id===userId&&(!current.viaToken||current.tokenScope==="full")&&(!current.tokenRepo||current.tokenRepo===projectId)&&await account.accountLifecycle()==="active"&&await project.roleOf(userId)==="owner"&&!await project.repositoryDeletionPending()&&(await project.getState()).canonicalRepoName===state.canonicalRepoName;};
          if(!await authorizeHistoryOwner())return text("Import inspection owner access changed",403);
          const job=await account.getImportJob(projectId);
          if(!job||job.ownerId!==userId||job.status!=="ready"||job.canonicalRepoName!==state.canonicalRepoName)return text("Ready owned import required",409);
          if(!job.importedHead||!job.importedBranch)return json({status:"unavailable",canResume:false,detail:"This legacy import has no recorded import-time head; current branch history is not a substitute."},409);
          const input=method==="POST"&&request.body?await body<{instanceId?:string;expectedGeneration?:number}>():{};
          if(Object.keys(input).some(key=>key!=="instanceId"&&key!=="expectedGeneration")||(input.instanceId!==undefined&&!/^import-history-[a-f0-9-]{36}$/.test(input.instanceId))||(input.expectedGeneration!==undefined&&(!Number.isSafeInteger(input.expectedGeneration)||input.expectedGeneration<0)))return text("Invalid inspection resume request",400);
          const proposed=`import-history-${crypto.randomUUID()}`;
          const operation=method==="GET"?await account.getImportHistoryOperation(historyOperationRoute![1]!):input.instanceId?await account.getImportHistoryOperation(input.instanceId):await account.claimImportHistoryOperation({protocolVersion:2,projectId,head:job.importedHead,canonicalRepoName:state.canonicalRepoName,ownerId:userId,instanceId:proposed});
          if(!operation||operation.ownerId!==userId||operation.projectId!==projectId||operation.canonicalRepoName!==state.canonicalRepoName||operation.head!==job.importedHead)return text("Saved inspection not found",404);
          let inspection=await project.getHistoryInspection(operation.instanceId);
          if(!inspection&&operation.protocolVersion===2)inspection=await project.beginHistoryInspection(operation.instanceId,accountKey,operation.head);
          if(!inspection){
            let providerStatus:string="unavailable";try{providerStatus=(await(await env.IMPORT_HISTORY_WORKFLOW.get(operation.instanceId)).status()).status;}catch{/* Unknown old dispatch never authorizes a replacement. */}
            let receipt:unknown=null;
            if(method==="GET")try{const object=await env.EVIDENCE_BUCKET.get(importHistoryReceiptKey(projectId,operation.head,operation.instanceId));if(object&&object.size<=131072){const saved=await object.json<{projectId:string;canonicalRepoName:string;expectedHead:string;workflowInstanceId:string;result:unknown;inspectedAt:string}>();if(saved.projectId===projectId&&saved.canonicalRepoName===operation.canonicalRepoName&&saved.expectedHead===operation.head&&saved.workflowInstanceId===operation.instanceId)receipt={head:saved.expectedHead,inspectedAt:saved.inspectedAt,result:saved.result};}}catch{/* Optional legacy copy is unavailable. */}
            if(!await authorizeHistoryOwner())return text("Import inspection owner access changed",403);
            return json({instanceId:operation.instanceId,head:operation.head,status:"unavailable",reason:"legacy_attempt_untracked",workflowStatus:providerStatus,canResume:false,authority:receipt?"legacy-r2":"unavailable",receipt,detail:"Legacy attempt dispatch and native shutdown are not durably recorded. No replacement was started."},method==="POST"?202:200);
          }
          let attempt=inspection.currentAttempt,workflowStatus:string|null=null;
          if(attempt&&attempt.dispatch!=="saved"){
            try{workflowStatus=(await(await env.IMPORT_HISTORY_WORKFLOW.get(attempt.workflowId)).status()).status;if(["queued","running","waiting","complete","errored","terminated"].includes(workflowStatus))await project.observeHistoryInspectionAttempt(operation.instanceId,attempt.generation,workflowStatus);}catch{workflowStatus="unavailable";}
            inspection=(await project.getHistoryInspection(operation.instanceId))!;attempt=inspection.currentAttempt;
          }
          if(operation.protocolVersion===2&&attempt?.terminal&&attempt.nativeState==="possible"&&(method==="GET"||input.expectedGeneration===attempt.generation)){try{await project.historyInspectionNativeStopped(operation.instanceId,attempt.generation,attempt.nativeRunId);inspection=(await project.getHistoryInspection(operation.instanceId))!;attempt=inspection.currentAttempt;}catch{/* Unknown stop keeps recovery disabled. */}}
          const canResume=inspection.status==="paused"&&Boolean(attempt?.terminal)&&attempt?.nativeState!=="possible"&&!['unsupported_source','inspection_capacity','source_shallow','history_metadata_capacity'].includes(inspection.reason??"");
          if(method==="POST"&&inspection.status!=="verified"&&inspection.status!=="mismatch"){
            if(!attempt){if(operation.protocolVersion!==2)return json({instanceId:operation.instanceId,head:operation.head,status:inspection.status,reason:"attempt_identity_unavailable",canResume:false,detail:"Saved attempt identity is unavailable; no replacement was started."},202);attempt=await project.startHistoryInspectionAttempt(operation.instanceId,0);}
            else if(canResume&&input.expectedGeneration===attempt.generation){attempt=await project.startHistoryInspectionAttempt(operation.instanceId,attempt.generation);inspection=(await project.getHistoryInspection(operation.instanceId))!;}
            else if(input.expectedGeneration!==undefined&&input.expectedGeneration!==attempt.generation&&input.expectedGeneration+1!==attempt.generation)return text("Inspection attempt changed; refresh before resuming",409);
            const withinDeliveryWindow=Date.now()<=Date.parse(attempt.deliveryUntil);
            if(attempt.dispatch==="saved"||(attempt.dispatch==="unknown"&&!attempt.terminal&&withinDeliveryWindow)){
              const {plan}=await account.getBilling();const denied=await admitRun(env,account,planLimits(env)[plan],attempt.workflowId);if(denied)return denied;
              if(!await authorizeHistoryOwner())return text("Import inspection owner access changed",403);
              await project.markHistoryInspectionDispatch(operation.instanceId,attempt.generation);
              try{await env.IMPORT_HISTORY_WORKFLOW.createBatch([{id:attempt.workflowId,params:{accountKey,projectId,expectedHead:operation.head,operationId:operation.instanceId,attemptGeneration:attempt.generation},retention:{successRetention:"3 days",errorRetention:"3 days"}}]);workflowStatus="delivery-confirmed";}catch{workflowStatus="unavailable";}
              inspection=(await project.getHistoryInspection(operation.instanceId))!;attempt=inspection.currentAttempt;
            }
          }
          if(!await authorizeHistoryOwner())return text("Import inspection owner access changed",403);
          const resumable=inspection.status==="paused"&&Boolean(attempt?.terminal)&&attempt?.nativeState!=="possible"&&!['unsupported_source','inspection_capacity','source_shallow','history_metadata_capacity'].includes(inspection.reason??"");
          return Response.json({instanceId:operation.instanceId,head:operation.head,status:inspection.status,reason:inspection.reason,progress:{source:inspection.source,destination:inspection.destination},attemptGeneration:attempt?.generation??null,workflowStatus:workflowStatus??(attempt?.terminal??null),canResume:resumable,authority:"durable-sql",receipt:inspection.result?{head:operation.head,inspectedAt:inspection.result.destinationCapturedAt,result:inspection.result}:null},{status:method==="POST"?202:200,headers:{"Cache-Control":"no-store"}});
        }

        if (sub === "/directory" && method === "GET") {
          if (!isOwner) return text("Only the owner can manage directory listings",403);
          return json(await project.directoryState());
        }
        if (sub === "/directory" && method === "PUT") {
          if (!isOwner) return text("Only the owner can manage directory listings",403);
          const value = directoryUpdateSchema.safeParse(await body<unknown>());
          if (!value.success) return text("Explicit publication confirmation and current settings version are required",400);
          try { return json(await project.configureDirectory(value.data,userId)); }
          catch { return text("Directory settings changed or the repository is private; reload before saving",409); }
        }
        if (sub === "/visibility" && method === "POST") {
          if (!isOwner) return text("Only the owner can change visibility", 403);
          const value = await body<{ visibility?: string; confirmed?: boolean }>();
          if (value.visibility !== "public" && value.visibility !== "private") return text("Invalid visibility", 400);
          if (value.visibility === "public" && value.confirmed !== true) return text("Confirm that all accepted source and history will become public", 400);
          await project.setRepositoryVisibility(value.visibility, value.confirmed === true, userId);
          return json({ visibility: await project.repositoryVisibility() });
        }

        if (sub === "/state" && method === "GET") {
          if (settings.fixture === "ticket-booking") {
            ctx.waitUntil(ensureBuild(env, projectId, state.acceptedState.currentCommit, state.canonicalRepoName, accountKey).catch((e) => console.error("preview build failed", String(e))));
          }
          return json({ ...state, role });
        }

        if (sub === "/activity" && method === "GET") return json(await project.listActivity(60));
        const privateDiscussion=/^\/discussions(?:\/(settings|permissions|discussion_[a-f0-9-]{36})(?:\/(replies|control))?)?$/.exec(sub);
        if(privateDiscussion){
          const profile=await account.getProfile(),actor={userId,accountKey,displayName:profile.displayName||"Contributor"};
          try{
            if(privateDiscussion[1]==="settings"&&method==="PUT"&&!isOwner)return text("Owner account administration required",403);
            if(privateDiscussion[1]==="settings"&&(method==="GET"||method==="PUT"))return json(await project.discussionSettings(actor,method==="PUT"?await body<unknown>():undefined));
            if(privateDiscussion[1]==="permissions"&&method==="GET"){const id=url.searchParams.get("topic")??"";if(!/^discussion_[a-f0-9-]{36}$/.test(id))return text("Invalid discussion",400);return json(await project.discussionPermissions(actor,id,false,canAdminister));}
            if(method==="GET")return json(privateDiscussion[1]?await project.discussionTopic(privateDiscussion[1],false,actor):await project.discussionList(false,actor));
            const operation=!privateDiscussion[1]&&method==="POST"?"create":privateDiscussion[2]==="replies"&&method==="POST"?"reply":privateDiscussion[2]==="control"&&method==="POST"?"control":!privateDiscussion[2]&&method==="PATCH"?"edit":!privateDiscussion[2]&&method==="DELETE"?"remove":null;
            if(!operation)return text("Not found",404);const input=await body<Record<string,unknown>>();if(!canAdminister&&(operation==="control"&&input.locked!==undefined||operation==="create"&&input.category==="announcements"))return text("Owner account administration required",403);return json(await project.discussionMutate(actor,operation,input,privateDiscussion[1],false,canAdminister),operation==="create"||operation==="reply"?201:200);
          }catch(error){if(error instanceof RequestBodyError)throw error;return text("Discussion change was not saved; check repository access and current version",409);}
        }
        if (sub === "/community" && method === "GET") {
          if (!isOwner) return text("Only the owner can configure public participation", 403);
          return json(await project.publicCommunity());
        }
        if (sub === "/community" && method === "PUT") {
          if (!isOwner) return text("Only the owner can configure public participation", 403);
          const value = await body<{ policy: PublicCommunityPolicy; confirmed?: boolean }>();
          const profile = await account.getProfile();
          try { return json({ policy: await project.configurePublicCommunity(value.policy, value.confirmed === true, { userId, accountKey, displayName: profile.displayName || "Maintainer" }) }); }
          catch { return text("Public participation requires explicit owner confirmation and a public repository", 409); }
        }
        if (sub === "/community/requests" && method === "GET") {
          if (!isOwner) return text("Only the owner can review contribution requests", 403);
          const profile = await account.getProfile();
          return json({ requests: await project.publicContributionRequests({ userId, accountKey, displayName: profile.displayName || "Maintainer" }) });
        }
        const contributionDecision = /^\/community\/requests\/(request_[a-f0-9-]{36})\/decision$/.exec(sub);
        if (contributionDecision && method === "POST") {
          if (!isOwner) return text("Only the owner can decide contribution access", 403);
          const value = await body<{ decision?: string; confirmedPrivateAccess?: boolean }>();
          if (value.decision !== "approved" && value.decision !== "rejected") return text("Invalid contribution decision", 400);
          const profile = await account.getProfile();
          const actor = { userId, accountKey, displayName: profile.displayName || "Maintainer" };
          let request;
          try { request = await project.decidePublicContribution(actor, contributionDecision[1]!, value.decision, value.confirmedPrivateAccess === true); }
          catch { return text("Access was not changed; approval requires explicit acknowledgment of private repository context", 409); }
          return json({ request },request.registrationStatus==="pending"?202:200);
        }

        if(sub==="/preview/recover-generation"&&method==="POST"){
          if(!isOwner)return text("Only the owner can replace a preview",403);
          const input=await body<{commit?:unknown;expectedGeneration?:unknown;idempotencyKey?:unknown}>();
          const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
          if(Object.keys(input).some(key=>!["commit","expectedGeneration","idempotencyKey"].includes(key))||typeof input.commit!=="string"||input.commit!==state.acceptedState.currentCommit||typeof input.idempotencyKey!=="string"||!uuid.test(input.idempotencyKey)||(input.expectedGeneration!==null&&(typeof input.expectedGeneration!=="string"||!uuid.test(input.expectedGeneration))))return text("Exact accepted commit, generation and stable request key required",400);
          if(settings.fixture!=="ticket-booking")return text("This repository uses external preview tooling",409);
          try{
            await project.previewStorageScope(input.commit,state.canonicalRepoName);
            const previous=input.expectedGeneration===null?null:await project.previewGenerationGet(input.expectedGeneration);
            if(previous&&previous.identity.commit!==input.commit)return text("Preview generation belongs to another commit",409);
            const freshIdentity=await project.previewStorageScope(input.commit,state.canonicalRepoName);
            const source=await fundedPreviewSource(env,freshIdentity,previous),sourceKey=source.key;
            const operation=await project.previewGenerationBegin(input.commit,state.canonicalRepoName,userId,input.expectedGeneration,input.idempotencyKey,sourceKey);
            const record=operation.record;
            if(operation.status==="duplicate"&&record.state!=="requested")return json({generationId:record.generation,status:record.state},202);
            const manifest=await globalOf(env).previewGenerationEstimate(sourceKey,record.identity,record.generation);
            const funding=await globalOf(env).reservePreviewGenerationEstimate(manifest);
            if(!funding.allowed){await project.previewGenerationFail(record.generation,"storage_unavailable");return text("Replacement preview storage allowance is unavailable; existing upload holds were preserved and no compute was started",409);}
            await project.previewGenerationScope(record.generation);
            await globalOf(env).quarantinePreviewStorage(sourceKey,record.identity);
            const oldOperation=previous?`build-generation-${previous.generation}`:`build-${projectId}-${input.commit}`;
            const freshRecoveryScope=await project.previewGenerationScope(record.generation);
            if(JSON.stringify({...record.identity,generation:record.generation})!==JSON.stringify(freshRecoveryScope))throw new Error("Preview recovery owner or incarnation changed");
            try{if((await globalOf(env).nativeComputeStatus(oldOperation))?.active)await recoverNativeCompute(env,oldOperation);}
            catch{await project.previewGenerationFail(record.generation,"previous_compute_stop_unconfirmed");return text("Previous preview workspace stop is unconfirmed; replacement was not dispatched and all storage holds remain reserved",409);}
            await project.previewGenerationScope(record.generation);
            ctx.waitUntil(buildPreviewGeneration(env,projectId,record.generation).catch(()=>console.error("Replacement preview could not start; generation remains recoverable")));
            return json({generationId:record.generation,status:"requested"},202);
          }catch{return text("Replacement preview was not confirmed; reload and retry the identical request key",409);}
        }
        if(sub==="/preview/retry"&&method==="POST"){
          if(!isOwner)return text("Only the owner can retry preview compute",403);
          const input=await body<{commit?:unknown}>();
          const state=await project.getState(),key=`build-${projectId}-${state.acceptedState.currentCommit}`;
          if(settingsFor(state.verificationPolicy).fixture!=="ticket-booking")return text("This repository uses external preview tooling",409);
          if(typeof input.commit!=="string"||input.commit!==state.acceptedState.currentCommit)return text("Preview retry must reference the current accepted commit",409);
          if(await project.roleOf(userId)!=="owner")return text("Owner access was revoked",403);
          const fundingFailure=await globalOf(env).nativeComputeFailureReason(key);
          if((await globalOf(env).previewStorageWriterState(buildPrefix(projectId,state.acceptedState.currentCommit))).unfinished)return text("Preview publication has unfinished upload receipts; retry requires storage reconciliation and no compute was started",409);
          if(fundingFailure==="storage_capacity"||fundingFailure==="storage_unconfigured"||fundingFailure==="storage_retired"){
            const scope=await project.previewStorageScope(state.acceptedState.currentCommit,state.canonicalRepoName);
            const readmission=await globalOf(env).previewStorageReadmission(scope);
            if(!readmission.allowed)return text("Preview storage allowance remains unavailable; no compute was started",409);
            const freshScope=await project.previewStorageScope(state.acceptedState.currentCommit,state.canonicalRepoName);
            if(JSON.stringify(scope)!==JSON.stringify(freshScope))return text("Preview ownership changed; reload before retrying",409);
          }
          try {
            await recoverNativeCompute(env,key);
            await globalOf(env).setNativeComputeFailure(key,false);
            ctx.waitUntil(ensureBuild(env,projectId,state.acceptedState.currentCommit,state.canonicalRepoName,accountKey).catch(()=>console.error("Explicit preview retry failed")));
            return json({status:"requested"},202);
          }catch{return text("Previous preview workspace stop is unconfirmed; retry remains locked",409);}
        }
        if(sub==="/preview/recover"&&method==="POST"){
          if(!isOwner)return text("Only the owner can recover preview compute",403);
          const state=await project.getState();
          try{return json(await recoverNativeCompute(env,`build-${projectId}-${state.acceptedState.currentCommit}`));}
          catch{return text("Preview workspace stop remains unconfirmed; saved Git state is preserved and retry remains locked",409);}
        }
        if(sub==="/deployments/recover"&&method==="POST"){
          if(!isOwner)return text("Only the owner can recover deployment compute",403);
          const parsed=deploymentRequestParametersSchema.safeParse(await body<unknown>());
          if(!parsed.success)return text("Valid saved deployment request parameters required",400);
          const operationKey=`deployment-${await accountKeyFor(`${projectId}-${userId}-${parsed.data.idempotencyKey}`)}`;
          try{return json(await recoverNativeCompute(env,operationKey));}
          catch{return text("Deployment workspace stop remains unconfirmed; retained Git state is preserved and retry remains locked",409);}
        }
        if(sub==="/deployments"&&method==="GET")return json({deployments:await project.listDeployments()});
        if(sub==="/deployment-targets"&&method==="GET"){
          if(!isOwner)return text("Only the owner can select deployment targets",403);
          return json({targets:await project.acceptedDeploymentTargets()});
        }
        if(sub==="/deployments"&&method==="POST"){
          if(!isOwner)return text("Only the owner can request deployment delivery",403);
          const parsed=deploymentRequestParametersSchema.safeParse(await body<unknown>());
          if(!parsed.success)return text("Valid accepted journal, service, environment and stable request key are required",400);
          const input=parsed.data;
          const accepted=await project.acceptedDeploymentTarget(input.journalId);
          if(!accepted)return text("Only recoverable accepted publication journals can be deployment targets",409);
          try{
            const service=await project.connectionSigningConfig(input.serviceId);
            if(!service?.capabilities.includes("report-deployment"))return text("Register an active deployment reporting service first",409);
            if(!(await project.listWebhooks()).some(hook=>hook.active&&hook.events.split(",").includes("deployment.requested")))return text("Configure an active deployment.requested webhook first",409);
            const duplicate = await project.existingDeploymentRequest(accepted.target,input.serviceId,input.environment,input.idempotencyKey,userId);
            if(duplicate)return json({kind:"duplicate",deployment:duplicate});
            const operationKey = `deployment-${await accountKeyFor(`${projectId}-${userId}-${input.idempotencyKey}`)}`;
            const computeLease = await claimNativeCompute(env, operationKey);
            if(!computeLease)return text("Deployment verification is already in progress; retry the same key",409);
            let nativeStopConfirmed = false;
            try {
              await retainDeploymentTarget(env,accepted.canonicalRepoName,accepted.target,accountKey,`native-${computeLease}`);
              nativeStopConfirmed = true;
              return json(await project.requestDeployment(accepted.target,input.serviceId,input.environment,input.idempotencyKey,userId),201);
            } catch(error) {
              if(error instanceof NativeComputeAdmissionError) nativeStopConfirmed=true;
              throw error;
            } finally { if(nativeStopConfirmed)await globalOf(env).finishNativeCompute(operationKey,computeLease); }
          }catch{return text("Deployment request was not dispatched; inspect the accepted journal, retained ref and configured service before retrying the same key",409);}
        }

        if (sub === "/connections" && method === "GET") {
          if (!isOwner) return text("Only the owner can configure connections", 403);
          return json(await project.listConnections());
        }
        if (sub === "/connections" && method === "POST") {
          if (!isOwner) return text("Only the owner can configure connections", 403);
          const value = await body<{ name: string; capabilities: Array<typeof integrationCapabilities[number]> }>();
          try { return json(await project.createConnection(value.name, value.capabilities), 201); } catch { return text("Invalid connection", 400); }
        }
        if (sub === "/connections/policy" && method === "PUT") {
          if (!isOwner) return text("Only the owner can configure checks", 403);
          const policy = await body<ExternalCheckPolicy>();
          if (policy.mode === "external" && !isCommandPolicy(state.verificationPolicy)) return text("External CI is available for imported custom repositories; this demo retains its protected checks", 409);
          try { return json({ policy: await project.setConnectionPolicy(policy) }); } catch { return text("Invalid or stale check policy", 409); }
        }
        const connectionRoute = /^\/connections\/(svc_[a-f0-9-]{36})$/.exec(sub);
        if (connectionRoute && method === "DELETE") {
          if (!isOwner) return text("Only the owner can revoke connections", 403);
          await project.revokeConnection(connectionRoute[1]!); return json({ revoked: true });
        }
        const checksRoute = /^\/candidates\/([a-z0-9_-]+)\/checks$/.exec(sub);
        if (checksRoute && method === "GET") {
          const [checks, reports] = await Promise.all([project.externalChecks(checksRoute[1]!), project.externalCheckReports(checksRoute[1]!)]);
          return json({ checks, reports });
        }
        if (checksRoute && method === "POST") {
          if (!isOwner) return text("Only the owner can retry checks", 403);
          const value = await body<{ checkId: string }>();
          try { return json({ checks: await project.registerExternalRun(checksRoute[1]!, value.checkId, `run_${crypto.randomUUID()}`) }, 201); } catch { return text("Unknown candidate or check", 404); }
        }

        // Repository reads validate the entire request before acquiring storage.
        if (method === "GET" && ["/commits", "/tree", "/blob", "/diff", "/blob-by-hash"].includes(sub)) {
          let browseRequest;
          try { browseRequest = parseSignedRepositoryBrowseRequest(sub, url.searchParams); }
          catch (error) { return repositoryReadJson({ error: error instanceof Error ? error.message : "Invalid repository request" }, error instanceof RepositoryBrowseRequestError ? error.status : 400); }
          const inputTaskId = "input" in browseRequest ? browseRequest.input : undefined;
          const taskId = inputTaskId ?? ("task" in browseRequest ? browseRequest.task : undefined);
          const candidateId = "candidate" in browseRequest ? browseRequest.candidate : undefined;
          const task = taskId && Object.hasOwn(state.tasks, taskId) ? state.tasks[taskId] : undefined;
          const candidate = candidateId && Object.hasOwn(state.candidates, candidateId) ? state.candidates[candidateId] : undefined;
          if (taskId && !task) return repositoryReadText("Unknown change", 404);
          if (candidateId && (!candidate || (!inputTaskId && !candidate.candidateCommit))) return repositoryReadText("Unknown candidate", 404);
          if (inputTaskId && (!candidate?.participatingTaskIds.includes(inputTaskId) || !candidate.participatingCommits[inputTaskId])) return repositoryReadText("Unknown frozen contribution input", 404);
          let repoName = task?.workspace.repoName ?? state.canonicalRepoName;
          let readContext;
          try { readContext = await project.repositoryReadContext(userId, taskId ?? null, candidateId ?? null); }
          catch { return repositoryReadJson({ error: "Repository read scope is unavailable", reason: "authorization" }, 503); }
          if (inputTaskId && readContext?.retainedInputReceiptId) repoName = state.canonicalRepoName;
          if (!readContext || readContext.repoName !== repoName || readContext.canonicalRepoName !== state.canonicalRepoName) return repositoryReadText("Repository read scope is unavailable", 503);
          const frozenProofBase = inputTaskId ? candidate?.frozenContributorProofs?.find(proof => proof.id === inputTaskId && proof.commit === readContext.candidateInputCommit)?.baseCommit : undefined;
          const inputBaseMatches = frozenProofBase !== undefined
            ? readContext.candidateInputBase === frozenProofBase
            : readContext.retainedInputReceiptId
              ? /^[a-f0-9]{40}$/.test(readContext.candidateInputBase ?? "")
              : readContext.candidateInputBase === undefined;
          if (inputTaskId && (!/^[a-f0-9]{40}$/.test(readContext.candidateInputCommit ?? "") || readContext.candidateInputCommit !== candidate?.participatingCommits[inputTaskId] || !inputBaseMatches)) return repositoryReadJson({ error: "Frozen input identity changed; no workspace read was started" }, 503);
          const reserveRepositoryBrowse = (operationId: string) => globalOf(env).reserveRepositoryReadOperation(operationId, readContext.accountKey);
          const credentialHash = auth.viaToken ? await gitParentTokenHash(request) : undefined;
          const authorizeRead = async () => {
            const sessionValid = () => auth.viaToken ? Boolean(credentialHash) : Boolean(auth.expiresAt && auth.expiresAt > Date.now());
            if (!sessionValid() || !await project.assertRepositoryReadContext(readContext, userId, taskId ?? null, credentialHash, candidateId ?? null) || !sessionValid()) throw new RepositoryReadError(503, "authorization");
          };
          try {
            await authorizeRead();
            using repo = await openRepositoryRead(env, { repoName, authorize: authorizeRead, reserveGroup: reserveRepositoryBrowse, ...(browseRequest.kind === "diff" ? { limits: { maxProviderCalls: 10_016, deadlineMs: 120_000 } } : {}) });
            let result: unknown;
            if (browseRequest.kind === "history") result = await listCommits(repo, browseRequest.ref, browseRequest.limit, browseRequest.offset);
            else if (browseRequest.kind === "directory" || browseRequest.kind === "file") {
              const commit = await resolveCommit(repo, browseRequest.ref);
              if (!commit) return repositoryReadText("Nothing here yet", 404);
              result = browseRequest.kind === "directory" ? { commit, entries: await listDirectory(repo, commit, browseRequest.path) } : { commit, path: browseRequest.path, ...(await readFileText(repo, commit, browseRequest.path)) };
            } else if (browseRequest.kind === "blob") result = await readBlobByHash(repo, browseRequest.hash);
            else {
              let headCommit = inputTaskId ? readContext.candidateInputCommit : candidate?.candidateCommit ?? task?.currentCommit ?? browseRequest.commit;
              const baseCommit = inputTaskId ? readContext.candidateInputBase : candidate?.expectedAcceptedBase ?? task?.baseCommit ?? browseRequest.base;
              if (browseRequest.commit && browseRequest.commit.length < 40) {
                const recent = await listCommits(repo, undefined, 100, 0);
                const matches = recent.filter((commit) => commit.hash.startsWith(browseRequest.commit!));
                if (matches.length !== 1) return repositoryReadText(matches.length ? "Abbreviated hash is ambiguous" : "No recent commit matches that hash", matches.length ? 400 : 404);
                headCommit = matches[0]!.hash;
              }
              const head = await resolveCommit(repo, headCommit);
              if (!head) return inputTaskId ? repositoryReadJson({ error: "The recorded input commit is unavailable in its saved repository. No newer checkpoint was substituted." }, 503) : repositoryReadText("Commit not found", 404);
              const base = baseCommit ? await resolveCommit(repo, baseCommit) : head.parents[0] ? await resolveCommit(repo, head.parents[0]) : null;
              if ((baseCommit || head.parents[0]) && !base) return repositoryReadText("The comparison base could not be read; no complete diff is available. Retry.", 503);
              result = { repo: taskId ? `task:${taskId}` : "canonical", base: base?.hash ?? null, head, files: await diffTrees(repo, base?.treeHash, head.treeHash), ...(inputTaskId ? { input: { taskId: inputTaskId, commit: head.hash, baseSource: baseCommit ? "recorded-contribution-base" : "commit-parent" } } : {}) };
            }
            await authorizeRead();
            return Response.json(result, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
          } catch (error) {
            if (error instanceof RepositoryReadError) return repositoryReadJson({ error: error.message, reason: error.reason }, error.status);
            if (error instanceof RepositoryBrowseRequestError) return repositoryReadJson({ error: error.message }, error.status);
            if (error instanceof Error && error.message.includes("5,000-file inspection limit")) return repositoryReadJson({ error: "Diff exceeds the supported 5,000-file inspection limit; no complete diff is available" }, 413);
            if (error instanceof Error && ["Path not found", "File not found", "Blob not found"].includes(error.message)) return repositoryReadJson({ error: "Repository content not found" }, 404);
            return repositoryReadJson({ error: "Repository content unavailable; no complete response is available. Retry." }, 503);
          }
        }

        // Revoke only this actor's opaque Git credentials; other contributors retain access.
        if(sub === "/git-credentials" && method === "DELETE") {
          await project.revokeGitCapabilities(userId);
          return json({revoked:true});
        }

        // ----- clone credentials (read-only, short-lived) -----
        if (sub === "/clone" && method === "POST") {
          const remote = gitRemote(url.origin,projectId,null);
          const {token}=await project.mintGitCapability(userId,null,false,await gitParentTokenHash(request));
          return json({ remote, token, expiresInSeconds: 3600, command: gitCloneCommand(remote) });
        }

        // ----- changes (tasks) -----
        if (sub === "/tasks" && method === "POST") {
          const b = await body<{ taskId?: string; goal?: string; name?: string; dependsOn?: string; issue?: number }>();
          const goal = clean(b.goal, 300);
          if (!b.taskId || !TASK_ID.test(b.taskId) || !goal) return text("taskId (3-101 chars: a-z, 0-9, -) and goal are required", 400);
          if(Object.keys(b).some(key=>!["taskId","goal","name","dependsOn","issue"].includes(key)))return text("Invalid change creation input",400);
          const input=taskCreationInputSchema.safeParse({goal,dependsOn:b.dependsOn??null,issue:b.issue??null});
          if(!input.success)return text("Invalid change goal, dependency or issue",400);
          let replay;
          try{replay=await project.taskCreationReplay(b.taskId,userId,input.data);}catch{return text("Existing change cannot be recovered with this creator and input. No workspace was allocated.",409);}
          if(replay){
            const terminal=replay.status==="accepted"||replay.status==="cancelled";
            const remote=gitRemote(url.origin,projectId,replay.id);
            if(terminal)return json({task:replay.id,remote,branch:replay.workspace.branch,replayed:true,terminal:true,status:replay.status,agentRunId:replay.agentRunId??null,commands:[]});
            try{
              const {token}=await project.mintGitCapability(userId,replay.id,true,await gitParentTokenHash(request));
              const current=await project.taskCreationReplay(replay.id,userId,input.data);
              if(!current||current.status==="accepted"||current.status==="cancelled")return text("Saved change state changed during recovery; retry to read its current state",409);
              return json({task:current.id,remote,branch:current.workspace.branch,token,expiresInSeconds:3600,replayed:true,terminal:false,status:current.status,agentRunId:current.agentRunId??null,commands:taskGitCommands({remote,taskId:current.id,branch:current.workspace.branch,commit:current.currentCommit,stacked:!!current.dependsOn,replayed:true})});
            }catch{return text("Saved change was found, but current Git access was not confirmed. No new workspace was allocated.",409);}
          }
          if (input.data.issue !== null && !(await project.getIssue(input.data.issue))) return text("Unknown issue", 400);
          const parent = b.dependsOn ? state.tasks[b.dependsOn] : undefined;
          if (b.dependsOn && (!parent || parent.status === "cancelled")) return text("dependsOn must name an existing, uncancelled change", 400);
          const source = await env.ARTIFACTS.get(parent ? parent.workspace.repoName : state.canonicalRepoName);
          const repoName = taskRepoName(projectId, b.taskId);
          const fork = await allocateArtifact(env,{name:repoName,projectId,userId,kind:"workspace"},()=>source.fork(repoName,{description:goal}));
          const remote=gitRemote(url.origin,projectId,b.taskId);
          const now = new Date().toISOString();
          const task: Task = {
            id: b.taskId,
            goal,
            contributor: { id: userId.slice(-12), name: (await account.getProfile()).displayName || clean(b.name, 60) || `member-${userId.slice(-6)}`, type: "human" },
            baseCommit: parent ? parent.currentCommit : state.acceptedState.currentCommit,
            ...(parent ? { dependsOn: parent.id } : {}),
            ...(input.data.issue !== null ? { issue: input.data.issue } : {}),
            allowedScope: settings.allowedScope,
            status: "working",
            requirements: [],
            workspace: { repoName, remote: fork.remote, branch: `task/${b.taskId}` },
            checkpoints: [],
            currentCommit: parent ? parent.currentCommit : state.acceptedState.currentCommit,
            createdAt: now,
            updatedAt: now,
          };
          const saved=await project.createTask(task,userId,input.data);
          const existing=await project.taskCreationReplay(saved.id,userId,input.data);
          if(!existing)return text("Saved change could not be confirmed; retry the same creation request",409);
          if(existing.status==="accepted"||existing.status==="cancelled")return json({task:existing.id,remote,branch:existing.workspace.branch,replayed:true,terminal:true,status:existing.status,agentRunId:existing.agentRunId??null,commands:[]});
          const {token}=await project.mintGitCapability(userId,b.taskId,true,await gitParentTokenHash(request));
          const current=await project.taskCreationReplay(saved.id,userId,input.data);
          if(!current)return text("Saved change state changed; retry the same creation request",409);
          if(current.status==="accepted"||current.status==="cancelled")return json({task:current.id,remote,branch:current.workspace.branch,replayed:true,terminal:true,status:current.status,agentRunId:current.agentRunId??null,commands:[]});
          return json({
            task: b.taskId,
            replayed:saved.creationReplayed===true,terminal:false,status:current.status,agentRunId:current.agentRunId??null,
            remote,
            branch: current.workspace.branch,
            token,
            expiresInSeconds: 3600,
            commands: taskGitCommands({remote,taskId:b.taskId,branch:existing.workspace.branch,commit:existing.baseCommit,stacked:!!existing.dependsOn,replayed:false}),
          }, 201);
        }

        const tokenRoute = /^\/tasks\/([a-z0-9-]+)\/token$/.exec(sub);
        const agentRecordRoute = /^\/tasks\/([a-z0-9-]+)\/agent-run$/.exec(sub);
        if (agentRecordRoute && method === "GET") {
          const task = state.tasks[agentRecordRoute[1]!];
          if (!task) return text("Unknown change", 404);
          const run = task.agentRunId ? await project.getAgentRun(task.agentRunId) : null;
          return Response.json({ run }, { headers: { "Cache-Control": "no-store" } });
        }
        if (tokenRoute && method === "POST") {
          const task = state.tasks[tokenRoute[1]!];
          if (!task || task.status === "accepted" || task.status === "cancelled") return text("Change is not open", 404);
          if(!(await project.canGitAccess(userId,task.id,true)))return text("Only this change's author or repository owner can push",403);
          const {token}=await project.mintGitCapability(userId,task.id,true,await gitParentTokenHash(request));
          return json({ remote: gitRemote(url.origin,projectId,task.id), branch: task.workspace.branch, token, expiresInSeconds: 3600 });
        }

        const taskRoute = /^\/tasks\/([a-z0-9-]+)\/(ready|cancel|agent)$/.exec(sub);
        if (taskRoute && method === "POST") {
          const task = state.tasks[taskRoute[1]!];
          if (!task) return text("Unknown change", 404);
          if (!(await project.canGitAccess(userId, task.id, true))) return text("Only this workspace's contributor or the owner can change it", 403);
          const action = taskRoute[2];
          if (action === "cancel") {
            await project.cancelTask(task.id);
            // Cancellation stops integration, but the contributor's pushed branch remains recoverable.
            return json({ cancelled: task.id });
          }
          if (action === "ready") {
            const parent = task.dependsOn ? state.tasks[task.dependsOn] : undefined;
            if (parent && parent.status !== "accepted") return repositoryReadText(`Stacked on "${parent.id}", which is ${parent.status}; it must be accepted first`, 409);
            if (!isSafeRef(task.workspace.branch)) return repositoryReadText("The saved workspace branch is unavailable; Git work is preserved", 503);
            try {
              const readContext = await project.repositoryReadContext(userId, task.id);
              const credentialHash = auth.viaToken ? await gitParentTokenHash(request) : undefined;
              const authorize = async () => {
                const sessionValid = () => auth.viaToken ? Boolean(credentialHash) : Boolean(auth.expiresAt && auth.expiresAt > Date.now());
                if (!sessionValid() || !await project.assertRepositoryReadContext(readContext, userId, task.id, credentialHash) || !sessionValid()) throw new RepositoryReadError(503, "authorization");
              };
              using repo = await openRepositoryRead(env, { repoName: task.workspace.repoName, authorize, reserveGroup: (operationId) => globalOf(env).reserveRepositoryReadOperation(operationId, readContext.accountKey), limits: { maxProviderCalls: 10_016, deadlineMs: 120_000 } });
              const head = await project.observeTaskReadyGitHead(task.id,userId,readContext,credentialHash,auth.expiresAt);
              if (!head) return repositoryReadText(`Nothing pushed to ${task.workspace.branch} yet`, 409);
              const [base, tip] = await Promise.all([resolveCommit(repo, task.baseCommit), resolveCommit(repo, head)]);
              if (!base || !tip) return repositoryReadText("Could not read the saved change and base; retry without marking ready", 503);
              const filesChanged = (await diffTrees(repo, base.treeHash, tip.treeHash)).map((file) => file.path);
              await authorize();
              await project.observeTaskReadyGitHead(task.id,userId,readContext,credentialHash,auth.expiresAt,head);
              await authorize();
              const { applied } = await project.ingestMemberCheckpoint({ eventId: `ready-${task.id}-${head}`, taskId: task.id, commit: head, ready: true, filesChanged }, userId, readContext, credentialHash, auth.expiresAt);
              return Response.json({ task: task.id, commit: head, applied }, { headers: { "Cache-Control": "no-store" } });
            } catch (error) {
              if (error instanceof RepositoryReadError) return repositoryReadJson({ error: error.message, reason: error.reason, detail: "Pushed Git work is preserved; readiness was not confirmed" }, error.status);
              if (error instanceof Error && error.message.includes("5,000-file inspection limit")) return repositoryReadJson({ error: "Diff exceeds the supported 5,000-file inspection limit; no readiness was recorded. Pushed Git work is preserved." }, 413);
              return repositoryReadJson({ error: "Change inspection is unavailable. Pushed Git work is preserved; retry without creating another workspace." }, 503);
            }
          }
          // AI agent works on this change
          if (["accepted", "cancelled", "integrating", "verifying"].includes(task.status)) return text("This change cannot start an agent in its current state", 409);
          const agentRequest = await body<{ resumeFrom?: unknown }>();
          let resumeFrom: string | undefined;
          if (agentRequest.resumeFrom !== undefined) {
            if (typeof agentRequest.resumeFrom !== "string" || agentRequest.resumeFrom !== task.agentRunId) return text("Select this change's saved agent work", 400);
            const previous = await project.getAgentRun(agentRequest.resumeFrom);
            if (previous?.taskId !== task.id || previous.phase !== "failed" || !previous.proposal) return text("No failed saved proposal is available to resume", 409);
            if (previous.goal !== redactSecrets(task.goal)) return text("This change's purpose changed; inspect the saved proposal before starting new work", 409);
            try {
              const files = Object.keys(previous.proposal.files);
              assertAgentWrites({ allowedScope: task.allowedScope ?? settings.allowedScope }, files, settings.protectedPaths);
              assertAgentWrites({ allowedScope: settings.allowedScope }, files, settings.protectedPaths);
            } catch { return text("Current permissions no longer allow this saved proposal; its files remain available for review", 409); }
            resumeFrom = previous.runId;
          }
          const { plan } = await account.getBilling();
          const instanceId = `agent-${projectId}-${task.id}-${crypto.randomUUID()}`;
          const spendDenied = await reserveManagedAgents(env, accountKey, [instanceId]);
          if (spendDenied) return spendDenied;
          const denied = await admitRun(env, account, planLimits(env)[plan], instanceId);
          if (denied) { await globalOf(env).cancelUnstartedManagedSpend([instanceId], accountKey); return denied; }
          if (!(await project.beginAgentTask(task.id, instanceId))) {
            await globalOf(env).cancelUnstartedManagedSpend([instanceId], accountKey);
            return text("This change already has active agent work or cannot start an agent", 409);
          }
          let instance: WorkflowInstance;
          let dispatchAttempted = false;
          try {
            await project.registerWorkflow(instanceId, "agent", task.id, userId);
            dispatchAttempted = true;
            await globalOf(env).markManagedDispatchAttempted([instanceId], accountKey);
            instance = await env.AGENT_WORKFLOW.create({ id: instanceId, params: { projectId, accountKey, taskId: task.id, ...(resumeFrom ? { resumeFrom } : {}) } });
          } catch {
            if (!dispatchAttempted) await globalOf(env).cancelUnstartedManagedSpend([instanceId], accountKey);
            await project.failAgentTask(task.id, instanceId);
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
          await project.registerWorkflow(eventId, "integration", undefined, userId,1);
          await env.INTEGRATION_QUEUE.send({ type: "integration.requested", projectId, taskIds: b.taskIds as string[], eventId } satisfies QueueMessage);
          return json({ queued: eventId }, 202);
        }

        const runtimeInspectionRoute=/^\/candidates\/([a-z0-9_-]{1,128})\/runtime$/.exec(sub);
        if(runtimeInspectionRoute&&method!=="GET")return text("Read-only runtime inspection",405);
        const legacyAbandonRoute=/^\/candidates\/([a-z0-9_-]{1,128})\/rerun\/abandon$/.exec(sub);
        const legacyRerunRoute=/^\/candidates\/([a-z0-9_-]{1,128})\/rerun$/.exec(sub);
        if((legacyRerunRoute||legacyAbandonRoute||runtimeInspectionRoute)&&(method==="GET"||method==="POST")){
          if(!isOwner||(auth.viaToken&&auth.tokenScope!=="full"))return text("Only the current owner can request a fresh review of saved legacy inputs",403);
          const profile=await account.getProfile(),currentAuth=await authenticate(request,env);if(currentAuth instanceof Response)return currentAuth;
          if(currentAuth.id!==userId||(currentAuth.viaToken===true)!==(auth.viaToken===true)||(currentAuth.viaToken&&(currentAuth.tokenScope!=="full"||(currentAuth.tokenRepo&&currentAuth.tokenRepo!==projectId))))return text("Owner authentication changed",403);
          const actor={userId,displayName:clean(profile.displayName,120)||"Repository owner",viaToken:currentAuth.viaToken===true},credentialHash=currentAuth.viaToken?await gitParentTokenHash(request):undefined,candidateId=(legacyRerunRoute??legacyAbandonRoute??runtimeInspectionRoute)![1]!;
          try{
            if(runtimeInspectionRoute){if(currentAuth.viaToken)return text("Signed-in owner required for runtime inspection",403);const report=await project.candidateRuntimeInspection(candidateId,actor,credentialHash,currentAuth.expiresAt),finalAuth=await authenticate(request,env);if(finalAuth instanceof Response)return finalAuth;if(finalAuth.id!==userId||finalAuth.viaToken)return text("Owner authentication changed",403);await project.assertCandidateRuntimeInspection(candidateId,report.workflowId,report.incarnation,report.protocol,actor,finalAuth.expiresAt);return Response.json({...report,source:"recorded-ledger",providerVerified:false},{headers:{"Cache-Control":"no-store"}}); }
            if(method==="GET"){
              await project.legacyCandidateRerunReport(candidateId,actor,credentialHash,currentAuth.expiresAt);
              let scope:Awaited<ReturnType<typeof project.ownerRerunObservationScope>>|null=null;try{scope=await project.ownerRerunObservationScope(candidateId,actor,credentialHash,currentAuth.expiresAt);}catch{/* Missing legacy proof keeps review report available; fresh owner authorization below still required. */}const authorize=async()=>{const fresh=await authenticate(request,env);if(fresh instanceof Response||fresh.id!==userId||(fresh.viaToken===true)!==(actor.viaToken)||(fresh.viaToken&&(fresh.tokenScope!=="full"||(fresh.tokenRepo&&fresh.tokenRepo!==projectId))))throw new RepositoryReadError(503,"authorization");const now=await project.ownerRerunObservationScope(candidateId,actor,credentialHash,fresh.expiresAt);if(scope&&JSON.stringify(now)!==JSON.stringify(scope))throw new RepositoryReadError(503,"authorization");};
              const inputObservations=scope?await observeRerunInputs(scope,(repoName,remainingMs)=>openRepositoryRead(env,{repoName,authorize,reserveGroup:operationId=>globalOf(env).reserveRepositoryReadOperation(operationId,accountKey),limits:{maxProviderCalls:4,maxMetadataBytes:32768,maxBlobBytes:1,deadlineMs:remainingMs}}),authorize).catch(()=>({checkedAt:new Date().toISOString(),rows:[],status:"unavailable" as const})):{checkedAt:new Date().toISOString(),rows:[],status:"unavailable"};const currentAvailable=await project.legacyCandidateRuntimeAvailable(candidateId);const finalAuth=await authenticate(request,env);if(finalAuth instanceof Response||finalAuth.id!==userId||(finalAuth.viaToken===true)!==actor.viaToken||(finalAuth.viaToken&&(finalAuth.tokenScope!=="full"||(finalAuth.tokenRepo&&finalAuth.tokenRepo!==projectId))))throw new RepositoryReadError(503,"authorization");const freshReport=await project.legacyCandidateRerunReport(candidateId,actor,credentialHash,finalAuth.expiresAt);if(scope)await authorize();
              return Response.json({...(!currentAvailable&&freshReport.eligible?{...freshReport,eligible:false,detail:"The old native runtime identities were not recorded. Operator recovery is required before rerun; no workspace is guessed stopped."}:freshReport),inputObservations},{headers:{"Cache-Control":"no-store"}});
            }
            if(legacyAbandonRoute){const b=await body<{requestId?:string;confirm?:string}>();if(!b||Object.keys(b).some(key=>key!=="requestId"&&key!=="confirm")||typeof b.requestId!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(b.requestId)||b.confirm!=="abandon pending rerun")return text("Confirm the saved undispatched rerun identity",400);const known=await project.getLegacyCandidateRerun(b.requestId);if(!known||known.predecessorCandidateId!==candidateId)return text("Saved rerun unavailable",404);const abandoned=await project.abandonLegacyCandidateRerun(b.requestId,actor,credentialHash,currentAuth.expiresAt);return Response.json({id:abandoned.id,phase:abandoned.phase,dispatch:abandoned.dispatch},{headers:{"Cache-Control":"no-store"}});}
            const b=await body<{expectedCommit?:string|null;expectedInputs?:Record<string,{commit:string;base:string}>;requestId?:string}>();
            if(!b||Object.keys(b).some(key=>!["expectedCommit","expectedInputs","requestId"].includes(key))||(b.expectedCommit!==null&&(typeof b.expectedCommit!=="string"||!/^[a-f0-9]{40}$/.test(b.expectedCommit)))||typeof b.requestId!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(b.requestId)||!b.expectedInputs||Array.isArray(b.expectedInputs)||Object.keys(b.expectedInputs).length<1||Object.keys(b.expectedInputs).length>8||Object.entries(b.expectedInputs).some(([id,value])=>!TASK_ID.test(id)||!value||Object.keys(value).some(key=>key!=="commit"&&key!=="base")||!/^[a-f0-9]{40}$/.test(value.commit)||!/^[a-f0-9]{40}$/.test(value.base)))return text("The exact candidate, frozen inputs, and reusable request identity are required",400);
            let attempt=await project.prepareLegacyCandidateRerun(candidateId,b.expectedCommit,b.requestId,actor,credentialHash,currentAuth.expiresAt,b.expectedInputs);
            const authorize=async()=>{await project.assertLegacyCandidateRerun(attempt.id,actor,credentialHash,currentAuth.expiresAt);};
            if(attempt.phase==="abandoned")return text("This rerun was explicitly abandoned. Use a new request after checking current contribution inputs.",409);
            if(attempt.phase!=="attached"&&attempt.phase!=="awaiting_decision"&&!attempt.continuationWorkflowId){
              const accountKey=await accountKeyFor(userId);await authorize();
              const verifyHeads=async()=>{const proof=await project.verifyLegacyCandidateGitHeads(attempt.id,actor,credentialHash,currentAuth.expiresAt);if(!proof.ok){const messages={tip_unavailable:"A contributor branch tip is unavailable. Saved inputs were preserved; rerun was not dispatched.",tip_differs:"A contributor branch tip differs from the saved input. Saved inputs were preserved; rerun was not dispatched.",inspection_unavailable:"Exact Git branch inspection is unavailable. Saved inputs were preserved.",cleanup_unconfirmed:"Git inspection credential cleanup is unconfirmed. Saved inputs were preserved."};throw new LegacyRerunError(messages[proof.reason]);}};await verifyHeads();
              await authorize();attempt=await project.stopLegacyCandidateRerun(attempt.id);await authorize();await verifyHeads();
              const {plan}=await account.getBilling();const denied=await admitRun(env,account,planLimits(env)[plan],attempt.successorWorkflowId);if(denied)return denied;await authorize();
              attempt=await project.commitLegacyCandidateRerunReassignment(attempt.id);await authorize();
              await project.registerWorkflow(attempt.successorWorkflowId,"integration",undefined,userId,1);await authorize();
              if(attempt.dispatch==="unknown"&&Date.now()-Date.parse(attempt.createdAt)>=24*60*60_000)return Response.json({error:"Saved dispatch is too old to safely redeliver. Its outcome requires reconciliation."},{status:409});
              if(attempt.dispatch!=="observed")attempt=await project.markLegacyCandidateRerunDispatch(attempt.id,"unknown");
              try{await env.INTEGRATION_WORKFLOW.createBatch([{id:attempt.successorWorkflowId,params:{projectId,taskIds:attempt.taskIds,accountKey,nativeRuntimeProtocolVersion:1},retention:{successRetention:"3 days",errorRetention:"3 days"}}]);attempt=await project.markLegacyCandidateRerunDispatch(attempt.id,"observed");}
              catch{try{await(await env.INTEGRATION_WORKFLOW.get(attempt.successorWorkflowId)).status();attempt=await project.markLegacyCandidateRerunDispatch(attempt.id,"observed");}catch{return Response.json({id:attempt.id,phase:attempt.phase,successorWorkflowId:attempt.successorWorkflowId,dispatch:"unknown"},{status:202,headers:{"Cache-Control":"no-store"}});}}
            }
            attempt=await project.assertLegacyCandidateRerun(attempt.id,actor,credentialHash,currentAuth.expiresAt);
            return Response.json({id:attempt.id,phase:attempt.phase,successorWorkflowId:attempt.continuationWorkflowId??attempt.successorWorkflowId,successorCandidateId:attempt.successorCandidateId,successorDecisionId:attempt.successorDecisionId,dispatch:attempt.dispatch},{status:202,headers:{"Cache-Control":"no-store"}});
          }catch(error){if(error instanceof RepositoryReadError)return Response.json({error:error.message},{status:error.status,headers:{"Cache-Control":"no-store"}});return Response.json({error:error instanceof LegacyRerunError?error.message:"Rerun was not confirmed. Saved context is preserved; retry the same request after inspecting recovery."},{status:error instanceof LegacyRerunError?error.status:409,headers:{"Cache-Control":"no-store"}});}
        }

        if(sub==="/rebase-applications"&&method==="GET"){
          if(!isOwner||(auth.viaToken&&auth.tokenScope!=="full"))return text("Only the current owner with a session or full-access token can inspect saved rebases",403);
          const profile=await account.getProfile();const currentAuth=await authenticate(request,env);if(currentAuth instanceof Response)return currentAuth;
          if(currentAuth.id!==userId||(currentAuth.viaToken===true)!==(auth.viaToken===true)||(currentAuth.viaToken&&(currentAuth.tokenScope!=="full"||(currentAuth.tokenRepo&&currentAuth.tokenRepo!==projectId))))return text("Owner authentication changed",403);
          const credentialHash=currentAuth.viaToken?await gitParentTokenHash(request):undefined;
          try{return Response.json(await project.ownerRebaseApplications({userId,displayName:clean(profile.displayName,120)||"Repository owner",viaToken:currentAuth.viaToken===true},credentialHash,currentAuth.expiresAt),{headers:{"Cache-Control":"no-store"}});}catch{return text("Saved rebase inspection requires current owner authority",403);}
        }

        if(sub==="/publication-recovery"&&method==="GET"){
          if(!isOwner||(auth.viaToken&&auth.tokenScope!=="full"))return text("Only the current owner can inspect publication recovery",403);
          const profile=await account.getProfile(),currentAuth=await authenticate(request,env);if(currentAuth instanceof Response)return currentAuth;
          if(currentAuth.id!==userId||(currentAuth.viaToken===true)!==(auth.viaToken===true)||(currentAuth.viaToken&&(currentAuth.tokenScope!=="full"||(currentAuth.tokenRepo&&currentAuth.tokenRepo!==projectId))))return text("Owner authentication changed",403);
          try{return Response.json(await project.ownerPublicationReadbacks({userId,displayName:clean(profile.displayName,120)||"Repository owner",viaToken:currentAuth.viaToken===true},currentAuth.viaToken?await gitParentTokenHash(request):undefined,currentAuth.expiresAt),{headers:{"Cache-Control":"no-store"}});}catch{return text("Publication recovery requires current owner authority",403);}
        }
        const publicationRecoveryRoute=/^\/publication-recovery\/(jrnl_[a-f0-9-]{36})\/check$/.exec(sub);
        if(publicationRecoveryRoute&&method==="POST"){
          if(!isOwner||(auth.viaToken&&auth.tokenScope!=="full"))return text("Only the current owner can check publication recovery",403);
          const b=await body<{requestId?:string}>();if(!b||Object.keys(b).some(key=>key!=="requestId")||typeof b.requestId!=="string"||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(b.requestId))return text("A stable publication check identity is required",400);
          const profile=await account.getProfile(),currentAuth=await authenticate(request,env);if(currentAuth instanceof Response)return currentAuth;
          if(currentAuth.id!==userId||(currentAuth.viaToken===true)!==(auth.viaToken===true)||(currentAuth.viaToken&&(currentAuth.tokenScope!=="full"||(currentAuth.tokenRepo&&currentAuth.tokenRepo!==projectId))))return text("Owner authentication changed",403);
          try{return Response.json(await project.checkOwnerPublicationReadback(publicationRecoveryRoute[1]!,b.requestId,{userId,displayName:clean(profile.displayName,120)||"Repository owner",viaToken:currentAuth.viaToken===true},currentAuth.viaToken?await gitParentTokenHash(request):undefined,currentAuth.expiresAt),{headers:{"Cache-Control":"no-store"}});}catch{return text("Publication readback was not confirmed; its saved journal remains pending",409);}
        }

        const rebaseRecoveryRoute=/^\/rebase-applications\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/reconcile$/.exec(sub);
        if(rebaseRecoveryRoute&&method==="POST"){
          if(!isOwner||(auth.viaToken&&auth.tokenScope!=="full"))return text("Only the current owner with a session or full-access token can recover saved rebases",403);
          const b=await body<{expectedVersion?:number;idempotencyKey?:string}>();
          if(!b||Object.keys(b).some(key=>key!=="expectedVersion"&&key!=="idempotencyKey")||!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion!<0||typeof b.idempotencyKey!=="string"||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(b.idempotencyKey))return text("Saved recovery version and request identity are required",400);
          const profile=await account.getProfile();const currentAuth=await authenticate(request,env);if(currentAuth instanceof Response)return currentAuth;
          if(currentAuth.id!==userId||(currentAuth.viaToken===true)!==(auth.viaToken===true)||(currentAuth.viaToken&&(currentAuth.tokenScope!=="full"||(currentAuth.tokenRepo&&currentAuth.tokenRepo!==projectId))))return text("Owner authentication changed",403);
          const credentialHash=currentAuth.viaToken?await gitParentTokenHash(request):undefined;
          try{const result=await project.reconcileRebaseApplication(rebaseRecoveryRoute[1]!,{userId,displayName:clean(profile.displayName,120)||"Repository owner",viaToken:currentAuth.viaToken===true},b.expectedVersion!,b.idempotencyKey,credentialHash,currentAuth.expiresAt);if(!result.ok)return Response.json({error:result.error,...(result.report?{report:{...result.report,resumeAvailable:Boolean(env.REBASE_RESUME_WORKFLOW)&&result.report.status==="remote_old_resume_required"}}:{})},{status:result.status,headers:{"Cache-Control":"no-store"}});const receipt=result.receipt;return Response.json({...receipt,actor:{displayName:receipt.actor.displayName,viaToken:receipt.actor.viaToken}},{headers:{"Cache-Control":"no-store"}});}
          catch{return text("Recovery was not confirmed. Reload saved state before retrying this request.",503);}
        }

        const rebaseResumeRoute=/^\/rebase-applications\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/resume$/.exec(sub);
        if(rebaseResumeRoute&&method==="GET"){
          if(!isOwner||(auth.viaToken&&auth.tokenScope!=="full"))return text("Only the current owner can inspect saved recovery execution",403);
          const profile=await account.getProfile(),currentAuth=await authenticate(request,env);if(currentAuth instanceof Response)return currentAuth;
          if(currentAuth.id!==userId||(currentAuth.viaToken===true)!==(auth.viaToken===true)||(currentAuth.viaToken&&(currentAuth.tokenScope!=="full"||(currentAuth.tokenRepo&&currentAuth.tokenRepo!==projectId))))return text("Owner authentication changed",403);
          const credentialHash=currentAuth.viaToken?await gitParentTokenHash(request):undefined;
          try{const attempt=await project.ownerRebaseResumeStatus(rebaseResumeRoute[1]!,{userId,displayName:clean(profile.displayName,120)||"Repository owner",viaToken:currentAuth.viaToken===true},credentialHash,currentAuth.expiresAt);return Response.json({attempt:attempt?{id:attempt.id,applicationId:attempt.applicationId,generation:attempt.generation,dispatch:attempt.dispatch,nativeState:attempt.nativeState,terminal:attempt.terminal,pauseReason:attempt.pauseReason}:null},{headers:{"Cache-Control":"no-store"}});}catch{return text("Saved recovery status requires current owner authority",403);}
        }
        if(rebaseResumeRoute&&method==="POST"){
          if(!isOwner||(auth.viaToken&&auth.tokenScope!=="full"))return text("Only the current owner with a session or full-access token can resume saved rebases",403);
          const b=await body<{expectedVersion?:number;idempotencyKey?:string}>();
          if(!b||Object.keys(b).some(key=>key!=="expectedVersion"&&key!=="idempotencyKey")||!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion!<0||typeof b.idempotencyKey!=="string"||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(b.idempotencyKey))return text("Saved recovery version and request identity are required",400);
          if(!env.REBASE_RESUME_WORKFLOW)return text("Saved recovery execution is unavailable",503);
          const profile=await account.getProfile(),currentAuth=await authenticate(request,env);if(currentAuth instanceof Response)return currentAuth;
          if(currentAuth.id!==userId||(currentAuth.viaToken===true)!==(auth.viaToken===true)||(currentAuth.viaToken&&(currentAuth.tokenScope!=="full"||(currentAuth.tokenRepo&&currentAuth.tokenRepo!==projectId))))return text("Owner authentication changed",403);
          const credentialHash=currentAuth.viaToken?await gitParentTokenHash(request):undefined;
          const result=await project.beginRebaseResume(rebaseResumeRoute[1]!,{userId,displayName:clean(profile.displayName,120)||"Repository owner",viaToken:currentAuth.viaToken===true},b.expectedVersion!,b.idempotencyKey,credentialHash,currentAuth.expiresAt);
          if(!result.ok)return Response.json({error:result.error},{status:result.status,headers:{"Cache-Control":"no-store"}});
          let attempt=result.attempt;
          if(!attempt.terminal&&(attempt.dispatch==="saved"||(attempt.dispatch==="unknown"&&Date.now()-Date.parse(attempt.createdAt)<24*60*60_000))){
            attempt=await project.markRebaseResumeDispatch(attempt.id,attempt.generation,"unknown");
            try{await env.REBASE_RESUME_WORKFLOW.createBatch([{id:attempt.workflowId,params:{projectId,attemptId:attempt.id,generation:attempt.generation},retention:{successRetention:"3 days",errorRetention:"3 days"}}]);}catch{/* An uncertain dispatch preserves the same immutable Workflow identity. */}
          }
          try{attempt=await project.observeRebaseResume(attempt.id,attempt.generation,{userId,displayName:clean(profile.displayName,120)||"Repository owner",viaToken:currentAuth.viaToken===true},credentialHash,currentAuth.expiresAt);}catch{/* Return the saved uncertainty; never invent a replacement generation. */}
          return Response.json({id:attempt.id,applicationId:attempt.applicationId,generation:attempt.generation,dispatch:attempt.dispatch,nativeState:attempt.nativeState,terminal:attempt.terminal,pauseReason:attempt.pauseReason},{status:202,headers:{"Cache-Control":"no-store"}});
        }

        // ----- human review of a verified candidate -----
        const reviewRoute = /^\/candidates\/([a-z0-9_-]+)\/review$/.exec(sub);
        if (reviewRoute && method === "POST") {
          if (!isOwner) return text("Only the repository owner with a signed-in session or full-access token can review", 403);
          const b = await body<{ approved?: boolean; note?: string; expectedCommit?: string }>();
          if (typeof b.approved !== "boolean") return text("approved (true or false) is required", 400);
          if (typeof b.expectedCommit !== "string" || !/^[a-f0-9]{40}$/.test(b.expectedCommit)) return text("The exact commit you reviewed is required. Refresh the page and inspect the candidate.", 400);
          const profile = await account.getProfile();
          const currentAuth = await authenticate(request, env);
          if (currentAuth instanceof Response) return currentAuth;
          if (currentAuth.id !== userId || (currentAuth.viaToken === true) !== (auth.viaToken === true) || (currentAuth.viaToken && (currentAuth.tokenScope !== "full" || (currentAuth.tokenRepo && currentAuth.tokenRepo !== projectId)))) return text("Owner authentication changed before the decision was saved",403);
          const credentialHash = currentAuth.viaToken ? await gitParentTokenHash(request) : undefined;
          const actor = { userId, displayName: clean(profile.displayName, 120) || "Repository owner", viaToken: auth.viaToken === true };
          let r;
          try { r = await project.recordReview(reviewRoute[1]!, { approved: b.approved, actor, note: clean(b.note, 500) || undefined }, b.expectedCommit, credentialHash); }
          catch { return text("Review could not be confirmed. Refresh the candidate before retrying.", 409); }
          if (!r.ok || !r.instanceId) return text(r.error ?? "Review failed", 409);
          try {
            await (await env.INTEGRATION_WORKFLOW.get(r.instanceId)).sendEvent({ type: "review", payload: { approved: r.review?.approved ?? b.approved, by: r.review?.by ?? actor.displayName, note: r.review?.note, actor: r.review?.actor } });
          } catch (e) {
            console.error("review notify failed", e instanceof Error ? e.message : String(e));
            return text("Your decision is saved, but the integration run did not receive it yet. Press the same button again to resend.", 502);
          }
          return json({ recorded: true, approved: b.approved });
        }

        if (sub === "/decisions/resolve" && method === "POST") {
          if (!isOwner) return text("Only the repository owner with a signed-in session or full-access token can resolve decisions", 403);
          const b = await body<{ decisionId?: string; selectedOptionId?: string }>();
          if (typeof b.decisionId !== "string" || typeof b.selectedOptionId !== "string" || !b.decisionId || !b.selectedOptionId || b.decisionId.length > 120 || b.selectedOptionId.length > 120) return text("decisionId and selectedOptionId required", 400);
          const profile = await account.getProfile();
          const currentAuth = await authenticate(request, env);
          if (currentAuth instanceof Response) return currentAuth;
          if (currentAuth.id !== userId || (currentAuth.viaToken === true) !== (auth.viaToken === true) || (currentAuth.viaToken && (currentAuth.tokenScope !== "full" || (currentAuth.tokenRepo && currentAuth.tokenRepo !== projectId)))) return text("Owner authentication changed before the decision was saved",403);
          const credentialHash = currentAuth.viaToken ? await gitParentTokenHash(request) : undefined;
          const actor = { userId, displayName: clean(profile.displayName, 120) || "Repository owner", viaToken: auth.viaToken === true };
          let result;
          try { result = await project.resolveDecision(b.decisionId, b.selectedOptionId, actor, credentialHash,currentAuth.expiresAt); }
          catch (cause) { return text(cause instanceof Error ? cause.message : "Decision was not saved", 409); }
          const { taskIds } = result;
          if (taskIds.length > 0) {
            const eventId = result.continuationWorkflowId??`decision-${projectId}-${b.decisionId}`;
            await project.registerWorkflow(eventId, "integration", undefined, userId,1);
            await env.INTEGRATION_QUEUE.send({ type: "integration.requested", projectId, taskIds, eventId } satisfies QueueMessage);
          }
          return json({ resolved: true });
        }

        if(sub==="/scenarios"&&method==="GET"){
          if(!isOwner||(auth.viaToken&&auth.tokenScope!=="full"))return text("Only the repository owner can inspect preparation runs",403);
          if([...url.searchParams.keys()].some(key=>key!=="cursor")||url.searchParams.getAll("cursor").length>1)return text("Invalid scenario query",400);
          const cursor=url.searchParams.get("cursor")??undefined;if(cursor!==undefined&&(!/^[1-9][0-9]{0,15}$/.test(cursor)||!Number.isSafeInteger(Number(cursor))))return text("Invalid scenario cursor",400);
          const credentialHash=auth.viaToken?await gitParentTokenHash(request):undefined,actor={userId,displayName:"Repository owner",viaToken:auth.viaToken===true};
          try{const report=await project.ownerScenarioRuns(actor,cursor,credentialHash,auth.expiresAt);const current=await authenticate(request,env);if(current instanceof Response)return current;if(current.id!==userId||(current.viaToken===true)!==(auth.viaToken===true)||(current.viaToken&&(current.tokenScope!=="full"||(current.tokenRepo&&current.tokenRepo!==projectId))))return text("Scenario authentication changed",403);await project.assertOwnerScenarioScope(actor,report.incarnation,credentialHash,current.expiresAt);return Response.json({...report,source:"repository-ledger",providerVerified:false},{headers:{"Cache-Control":"no-store"}});}catch{return text("Scenario discovery authority or repository scope changed",403);}
        }

        if (sub === "/scenarios/run" && method === "POST") {
          if (state.kind === "import") return text("Scenarios run only on the demo repository", 400);
          const b = await body<{ act?: string }>();
          if (b.act !== "act1" && b.act !== "act2" && b.act !== "act3") return text("act must be act1, act2 or act3", 400);
          const { plan } = await account.getBilling();
          const runId = crypto.randomUUID();
          const instanceId = `scn-${projectId}-${runId}`;
          const managedRunIds = scenarioAgentRunIds(instanceId, b.act, runId);
          const spendDenied = await reserveManagedAgents(env, accountKey, managedRunIds);
          if (spendDenied) return spendDenied;
          const denied = await admitRun(env, account, planLimits(env)[plan], instanceId);
          if (denied) { await globalOf(env).cancelUnstartedManagedSpend(managedRunIds, accountKey); return denied; }
          try { await project.registerWorkflow(instanceId, "scenario", undefined, userId); }
          catch { await globalOf(env).cancelUnstartedManagedSpend(managedRunIds, accountKey); return text("Scenario could not be registered; no managed execution was dispatched", 503); }
          await globalOf(env).markManagedDispatchAttempted(managedRunIds, accountKey);
          const instance = await env.SCENARIO_WORKFLOW.create({ id: instanceId, params: { projectId, accountKey, act: b.act, runId } });
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
            let context;
            try { context = await project.repositoryReadContext(userId); }
            catch { throw new WorkflowControlError("Workflow access changed; refresh before continuing", 403); }
            const credentialHash = auth.viaToken ? await gitParentTokenHash(request) : undefined;
            const authorize = async () => {
              const current = await authenticate(request, env);
              if (current instanceof Response || current.id !== userId || (current.viaToken === true) !== (auth.viaToken === true)
                || (current.viaToken && ((current.tokenRepo && current.tokenRepo !== projectId) || (method === "POST" && current.tokenScope === "read"))))
                throw new WorkflowControlError("Workflow authentication changed; refresh before continuing", 403);
              if (!await project.assertWorkflowControlAuthority(context, userId, run, method === "POST", current.viaToken === true, credentialHash, current.expiresAt))
                throw new WorkflowControlError("Workflow authority or repository scope changed; refresh before continuing", 403);
            };
            const result = await controlWorkflow(env, project, id, wf[2] === "pause" ? "pause" : wf[2] === "resume" ? "resume" : "status", authorize, async (owned, action) => { await project.logActivity(userId, `workflow.${action}_requested`, `Requested ${action} of ${owned.kind} run ${owned.instanceId}; provider outcome is not yet confirmed`); });
            if (method === "POST") await project.logActivity(userId, `workflow.${wf[2]}`, `${result.kind} run ${id}: ${result.status}`);
            await authorize();
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
          const registration = await lookupRepositoryPreviewOrigin(env, projectId, url.origin);
          if (registration.status === "unavailable") return Response.json({ ready: false, status: "pending", canRetry: false, reason: "Preview service is temporarily unavailable. Status checks will continue shortly." }, { headers: { "Cache-Control": "no-store" } });
          const previewOrigin = registration.status === "active" ? registration.origin : null;
          if (!previewOrigin || !env.PREVIEW_SIGNING_KEY) return json({ ready: false, status: "unavailable", canRetry: false, reason: "An isolated preview origin has not been configured for this repository. The platform operator must provision its preview Worker before a link can be opened." });
          const latestGeneration=await project.previewGenerationLatest(commit);
          if(latestGeneration){
            const active=await project.previewGenerationActive(commit);
            if(active&&await project.previewGenerationForRead(commit,active.identity.incarnation,active.generation)){
              const origin=previewOrigin;
              const {exp,sig}=await signPreviewGeneration(env,projectId,commit,active.identity.incarnation,active.generation,origin);
              return Response.json({ready:true,status:"available",generationId:active.generation,credentialCleanup:await project.previewGenerationCredentialSummary(active.generation),url:`${origin}/preview-v3/${commit}/${active.identity.incarnation}/${active.generation}/${exp}/${sig}/`,expiresAt:new Date(exp*1000).toISOString()},{headers:{"Cache-Control":"no-store"}});
            }
            let canRecover=false;
            if(isOwner&&commit===state.acceptedState.currentCommit){try{const scope=await project.previewStorageScope(commit,state.canonicalRepoName);canRecover=(await fundedPreviewSource(env,scope,latestGeneration)).capacity.allowed;}catch{/* Unknown storage funding never enables recovery. */}}
            return json({ready:false,status:["requested","building"].includes(latestGeneration.state)?"pending":"unavailable",canRetry:false,generationId:latestGeneration.generation,generationRecovery:{canRecover,expectedGeneration:latestGeneration.generation,detail:"A replacement uses separate storage funding; prior uncertain upload holds remain reserved"}});
          }
          const ready = Boolean(await env.EVIDENCE_BUCKET.head(`${buildPrefix(projectId, commit)}/index.html`));
          if (!ready && commit === state.acceptedState.currentCommit && settings.fixture === "ticket-booking") ctx.waitUntil(ensureBuild(env, projectId, commit, state.canonicalRepoName, accountKey).catch((e) => console.error("preview build failed", String(e))));
          if (!ready) {
            const key=`build-${projectId}-${commit}`;
            const failed=await globalOf(env).nativeComputeFailure(key);
            const failureReason=await globalOf(env).nativeComputeFailureReason(key);
            const unfinishedWriter=(await globalOf(env).previewStorageWriterState(buildPrefix(projectId,commit))).unfinished;
            const storageUnavailable=(unfinishedWriter&&failed)||failureReason==="storage_capacity"||failureReason==="storage_unconfigured"||failureReason==="storage_retired";
            let fundingRetryEligible=false;
            if(storageUnavailable&&!unfinishedWriter&&failureReason!=="storage_reconciliation"&&isOwner&&commit===state.acceptedState.currentCommit){
              try{fundingRetryEligible=(await globalOf(env).previewStorageReadmission(await project.previewStorageScope(commit,state.canonicalRepoName))).allowed;}catch{/* Missing or stale scope never authorizes retry. */}
            }
            const compute=await globalOf(env).nativeComputeStatus(key);
            const spending=await managedSpendStatus(env,accountKey,false);
            let generationRecovery;
            if(unfinishedWriter&&isOwner&&commit===state.acceptedState.currentCommit){let canRecover=false;try{canRecover=(await globalOf(env).previewGenerationCapacity(buildPrefix(projectId,commit),await project.previewStorageScope(commit,state.canonicalRepoName))).allowed;}catch{/* Preserve unknown holds. */}generationRecovery={canRecover,expectedGeneration:null,detail:"Create a separately funded preview while retaining the unresolved upload reservation"};}
            const status=storageUnavailable?"unavailable":failed?"failed":spending.status!=="configured"?"unavailable":compute?.active?"pending":"not_started";
            return json({ready:false,status,generationRecovery,canRetry:!unfinishedWriter&&(!storageUnavailable||fundingRetryEligible)&&isOwner&&commit===state.acceptedState.currentCommit&&settings.fixture==="ticket-booking",reason:(unfinishedWriter&&failed)?"Preview publication has unfinished upload receipts; storage reconciliation is required":storageUnavailable?(fundingRetryEligible?"Preview storage allowance is available again; the owner can retry":"Preview storage allowance requires operator attention; retry cannot restore capacity"):failed?"Build failed; retry requires owner action":status==="unavailable"?"Compute budget unavailable":undefined});
          }
          const { exp, sig } = await signPreview(env, projectId, commit, previewOrigin);
          return Response.json({ ready: true, status:"available", url: `${previewOrigin}/preview/${commit}/${exp}/${sig}/`, expiresAt: new Date(exp * 1000).toISOString() }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
        }

        // ----- issues -----
        const me = async () => (await account.getProfile()).displayName || `member-${userId.slice(-6)}`;
        if (sub === "/issues" && method === "GET") return json(await project.listIssues(url.searchParams.get("state") === "closed" ? "closed" : "open"));
        if (sub === "/issues" && method === "POST") {
          const b = await body<{ title?: string; body?: string; labels?:unknown;idempotencyKey?:unknown }>();
          const title = clean(b.title, 200),description=clean(b.body,20_000);
          if (!title) return text("A title is required", 400);
          if(b.labels!==undefined&&(!Array.isArray(b.labels)||b.labels.length>0))return text("Issue labels are not supported",400);
          const key=b.idempotencyKey;
          if(key!==undefined&&(typeof key!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(key)))return text("Invalid issue creation request key",400);
          const authorizeIssue=async()=>{const current=await authenticate(request,env);return !(current instanceof Response)&&current.id===userId&&current.viaToken===auth.viaToken&&(!current.tokenRepo||current.tokenRepo===projectId)&&(!current.viaToken||current.tokenScope!=="read")&&await account.accountLifecycle()==="active"&&Boolean(await project.roleOf(userId))&&!await project.repositoryDeletionPending();};
          if(!await authorizeIssue())return text("Issue creation access was revoked",403);
          const author=await me();
          if(!await authorizeIssue())return text("Issue creation access was revoked",403);
          let saved;
          try{
            if(key===undefined)saved=await project.createIssue({title,body:description,author});
            else {

              saved=await project.createMemberIssue(userId,{title,body:description,author,idempotencyKey:key});
            }
          }catch(error){const message=String(error);return text(message.includes("different content")?"Issue creation request key was used for different content":message.includes("cannot be recreated")?"The recorded issue is unavailable; it cannot be recreated with this request key":"Issue creation unavailable",message.includes("different content")?409:message.includes("cannot be recreated")?410:message.includes("access was revoked")?403:503);}
          if(!await authorizeIssue())return text("Issue result unavailable because access was revoked",403);
          return json(saved,201);
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
        const SUBJECT = /^(issue:\d{1,7}|change:[a-z0-9][a-z0-9-]{2,100}|candidate:[a-z0-9_-]{3,60})$/;
        const subjectExists = async (subject: string) => {
          const [kind, id] = subject.split(":") as [string, string];
          if (kind === "issue") return (await project.getIssue(Number(id))) !== null;
          if (kind === "change") return Boolean(state.tasks[id]);
          return Boolean(state.candidates[id]);
        };
        const authorizeCommentAccess = async () => {
          const fresh = await authenticate(request,env);
          if(fresh instanceof Response || fresh.id !== userId || fresh.viaToken !== auth.viaToken) return false;
          if(fresh.viaToken && fresh.tokenRepo && fresh.tokenRepo !== projectId) return false;
          if(await account.accountLifecycle() !== "active") return false;
          return Boolean(await project.roleOf(userId));
        };
        if (sub === "/comments" && method === "GET") {
          const subject = url.searchParams.get("subject") ?? "";
          if (!SUBJECT.test(subject)) return text("Invalid subject", 400);
          if([...url.searchParams.keys()].some(key=>!["subject","page","cursor"].includes(key)) || [...url.searchParams.keys()].some(key=>url.searchParams.getAll(key).length!==1) || (url.searchParams.has("page") && url.searchParams.get("page")!=="1"))return text("Invalid comment query",400);
          if(!await authorizeCommentAccess())return text("Comment access was revoked",403);
          let page;try{page=await project.listMemberCommentsPage(userId,subject,url.searchParams.get("cursor") ?? undefined);}catch(error){return text(String(error).includes("Invalid comment cursor")?"Invalid comment cursor":"Comment access unavailable",String(error).includes("Invalid comment cursor")?400:403);}
          if(!await authorizeCommentAccess())return text("Comment access was revoked",403);
          return Response.json(url.searchParams.get("page")==="1"?page:page.comments,{headers:{"Cache-Control":"no-store","X-FlareGit-Comments-Has-More":String(page.nextCursor!==null),...(page.nextCursor?{"X-FlareGit-Comments-Cursor":page.nextCursor}:{})}});
        }
        if (sub === "/comments" && method === "POST") {
          const b = await body<{ subject?: string; body?: string; path?: string; line?: number; commit?: string; idempotencyKey?: string }>();
          if(b.idempotencyKey !== undefined && (typeof b.idempotencyKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(b.idempotencyKey)))return text("Invalid comment request key",400);
          const subject = b.subject ?? "";
          const text_ = clean(b.body, 10_000);
          if (!SUBJECT.test(subject) || !(await subjectExists(subject))) return text("Unknown subject", 404);
          if (!text_) return text("Write something first", 400);
          const path_ = b.path ? clean(b.path, 400) : undefined;
          if (path_ && (path_.startsWith("/") || path_.split("/").includes(".."))) return text("Invalid path", 400);
          const line = b.line === undefined ? undefined : Number(b.line);
          if (line !== undefined && !(Number.isInteger(line) && line > 0 && line < 10_000_000)) return text("Invalid line", 400);
          if (b.commit && !/^[0-9a-f]{40}$/.test(b.commit)) return text("Invalid commit", 400);
          if (path_ || line !== undefined) {
            if (!path_ || line === undefined || typeof b.commit !== "string" || !/^[0-9a-f]{40}$/.test(b.commit)) return text("A file comment requires its path, line and exact viewed commit", 400);
          }
          if (b.commit) {
            const [kind, id] = subject.split(":");
            const task = kind === "change" && id ? state.tasks[id] : undefined;
            const candidate = kind === "candidate" && id ? state.candidates[id] : undefined;
            const known = task
              ? [task.baseCommit, task.currentCommit, ...task.checkpoints.map((checkpoint) => checkpoint.commitHash)].includes(b.commit)
              : candidate ? candidate.candidateCommit === b.commit
              : state.acceptedState.currentCommit === b.commit || state.acceptedState.history.some((record) => record.commit === b.commit);
            if (!known) return text("The comment revision is not recorded for this subject. Reload without losing your draft.", 409);
          }
          const author=await me();
          if(!await authorizeCommentAccess())return text("Comment access was revoked",403);
          let saved;try{saved=await project.addMemberComment(userId,{subject,author,body:text_,path:path_,line,commit:b.commit,idempotencyKey:b.idempotencyKey});}catch(error){const message=String(error);return text(message.includes("different content")?"Comment request key was used for different content":message.includes("cannot be recreated")?"The recorded comment is unavailable; it cannot be recreated with this request key":"Comment access unavailable",message.includes("different content")?409:message.includes("cannot be recreated")?410:message.includes("Unknown comment subject")?404:message.includes("revision is no longer recorded")?409:message.includes("access was revoked")?403:503);}
          if(!await authorizeCommentAccess())return text("Comment result unavailable because access was revoked",403);
          return json(saved,201);
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
          const nativeRunId=`native-${crypto.randomUUID()}`;
          await admitNativeCompute(env,accountKey,nativeRunId);
          const sb = env.INTEGRATOR.getByName(nativeRunId);
          const exec = (cmd: string, e?: Record<string, string>) => sb.exec(["sh", "-c", cmd], { env: e });
          const cleanup = async () => {
            try { await sb.destroy(); }
            catch { await project.logActivity("FlareGit", "container.cleanup_failed", "Mirror retry container did not confirm shutdown; accepted history is preserved").catch(() => console.warn("Container cleanup evidence unavailable")); }
          };
          let branch: string;
          try { branch = (await exec(`git ls-remote --symref ${q(remote)} HEAD`, gitAuthEnv(canonicalToken))).stdout.match(/ref: refs\/heads\/(\S+)\s+HEAD/)?.[1] ?? state.defaultBranch ?? "main"; } catch (error) {
            await cleanup();
            throw error;
          }
          const commit = state.acceptedState.currentCommit;
          ctx.waitUntil(
            pushMirror({ exec }, { canonicalRemote: remote, canonicalToken, target: cfg.target, githubToken: cfg.token, branch, commit })
              .then((r) => project.recordMirrorRun(commit, r.status, r.detail))
              .catch(() => project.recordMirrorRun(commit, "error", "Mirror run failed to start"))
              .finally(cleanup)
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
          await project.beginRepositoryDeletion();
          if (!await stopRepositoryWorkflows(env, project)) return json({ deleted: false, status: "deleting", detail: "Repository workflow shutdown is unconfirmed. Retry deletion; metadata is preserved." }, 202);
          const recoveryCleanup = await cleanupPrivateRecoveryRepositoryOutcome(env, project);
          if (!recoveryCleanup.deleted) return json({ ...recoveryCleanup, status: "deleting" }, 202);
          const copiesCleanup=await cleanupRepositoryCopies(env,project);
          if(!copiesCleanup.cleaned)return json({deleted:false,status:"deleting",...copiesCleanup},202);
          if (!await reconcileSealedAllocations(env, project)) return json({ deleted: false, status: "deleting", detail: "An in-flight repository allocation remains unconfirmed. Retry deletion." }, 202);
          const manifest = await globalOf(env).artifactProjectManifest(projectId);
          const names = [...new Set([...Object.values(state.tasks).map((task) => task.workspace.repoName), state.canonicalRepoName, ...manifest.filter((allocation) => allocation.state !== "deleted").map((allocation) => allocation.name)])];
          const knownNames = new Set([...Object.values(state.tasks).map((task) => task.workspace.repoName), state.canonicalRepoName]);
          for (const name of names) {
            if (await project.repositoryArtifactDeleted(name)) { await globalOf(env).recordArtifactDeletion(name, true); continue; }
            if (!knownNames.has(name) && !await allocatedArtifactReadable(env, name)) return json({ deleted: false, status: "deleting", detail: "Reserved repository allocation is still unconfirmed. Retry deletion; metadata is preserved." }, 202);
            if (!await env.ARTIFACTS.delete(name).catch(() => false)) return json({ deleted: false, status: "deleting", detail: "Repository storage cleanup is unconfirmed. Retry deletion; cleanup metadata is preserved." }, 202);
            await project.recordRepositoryArtifactDeleted(name);
            await globalOf(env).recordArtifactDeletion(name, true);
          }
          await account.removeProject(projectId);
          await project.destroy();
          return json({ deleted: projectId });
        }
      }

      return text("Not found", 404);
    } catch (err) {
      if (err instanceof RequestBodyError) return text(err.message, 400);
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
  const nativeRunId=`native-${crypto.randomUUID()}`;
  await admitNativeCompute(env,await accountKeyFor(userId),nativeRunId);
  const created = await allocateArtifact(env,{name:canonicalName,projectId,userId,kind:"canonical"},()=>env.ARTIFACTS.create(canonicalName,{description:`FlareGit demo repository for ${name}`}));
  const sb = env.INTEGRATOR.getByName(nativeRunId);
  const run = (cmd: string, e?: Record<string, string>) => sb.exec(["sh", "-c", cmd], { env: e });
  const seed = "/workspace/seed";
  try {
    const r = await run(
      `rm -rf ${seed} && mkdir -p ${seed} && cp -r /opt/flaregit/src/fixtures/ticket-booking/template/. ${seed}/ && cd ${seed} && git init -q -b main && git add -A && git -c user.name=FlareGit -c user.email=system@flaregit.com commit -q -m ${q("Initial accepted version")} && git push -q ${q(created.remote)} main:main`,
      gitAuthEnv(created.token ?? "")
    );
    if (!r.success) throw new Error(`seed failed: ${r.stderr.slice(-400)}`);
    const head = (await run(`git -C ${seed} rev-parse HEAD`)).stdout.trim();
    const tree = (await run(`git -C ${seed} rev-parse HEAD^{tree}`)).stdout.trim();
    await ledger.initialize({ projectId, projectName: name, canonicalRepoName: canonicalName, head, tree, verificationPolicy: { ...TICKET_BOOKING_POLICY }, kind: "demo", defaultBranch: "main", ownerId: userId });
    return { head, kind: "demo" };
  } catch (e) {
    const removed=await env.ARTIFACTS.delete(canonicalName).catch(() => false);
    if(removed)await globalOf(env).recordArtifactDeletion(canonicalName,true).catch(()=>undefined);
    throw e;
  } finally {
    await sb.destroy().catch(() => undefined);
  }
}

async function finishImport(env: Env, account: Ledger, job: ImportJob, readiness: ImportReadiness) {
  if (readiness.status === "ready") {
    try {
      // Persist the first observed import snapshot before controller/account setup.
      // A retry cannot substitute a later accepted branch head after interruption.
      if (!job.importedHead && job.status !== "ready") {
        job = { ...job, importedHead: readiness.head, importedBranch: readiness.defaultBranch };
        await account.saveImportJob(job);
      }
      await projectOf(env, job.id).initialize({ projectId: job.id, projectName: job.name, canonicalRepoName: job.canonicalRepoName, head: job.importedHead ?? readiness.head, verificationPolicy: job.verificationPolicy as unknown as Record<string, unknown>, kind: "import", defaultBranch: job.importedBranch ?? readiness.defaultBranch, ownerId: job.ownerId, source: job.source });
      await account.addProject({ id: job.id, name: job.name, role: "owner", kind: "import" });
      await account.saveImportJob({ ...job, importedHead: job.importedHead ?? readiness.head, importedBranch: job.importedBranch ?? readiness.defaultBranch, status: "ready", updatedAt: new Date().toISOString(), detail: "Repository is available. No shallow depth was requested; completeness of imported history is not verified." });
      return { id: job.id, status: "ready" as const, head: readiness.head, kind: "import", remote: readiness.remote };
    } catch {
      // Repository data survives an account/controller failure and can be retried.
      readiness = { status: "pending", detail: "Repository is preserved, but account setup did not finish; retry this saved import" };
    }
  }
  const pending: ImportJob = { ...job, status: readiness.status, updatedAt: new Date().toISOString(), detail: readiness.detail };
  await account.saveImportJob(pending);
  return { id: job.id, status: readiness.status, import: pending };
}

async function importRepository(
  env: Env,
  account: Ledger,
  o: { projectId: string; name: string; userId: string; url: string; branch: string; install: string; build: string; test: string }
) {
  const source = validateImportSource(o.url);
  if (!o.test) throw new Error("A test command is required: it is the protected check every change must pass.");
  const now = new Date().toISOString();
  const job: ImportJob = {
    id: o.projectId, ownerId: o.userId, name: o.name, canonicalRepoName: canonicalNameFor(o.projectId), source: source.toString(), branch: o.branch,
    verificationPolicy: { kind: "command", ...(o.install ? { install: o.install } : {}), ...(o.build ? { build: o.build } : {}), test: o.test, allowedScope: ["*"], protectedPaths: DEFAULT_PROTECTED_PATHS },
    status: "requested", historyIntent: "provider-default-no-depth-requested", createdAt: now, updatedAt: now, detail: "Import request is saved; provider readiness has not been observed",
  };
  // Persist ownership and recovery identity BEFORE contacting the provider.
  await account.saveImportJob(job);
  const readiness=await allocateArtifact(env,{name:job.canonicalRepoName,projectId:job.id,userId:job.ownerId,kind:"import"},()=>startImport(env.ARTIFACTS,job));
  return finishImport(env,account,job,readiness);
}

async function stopImportHistoryAttempts(env: Env, ledger: Ledger): Promise<boolean> {
  for (const attempt of await ledger.listHistoryInspectionAttemptsForCleanup()) {
    try {
      if (attempt.dispatch !== "saved" && !attempt.terminal) {
        const handle = await env.IMPORT_HISTORY_WORKFLOW.get(attempt.workflowId);
        if (!["complete", "errored", "terminated"].includes((await handle.status()).status)) {
          await handle.terminate();
          if ((await handle.status()).status !== "terminated") return false;
        }
      }
      // Exact persisted native identity; cleanup remains possible after the
      // owner's authority is withdrawn. Unknown allocation outcomes retain holds.
      await ledger.historyInspectionNativeStopped(attempt.operationId, attempt.generation, attempt.nativeRunId);
    } catch { return false; }
  }
  return true;
}

async function stopRepositoryWorkflows(env: Env, ledger: Ledger): Promise<boolean> {
  if(!await ledger.stopIntegrationNativeForDeletion())return false;
  if(!await ledger.stopRebaseResumeForDeletion())return false;
  if (!await stopImportHistoryAttempts(env, ledger)) return false;
  for (const run of await ledger.listRepositoryWorkflows()) {
    const binding = run.kind === "agent" ? env.AGENT_WORKFLOW : run.kind === "scenario" ? env.SCENARIO_WORKFLOW : env.INTEGRATION_WORKFLOW;
    try {
      const handle = await binding.get(run.instanceId);
      if (!["complete", "errored", "terminated"].includes((await handle.status()).status)) {
        await handle.terminate();
        if ((await handle.status()).status !== "terminated") return false;
      }
    } catch { return false; }
  }
  return true;
}
async function allocatedArtifactReadable(env: Env, name: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([(async () => { using repo = await env.ARTIFACTS.get(name); await repo.info(); return true; })(), new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), 5000); })]);
  } catch { return false; }
  finally { if (timer) clearTimeout(timer); }
}

async function reconcileSealedAllocations(env: Env, ledger: Ledger): Promise<boolean> {
  for (const allocation of await ledger.pendingArtifactAllocations()) {
    // reserved never passed the sealed controller's activation boundary. An
    // allocating request may already have reached the provider; require readiness.
    if (allocation.phase === "allocating" && !await allocatedArtifactReadable(env, allocation.name)) return false;
    await projectOf(env, allocation.projectId).settleArtifactAllocation(allocation.name, allocation.operationId);
    await accountOf(env, allocation.accountKey).settleArtifactAllocation(allocation.name, allocation.operationId);
  }
  return (await ledger.pendingArtifactAllocations()).length === 0;
}

async function fundedPreviewSource(env:Env,identity:PreviewStorageIdentity,previous:PreviewGenerationRecord|null):Promise<{key:string;capacity:import("./preview-storage.js").PreviewStorageAdmission}>{
 const keys=previous?[generationBuildPrefix(identity.projectId,identity.commit,previous.identity.incarnation,previous.generation),previous.sourceKey]:[buildPrefix(identity.projectId,identity.commit)];
 for(const key of new Set(keys)){try{return{key,capacity:await globalOf(env).previewGenerationCapacity(key,identity)};}catch{/* A failed unfunded generation retains its immutable funded ancestor key. */}}
 throw new Error("Funded preview source is unavailable");
}
