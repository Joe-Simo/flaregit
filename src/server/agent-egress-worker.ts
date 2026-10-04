import { WorkerEntrypoint } from "cloudflare:workers";
import { z } from "zod";
import { assignedAgentEgress, agentExecutionEgressScopeSchema, type AgentExecutionEgressSnapshot, type AgentExecutionGitCredential } from "./agent-execution-egress";
import type { Env } from "./env";
import { projectOf } from "./projects";

export const agentEgressWorkerPropsSchema = z.object({ attemptId: z.uuid(), nativeId: z.uuid(), scope: agentExecutionEgressScopeSchema }).strict();
export type AgentEgressWorkerProps = z.infer<typeof agentEgressWorkerPropsSchema>;
/** Root-ledger methods remain private RPCs. Credential mint must save its exact
 * issuance intent before the SDK call and its token before returning to the Worker.
 * Pending or lost replies do not grant cancellation or cleanup success. */
export interface AgentEgressLedger {
  agentRelayCurrent(props: AgentEgressWorkerProps): Promise<AgentExecutionEgressSnapshot>;
  agentRelayBeforeCredential(props: AgentEgressWorkerProps, requestId: string, access: "read" | "write"): Promise<void>;
  agentRelayCredential(props: AgentEgressWorkerProps, issuanceId: string, access: "read" | "write"): Promise<AgentExecutionGitCredential>;
  agentRelayBeforeTransfer(props: AgentEgressWorkerProps, requestId: string): Promise<void>;
  revokeAgentCredential(issuanceId: string): Promise<boolean>;
}
async function deadline<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Private agent egress deadline")), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}

/** No public route. Props come only from the server-created per-instance service
 * binding. VM request headers, query parameters and body never supply authority.
 */
export async function agentEgressWorkerResponse(request: Request, input: AgentEgressWorkerProps, ledger: AgentEgressLedger, retainBackground: (promise: Promise<unknown>) => void, fetcher: (request: Request) => Promise<Response> = request => globalThis.fetch(request)): Promise<Response> {
  let props: AgentEgressWorkerProps;
  try { props = agentEgressWorkerPropsSchema.parse(input); } catch { return new Response("Agent egress denied", { status: 403 }); }
  if (typeof retainBackground !== "function") return new Response("Agent egress unavailable", { status: 503 });
  const requestId = crypto.randomUUID(), issued = new Set<string>();
  let response: Response | undefined, cleanupConfirmed = true, closed = false;
  const assertOpen = () => { if (closed) throw new Error("Private agent request has ended"); };
  try {
    // One request ID binds purpose-specific budget grants and its one credential
    // issuance. Actual retries receive new IDs; callback repetition does not.
    const handler = assignedAgentEgress(props.scope, {
      current: async () => { assertOpen(); const current = await ledger.agentRelayCurrent(props); assertOpen(); return current; },
      beforeCredential: async (_scope, access) => { assertOpen(); await ledger.agentRelayBeforeCredential(props, requestId, access); assertOpen(); },
      credential: async (_scope, access) => {
        assertOpen(); issued.add(requestId); // Register cleanup before awaiting a possibly lost issuance ACK.
        const issuance = ledger.agentRelayCredential(props, requestId, access);
        const revokeLate = async () => {
          if (!closed) return;
          try { await deadline(ledger.revokeAgentCredential(requestId), 10000); }
          catch { /* Root durable intent and alarm retain unknown late cleanup. */ }
        };
        // Retain the original issuance, never issue another token to repair an ACK.
        // A late success/failure after the foreground response retries exact cleanup.
        retainBackground(issuance.then(revokeLate, revokeLate));
        const credential = await issuance; assertOpen(); return credential;
      },
      beforeTransfer: async () => { assertOpen(); await ledger.agentRelayBeforeTransfer(props, requestId); assertOpen(); },
      fetch: request => { assertOpen(); return fetcher(request); },
    });
    response = await deadline(handler.fetch(request), 11000);
  } catch { response = new Response("Agent egress unavailable", { status: 503 }); }
  finally {
    closed = true;
    const cleanupUntil = Date.now() + 10000;
    for (const issuanceId of issued) {
      try { if (!await deadline(ledger.revokeAgentCredential(issuanceId), Math.max(1, cleanupUntil - Date.now()))) cleanupConfirmed = false; }
      catch { cleanupConfirmed = false; }
    }
  }
  if (!cleanupConfirmed) {
    void response?.body?.cancel().catch(() => undefined);
    return new Response("Agent egress cleanup unconfirmed", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return response ?? new Response("Agent egress unavailable", { status: 503 });
}

/** Private service export: root wiring must construct it with ctx.exports and
 * install both native HTTP/HTTPS interception before an Internet-disabled start. */
export class AgentEgressWorker extends WorkerEntrypoint<Env, AgentEgressWorkerProps> {
  override fetch(request: Request): Promise<Response> {
    const props = agentEgressWorkerPropsSchema.safeParse(this.ctx.props);
    if (!props.success) return Promise.resolve(new Response("Agent egress denied", { status: 403 }));
    return agentEgressWorkerResponse(request, props.data, projectOf(this.env, props.data.scope.projectId), promise => this.ctx.waitUntil(promise));
  }
}
