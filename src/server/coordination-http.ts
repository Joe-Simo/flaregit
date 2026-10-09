import { z } from "zod";
import type { Env } from "./env.js";
import type { Ledger } from "./durable-object.js";
import type { HumanDecisionActor } from "../core/types.js";
import { advanceMergeQueue } from "./coordination-dispatch.js";
import { gitParentTokenHash } from "./git-gateway-handler.js";
import { readRequestJson, RequestBodyError } from "./request-body.js";
import { enqueueRequestSchema } from "./merge-queue-runner.js";

/** Current identity after re-authentication; null when the session or token changed mid-request. */
export type FreshActor = () => Promise<{ identity: { viaToken?: boolean; tokenScope?: string; expiresAt?: number }; isOwner: boolean } | null>;

export interface CoordinationRequest {
  sub: string;
  method: string;
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  project: Ledger;
  projectId: string;
  userId: string;
  displayName: () => Promise<string>;
  freshActor: (write: boolean) => ReturnType<FreshActor>;
}

const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: noStore });
const text = (message: string, status: number) => new Response(message, { status, headers: noStore });
const removeSchema = z.object({ taskId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,100}$/) }).strict();

/** Merge queue and coordination routes. Returns null for paths it does not own. */
export async function coordinationHttp(input: CoordinationRequest): Promise<Response | null> {
  const { sub, method, request, project, userId } = input;
  if (sub === "/coordination") {
    if (method !== "GET") return text("Coordination status is read with GET", 405);
    try { return json(await project.coordinationView(userId)); } catch { return text("Repository access required", 403); }
  }
  if (sub !== "/merge-queue" && sub !== "/merge-queue/remove") return null;
  if (method !== "POST") return text("Merge queue changes use POST", 405);
  let raw: unknown;
  try { raw = await readRequestJson<unknown>(request, 16_384); } catch (error) { return text(error instanceof RequestBodyError ? error.message : "Invalid request body", 400); }
  const current = await input.freshActor(true);
  if (!current || current.identity.viaToken && current.identity.tokenScope === "read") return text("A signed-in session or a write token for this repository is required", 403);
  const viaToken = current.identity.viaToken === true;
  const actor: HumanDecisionActor = { userId, displayName: (await input.displayName()).slice(0, 120) || "Repository member", viaToken };
  const credentialHash = viaToken ? await gitParentTokenHash(request) : undefined;
  try {
    if (sub === "/merge-queue") {
      const parsed = enqueueRequestSchema.safeParse(raw);
      if (!parsed.success) return text("Send a request id (8-128 letters, digits, - or _) and one to eight different change ids", 400);
      const result = await project.mergeQueueEnqueue(parsed.data, actor, credentialHash, current.identity.expiresAt);
      input.ctx.waitUntil(advanceMergeQueue(input.env, input.projectId).catch(() => console.warn("Merge queue advance was not confirmed; it resumes on the next landing or request")));
      return json(result, result.replayed ? 200 : 202);
    }
    const parsed = removeSchema.safeParse(raw);
    if (!parsed.success) return text("Choose the change to remove", 400);
    const removed = await project.mergeQueueRemove(parsed.data.taskId, actor, credentialHash, current.identity.expiresAt);
    input.ctx.waitUntil(advanceMergeQueue(input.env, input.projectId).catch(() => console.warn("Merge queue advance was not confirmed")));
    return json({ entry: removed });
  } catch (error) {
    // Ledger refusals carry a reason written for people (for example "Queue a before b").
    const reason = error instanceof Error && error.message.length <= 300 && !/^\[|\{/.test(error.message) ? error.message : "The merge queue change could not be confirmed";
    return text(`${reason}. Retrying with the same request id is safe.`, 409);
  }
}
