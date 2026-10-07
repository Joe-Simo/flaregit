import {acceptanceRuntimeReleaseSchema,acceptanceReleasePinSchema,pinAcceptanceRelease,acceptanceCloneEnvironment} from './acceptance-release';
import { chmod, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { redactSecrets } from "../agents/prompt.js";

const sha = z.string().regex(/^[0-9a-f]{40}$/);
const receiptSchema = z.object({
  version: z.literal(1), exercise: z.enum(["functional-ticket-booking", "comment-only-hosted-diagnostic"]).optional(), origin: z.string().url(), createdAt: z.string(), projectId: z.string().optional(), base: sha.optional(),
  releasePin: acceptanceReleasePinSchema.optional(),
  issue: z.number().optional(), tasks: z.array(z.string()), agentRuns: z.array(z.object({ taskId: z.string(), instanceId: z.string(), requestedAt: z.string() })),
  contextCommentRequests: z.record(z.string(), z.string().uuid()).optional(),
  contextComments: z.array(z.object({ subject: z.string(), id: z.number() })).optional(), pendingAction: z.string().optional(), pendingAgents: z.array(z.string()).optional(), integration: z.string().optional(), observations: z.array(z.unknown()), verification: z.object({ commit: sha, cloneHead: sha, verifiedAt: z.string(), candidateId: z.string().optional(), integration: z.string().optional(), evidenceId: z.string().optional() }).optional(),
});
type Receipt = z.infer<typeof receiptSchema>;
export const acceptanceStateSchema = z.object({
  acceptedState: z.union([z.object({ kind: z.literal("unborn"), currentCommit: z.null() }), z.object({ kind: z.literal("committed").optional(), currentCommit: sha })]),
  tasks: z.record(z.string(), z.object({ status: z.string(), agentWorkflowInstanceId: z.string().optional(), baseCommit: sha.nullable(), currentCommit: sha.nullable(), checkpoints: z.array(z.object({ commitHash: sha, timestamp: z.string(), filesChanged: z.array(z.string()) })) })),
  candidates: z.record(z.string(), z.object({ status: z.string(), candidateCommit: sha.optional(), expectedAcceptedBase: sha.nullable(), acceptedTarget: z.object({ kind: z.enum(["unborn", "committed"]).optional(), acceptedCommit: sha.nullable(), acceptedVersion: z.number().int(), requirements: z.array(z.unknown()) }).optional(), evidenceId: z.string().optional(), workflowInstanceId: z.string().optional(), compositionMethod: z.string().optional(), participatingTaskIds: z.array(z.string()).optional(), repairAttempts: z.array(z.object({ round: z.number(), affectedContracts: z.array(z.string()), timestamp: z.string(), durationMs: z.number() })), review: z.object({ approved: z.boolean(), at: z.string(), commit: sha }).optional() }).refine(candidate => candidate.expectedAcceptedBase !== null || (candidate.acceptedTarget?.kind === "unborn" && candidate.acceptedTarget.acceptedCommit === null && candidate.acceptedTarget.acceptedVersion === 0 && candidate.acceptedTarget.requirements.length === 0), { message: "An unborn candidate requires its explicit frozen unborn target" })),
  evidence: z.record(z.string(), z.object({ status: z.string(), candidateCommit: sha.optional() })), decisions: z.record(z.string(), z.unknown()),
});

/** Local receipts contain allowlisted observations, never API/clone credentials or raw responses. */
export async function saveReceipt(file: string, receipt: Receipt) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, redactSecrets(JSON.stringify(receipt, null, 2)) + "\n", { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

class AcceptanceError extends Error {}
export function requireAcceptedCommit(state: z.infer<typeof acceptanceStateSchema>): string {
  if (state.acceptedState.currentCommit === null) throw new AcceptanceError("This repository has no accepted commit yet. Review and accept its first real contribution before proving durable integration.");
  return state.acceptedState.currentCommit;
}

/** A native clone is proof for this exercise only when its accepted candidate
 * belongs to the saved integration and exactly the saved contributions. */
export function requireReceiptLanding(state: z.infer<typeof acceptanceStateSchema>, receipt: Pick<Receipt, "integration" | "tasks" | "base">) {
  const accepted = requireAcceptedCommit(state);
  if (!receipt.integration || receipt.tasks.length !== 2 || new Set(receipt.tasks).size !== 2) throw new AcceptanceError("Saved exercise integration and two distinct contributions are required");
  const matches = Object.entries(state.candidates).filter(([, candidate]) => candidate.status === "accepted" && candidate.candidateCommit === accepted && candidate.workflowInstanceId === receipt.integration && candidate.review?.approved && candidate.review.commit === accepted && candidate.participatingTaskIds?.length === receipt.tasks.length && new Set(candidate.participatingTaskIds).size === receipt.tasks.length && receipt.tasks.every(task => candidate.participatingTaskIds?.includes(task)));
  if (matches.length !== 1 || accepted === receipt.base) throw new AcceptanceError("No unique reviewed landing for this saved integration and its contributions; unrelated accepted history is not exercise proof");
  const [candidateId, candidate] = matches[0]!;
  if (!candidate.evidenceId || (state.evidence[candidate.evidenceId]?.status !== "passed" || state.evidence[candidate.evidenceId]?.candidateCommit !== accepted)) throw new AcceptanceError("Saved integration has no passed exact candidate evidence");
  return { accepted, candidateId, integration: receipt.integration, evidenceId: candidate.evidenceId };
}

export function assertReceiptOrigin(stored: string, configured: string) {
  const expected = new URL(configured), actual = new URL(stored);
  for (const origin of [expected, actual]) if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new AcceptanceError("Acceptance origins must be credential-free HTTPS origins");
  if (actual.origin !== expected.origin) throw new AcceptanceError("Receipt origin differs from configured FLAREGIT_ORIGIN; authentication was not sent");
}
export function pendingAgentTasks(receipt: Pick<Receipt, "tasks" | "agentRuns">) {
  return receipt.tasks.filter((taskId) => !receipt.agentRuns.some((run) => run.taskId === taskId));
}

export function observedAgentInstances(receipt: Pick<Receipt, "tasks" | "agentRuns">, tasks: Record<string, { agentWorkflowInstanceId?: string }>) {
  const instances = new Set(receipt.agentRuns.map((run) => run.instanceId));
  for (const taskId of receipt.tasks) {
    const registered = tasks[taskId]?.agentWorkflowInstanceId;
    if (registered) instances.add(registered);
  }
  return [...instances];
}

export function contextCommentRequest(receipt: Pick<Receipt, "contextCommentRequests">, subject: string): string {
  receipt.contextCommentRequests ??= {};
  return receipt.contextCommentRequests[subject] ??= crypto.randomUUID();
}

export async function observeContextComments(subject: string, readPage: (cursor: string | null) => Promise<{ comments: Array<{ id: number }>; nextCursor: string | null }>) {
  const ids = new Set<number>();
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  try {
    do {
      const page = await readPage(cursor); pages++;
      for (const comment of page.comments) ids.add(comment.id);
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) return { subject, commentIds: [...ids], count: null, observedCount: ids.size, complete: false, pages, reason: "Repeated pagination cursor" };
      if (cursor) cursors.add(cursor);
    } while (cursor && pages < 5);
    return { subject, commentIds: [...ids], count: cursor ? null : ids.size, observedCount: ids.size, complete: cursor === null, pages, reason: cursor ? "Observation page limit reached" : null };
  } catch {
    return { subject, commentIds: [...ids], count: null, observedCount: ids.size, complete: false, pages, reason: "Comment page unavailable" };
  }
}

async function main() {
  const phase = process.argv[2];
  if (!["prepare", "status", "integrate", "verify"].includes(phase ?? "")) throw new AcceptanceError("Usage: bun run src/cli/acceptance.ts prepare|status|integrate|verify [receipt.json]. Set FLAREGIT_TOKEN and optionally FLAREGIT_ORIGIN.");
  const token = process.env.FLAREGIT_TOKEN;
  if (!token) throw new AcceptanceError("FLAREGIT_TOKEN is required; use your own authenticated session or full API token. Credentials are accepted only through environment variables.");
  const file = resolve(process.argv[3] ?? "acceptance-receipt.json");
  let receipt: Receipt;
  const configuredOrigin = process.env.FLAREGIT_ORIGIN ?? "https://flaregit.com";
  try { receipt = receiptSchema.parse(JSON.parse(await readFile(file, "utf8"))); }
  catch (error) {
    if (phase !== "prepare" || !(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    receipt = { version: 1, exercise: "functional-ticket-booking", origin: configuredOrigin, createdAt: new Date().toISOString(), tasks: [], agentRuns: [], observations: [] };
    assertReceiptOrigin(receipt.origin, configuredOrigin);
    await saveReceipt(file, receipt);
  }
  assertReceiptOrigin(receipt.origin, configuredOrigin);
  const api = async <T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> => {
    const url = new URL(`/api${path}`, receipt.origin);
    const response = await fetch(url, { method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(receipt.releasePin?{"X-FlareGit-Expected-Worker-Version":receipt.releasePin.workerVersion,"X-FlareGit-Expected-Source-Version":receipt.releasePin.sourceVersion}:{}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: "error", signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new AcceptanceError(`API ${path} answered ${response.status}; saved receipt remains resumable`);
    return schema.parse(await response.json());
  };
  if(phase!=="status"||receipt.releasePin){
    if(phase!=="prepare"&&!receipt.releasePin)throw new AcceptanceError("This legacy receipt has no release identity. Status remains available; use a fresh prepare receipt for exact-version acceptance proof.");
    const runtime=await api("/runtime",acceptanceRuntimeReleaseSchema);
    receipt.releasePin=pinAcceptanceRelease(runtime,receipt.releasePin);
    await saveReceipt(file,receipt);
  }
  if (phase === "prepare") {
    if (receipt.pendingAction || receipt.pendingAgents?.length) throw new AcceptanceError("A previous mutation has an unknown outcome. Inspect the authenticated app and reconcile pendingAction/pendingAgents in the receipt before retrying; no duplicate resource or run will be created.");
    if (!receipt.projectId) {
    receipt.pendingAction = "create-repository"; await saveReceipt(file, receipt);
    const created = await api("/projects", z.object({ id: z.string(), head: sha }), { kind: "demo", name: `Acceptance evidence ${new Date().toISOString().slice(0, 10)} ${crypto.randomUUID().slice(0, 6)}` });
    receipt.projectId = created.id; receipt.base = created.head; delete receipt.pendingAction;
    await saveReceipt(file, receipt);
    }
    const prefix = `/p/${receipt.projectId}`;
    if (!receipt.issue) {
    receipt.pendingAction = "create-issue"; await saveReceipt(file, receipt);
    const issue = await api(`${prefix}/issues`, z.object({ number: z.number() }), { title: "Hosted concurrent-agent acceptance exercise", body: "Explicit test repository owned by this entrant. Two actual coding agents change the same existing source file. Human review is required; observed conflicts or failures are recorded without claims of success." });
    receipt.issue = issue.number; delete receipt.pendingAction; await saveReceipt(file, receipt);
    }
    const goals = receipt.exercise === "functional-ticket-booking" ? [
      "In src/pricing.ts implement a 15% group discount for orders of four or more tickets. Four $40 nonrefundable tickets must total $136; three remain $120. Keep the existing public types and exports, and do not modify any other file. Another contributor will implement refundable fees; leave that feature for their change.",
      "In src/pricing.ts implement optional refundable tickets with a $5 per-ticket surcharge and the isRefundable flag. Two $40 refundable tickets must total $90. Keep existing public types and exports, and do not modify any other file. Another contributor will implement group discounts; leave that feature for their change.",
    ] : [
      "In src/pricing.ts add one concise header comment explaining that prices are quoted before payment. Preserve every behavior and export; do not modify any other file.",
      "In src/pricing.ts add one concise header comment explaining that refunds follow the booking policy. Preserve every behavior and export; do not modify any other file.",
    ];
    for (const [index, goal] of goals.entries()) {
      if (receipt.tasks[index]) continue;
      const taskId = `acceptance-${index + 1}-${crypto.randomUUID().slice(0, 8)}`;
      receipt.pendingAction = `create-task:${taskId}`; await saveReceipt(file, receipt);
      await api(`${prefix}/tasks`, z.object({ task: z.string() }), { taskId, goal, issue: receipt.issue });
      receipt.tasks.push(taskId); delete receipt.pendingAction; await saveReceipt(file, receipt);
    }
    // Shared context is persisted before dispatch so interruptions do not depend on a terminal prompt.
    for (const taskId of receipt.tasks) {
      const subject = `change:${taskId}`;
      if (receipt.contextComments?.some((comment) => comment.subject === subject)) continue;
      const idempotencyKey = contextCommentRequest(receipt, subject);
      receipt.pendingAction = `create-context-comment:${taskId}`; await saveReceipt(file, receipt);
      const comment = await api(`${prefix}/comments`, z.object({ id: z.number() }), {
        subject, idempotencyKey,
        body: receipt.exercise === "functional-ticket-booking" ? "Shared approved policy: 15% group discount starts at four tickets; refundable tickets add $5 each. Discount applies to ticket subtotal, not the refund fee, so four refundable $40 tickets total $156. Preserve both contributors' features in the final integration. This is shared task context, not approval." : "Hosted diagnostic: another contributor is editing the same pricing file. Preserve existing exports and every checkout behavior. Keep this task's purpose visible and review any combined repair explicitly; this comment is shared task context, not approval.",
      });
      receipt.contextComments ??= []; receipt.contextComments.push({ subject, id: comment.id });
      delete receipt.pendingAction; await saveReceipt(file, receipt);
    }
    console.log(receipt.exercise === "functional-ticket-booking" ? "Functional exercise requests independent discount and refundable-ticket features. Actual concurrent execution, conflict, correct combined behavior, and human review still require observed evidence." : "Diagnostic exercise: comment-only edits do not demonstrate meaningful functional contributions or satisfy the full competition demo.");
    let saving = Promise.resolve();
    const toStart = pendingAgentTasks(receipt);
    receipt.pendingAgents = toStart; await saveReceipt(file, receipt);
    const starts = await Promise.allSettled(toStart.map(async (taskId) => {
      const requestedAt = new Date().toISOString();
      const run = await api(`${prefix}/tasks/${taskId}/agent`, z.object({ instanceId: z.string() }), {});
      receipt.agentRuns.push({ taskId, instanceId: run.instanceId, requestedAt });
      receipt.pendingAgents = receipt.pendingAgents?.filter((id) => id !== taskId);
      saving = saving.then(() => saveReceipt(file, receipt)); await saving;
    }));
    console.log(`Prepared owned test repository ${receipt.projectId}. Actual agent starts recorded: ${receipt.agentRuns.length}/2. Receipt: ${file}`);
    if (starts.some((r) => r.status === "rejected")) throw new AcceptanceError("At least one agent start failed. Inspect status and the app; no concurrency success is claimed.");
    console.log("Run status to observe checkpoints and failures. Overlapping edits are requested; an actual conflict must be observed before claiming one.");
    return;
  }
  if (!receipt.projectId) throw new AcceptanceError("Prepare did not finish repository creation; inspect the owned account before retrying");
  const prefix = `/p/${receipt.projectId}`;
  const state = await api(`${prefix}/state`, acceptanceStateSchema);
  if (phase === "integrate") {
    if (receipt.integration) throw new AcceptanceError("An integration is already recorded; inspect status rather than enqueueing another");
    if (receipt.tasks.length !== 2 || !receipt.tasks.every((id) => state.tasks[id]?.status === "ready")) throw new AcceptanceError("Both actual agent changes must be ready before integration; inspect failures in the app");
    if (receipt.pendingAction) throw new AcceptanceError("An earlier mutation requires explicit recovery before another integration");
    receipt.pendingAction = "queue-integration"; await saveReceipt(file, receipt);
    const result = await api(`${prefix}/integrations`, z.object({ queued: z.string() }), { taskIds: receipt.tasks });
    receipt.integration = result.queued; delete receipt.pendingAction; await saveReceipt(file, receipt);
    console.log(`Queued actual integration ${result.queued}. Run status. Human review must be completed explicitly in the app.`); return;
  }
  if (phase === "status") {
    const recordedInstances = observedAgentInstances(receipt, state.tasks);
    const runs = await Promise.all([...recordedInstances, ...(receipt.integration ? [receipt.integration] : [])].map(async (id) => {
      try { const result = await api(`${prefix}/workflows/${id}`, z.object({ status: z.string() })); return { instanceId: id, status: result.status }; }
      catch { return { instanceId: id, status: "unavailable" }; }
    }));
    const subjects = [...receipt.tasks.map((id) => `change:${id}`), ...(receipt.issue ? [`issue:${receipt.issue}`] : [])];
    const context = await Promise.all(subjects.map(subject => observeContextComments(subject, cursor => {
      const query = new URLSearchParams({ subject, page: "1" });
      if (cursor) query.set("cursor", cursor);
      return api(`${prefix}/comments?${query}`, z.object({ comments: z.array(z.object({ id: z.number() })).max(100), nextCursor: z.string().max(4096).nullable() }));
    })));
    const observation = { exercise: receipt.exercise ?? "comment-only-hosted-diagnostic", pendingAction: receipt.pendingAction ?? null, pendingAgents: receipt.pendingAgents ?? [], recordedContextComments: receipt.contextComments ?? [], context, at: new Date().toISOString(), acceptedCommit: state.acceptedState.currentCommit, acceptedHistory: state.acceptedState.currentCommit === null ? "unborn; no accepted commit" : "committed",
      tasks: receipt.tasks.map((id) => ({ id, ...state.tasks[id] })), candidates: state.candidates,
      checks: Object.entries(state.evidence).map(([id, evidence]) => ({ id, status: evidence.status })), decisionIds: Object.keys(state.decisions), runs };
    receipt.observations.push(observation); await saveReceipt(file, receipt);
    console.log(JSON.stringify(observation, null, 2));
    if (Object.values(state.candidates).some((c) => c.status === "awaiting_review")) console.log("Pending human acceptance: inspect the exact candidate diff and checks in the app. This runner never approves review.");
    return;
  }
  const landing = requireReceiptLanding(state, receipt);
  const { accepted } = landing;
  const credential = await api(`${prefix}/clone`, z.object({ remote: z.string().url(), token: z.string().min(1) }), {});
  const remote = new URL(credential.remote);
  if (remote.protocol !== "https:" || remote.username || remote.password || remote.search || remote.hash) throw new AcceptanceError("Clone endpoint returned an unsafe credential-bearing remote");
  const directory = await mkdtemp(join(tmpdir(), "flaregit-acceptance-"));
  await chmod(directory, 0o700);
  const git = async (args: string[]) => {
    const gitEnv: NodeJS.ProcessEnv = { ...process.env, ...acceptanceCloneEnvironment(remote.href,receipt.origin,credential.token,acceptanceReleasePinSchema.parse(receipt.releasePin)), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
    delete gitEnv.FLAREGIT_TOKEN;
    delete gitEnv.CLOUDFLARE_API_TOKEN;
    delete gitEnv.TYPESAFE_API_KEY;
    const child = Bun.spawn(["git", ...args], { env: gitEnv, stdout: "pipe", stderr: "pipe" });
    const [out, , exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exitCode !== 0) throw new AcceptanceError("Native Git verification failed; no recoverability success was recorded");
    return out.trim();
  };
  try {
    const checkout = join(directory, "checkout");
    await git(["clone", "--quiet", remote.href, checkout]);
    const cloneHead = await git(["-C", checkout, "rev-parse", "HEAD"]);
    if (cloneHead !== accepted) throw new AcceptanceError("Fresh native clone differs from observed accepted state; inspect concurrent landings before retrying");
    await git(["-C", checkout, "cat-file", "-e", `${accepted}^{commit}`]);
    await git(["-C", checkout, "fsck", "--no-reflogs", "--full"]);
    const freshState = await api(`${prefix}/state`, acceptanceStateSchema);
    if (freshState.acceptedState.currentCommit !== accepted) throw new AcceptanceError("Accepted state advanced during verification; rerun verify for a consistent receipt");
    const freshLanding = requireReceiptLanding(freshState, receipt);
    if (freshLanding.candidateId !== landing.candidateId || freshLanding.evidenceId !== landing.evidenceId) throw new AcceptanceError("Accepted candidate identity changed during native verification");
    receipt.verification = { commit: accepted, cloneHead: sha.parse(cloneHead), verifiedAt: new Date().toISOString(), candidateId: landing.candidateId, integration: landing.integration, evidenceId: landing.evidenceId };
    await saveReceipt(file, receipt);
    console.log(`Verified reviewed accepted commit ${accepted} through a fresh authenticated native Git clone and fsck. Receipt: ${file}`);
    console.log("This proves current recoverable landing state only; interruption, stale-base, conflict, webhook and migration acceptance need their own observed evidence.");
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (import.meta.main) main().catch((error: unknown) => { if (error instanceof AcceptanceError) console.error(error.message); console.error("Acceptance phase failed. Credentials and raw provider errors are suppressed. Inspect the saved receipt and authenticated app; do not claim hosted acceptance passed."); process.exitCode = 1; });
