import { agentBoardTicketSchema } from "../core/agent-board.js";
import type { Identity } from "./access.js";
import type { Ledger } from "./durable-object.js";
import type { Env } from "./env.js";
import { projectOf } from "./projects.js";

/** WebSocket path for the live multi-agent board. Browsers cannot attach an
 * Authorization header to a WebSocket handshake, so the upgrade carries a
 * single-use ticket minted by `agentBoardTicket` behind `authenticate()`. */
export const AGENT_BOARD_SOCKET = /^\/api\/p\/([a-z0-9]{12,16})\/agents\/board\/socket$/;
const TICKET = /^[A-Za-z0-9_-]{43}$/;
const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const refuse = (message: string, status: number) => new Response(message, { status, headers: noStore });

export async function agentBoardSocket(request: Request, env: Env, projectId: string): Promise<Response> {
  if (request.method !== "GET") return refuse("Board socket requires GET", 405);
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return refuse("WebSocket upgrade required", 426);
  const url = new URL(request.url), origin = request.headers.get("Origin");
  // Cross-site WebSocket hijacking guard; the ticket is the credential.
  if (origin !== null && origin !== url.origin) return refuse("Cross-origin board connection refused", 403);
  const ticket = url.searchParams.get("ticket");
  if ([...url.searchParams.keys()].some(key => key !== "ticket") || !ticket || !TICKET.test(ticket)) return refuse("Board ticket required", 401);
  const client = request.headers.get("CF-Connecting-IP");
  if (client && !(await env.API_LIMITER.limit({ key: `agent-board:${client}` })).success) return refuse("Too many requests", 429);
  return projectOf(env, projectId).fetch(new Request(`https://repository.internal/agent-board?ticket=${ticket}`, { headers: { Upgrade: "websocket" } }));
}

/** POST /api/p/:id/agents/board/ticket — reached only after `authenticate()` and the repository read check. */
export async function agentBoardTicket(request: Request, project: Ledger, projectId: string, identity: Identity): Promise<Response> {
  if (request.method !== "POST") return refuse("Board ticket requires POST", 405);
  if (identity.tokenRepo && identity.tokenRepo !== projectId) return refuse("Token is limited to another repository", 403);
  // Session JWTs are short-lived and renewed by the client; the socket is fenced
  // by repository membership instead. Expiring API/app tokens bound the socket.
  const credentialExpiresAt = identity.viaToken ? identity.expiresAt ?? null : null;
  try {
    return Response.json(agentBoardTicketSchema.parse(await project.issueAgentBoardTicket(identity.id, credentialExpiresAt)), { headers: noStore });
  } catch {
    return refuse("Repository read access required", 403);
  }
}
