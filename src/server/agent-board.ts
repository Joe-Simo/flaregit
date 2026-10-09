import {
  AGENT_BOARD_ACCESS_CLOSED, AGENT_BOARD_STEPS, agentBoardAgentSchema, agentBoardClientMessageSchema, agentBoardEventSchema, overlapWarningSchema,
  type AgentBoardAgent, type AgentBoardEvent, type AgentBoardTicket, type OverlapWarning,
} from "../core/agent-board.js";
import type { Task } from "../core/types.js";
import { AgentRunLedger, type AgentRunRecord } from "./agent-run-ledger.js";
import { coordinationContext, detectAgentOverlaps, type OverlapParticipant } from "./agent-overlap.js";
import { MembershipEpochs } from "./membership-epochs.js";

/** Repository-controller capabilities the board needs; supplied by the owning DO. */
export interface AgentBoardPorts {
  tasks(): Readonly<Record<string, Task>>;
  /** True while the repository is being deleted; every viewer is closed. */
  deleting(): boolean;
  /** The same full repository read fence the agent-run views use (direct or inherited). */
  canRead(userId: string): Promise<boolean>;
}

interface ViewerAttachment { userId: string; stamp: string; sessionExpiresAt: number | null }

const TAG = "agent-board";
const TICKET_TTL_MS = 30_000;
const MAX_OUTSTANDING_TICKETS = 20;
const MAX_RUNS = 500;
const MAX_FILES = 200;
const MAX_CLIENT_MESSAGE = 1024;
const SHA = /^[0-9a-f]{40}$/;
const TICKET = /^[A-Za-z0-9_-]{43}$/;
const STOPPED = new Set(["accepted", "cancelled"]);

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
const ticketHash = async (ticket: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ticket)));
const base64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Live multi-agent board on the repository Durable Object.
 *
 * Viewers connect through the Hibernatable WebSockets API; a socket costs no
 * duration while idle. Every agent-run mutation calls `refresh()`, which
 * recomputes the in-flight view and pairwise overlaps, persists both, and
 * broadcasts only the differences with a durable sequence number. Each viewer
 * carries an authority stamp (incarnation, direct role + membership epoch, or
 * the inherited organization source revisions) captured at upgrade; any change
 * to it closes the socket before more data is sent.
 */
export class AgentBoard {
  constructor(private readonly ctx: DurableObjectState, private readonly ports: AgentBoardPorts) {
    new AgentRunLedger(ctx.storage);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS agent_board_tickets(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL,session_expires_at INTEGER);
      CREATE TABLE IF NOT EXISTS agent_board_rows(run_id TEXT PRIMARY KEY,doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_overlap_warnings(id TEXT PRIMARY KEY,task_a TEXT NOT NULL,task_b TEXT NOT NULL,doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_board_sequence(id INTEGER PRIMARY KEY CHECK(id=1),seq INTEGER NOT NULL CHECK(seq>=0));
      INSERT OR IGNORE INTO agent_board_sequence VALUES(1,0);`);
  }

  /** Single-use, short-lived upgrade ticket; only its hash is stored. */
  async issueTicket(userId: string, sessionExpiresAt: number | null): Promise<AgentBoardTicket> {
    if (!(await this.ports.canRead(userId))) throw new Error("Repository read access required");
    const ticket = base64Url(crypto.getRandomValues(new Uint8Array(32))), hash = await ticketHash(ticket);
    const now = Date.now(), expiresAt = Math.min(now + TICKET_TTL_MS, sessionExpiresAt ?? Number.MAX_SAFE_INTEGER);
    if (expiresAt <= now) throw new Error("Session expired");
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM agent_board_tickets WHERE expires_at<=?", now);
      const outstanding = this.ctx.storage.sql.exec<{ total: number }>("SELECT COUNT(*) AS total FROM agent_board_tickets WHERE user_id=?", userId).toArray()[0]!.total;
      if (outstanding >= MAX_OUTSTANDING_TICKETS) throw new Error("Too many pending board connections");
      this.ctx.storage.sql.exec("INSERT INTO agent_board_tickets VALUES(?,?,?,?)", hash, userId, expiresAt, sessionExpiresAt);
    });
    return { ticket, expiresAt };
  }

  /** Consume a ticket, re-check repository read access, and accept a hibernatable socket. */
  async accept(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket upgrade required", { status: 426 });
    const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
    if (!TICKET.test(ticket)) return new Response("Board ticket required", { status: 401 });
    const hash = await ticketHash(ticket), now = Date.now();
    const row = this.ctx.storage.sql.exec<{ user_id: string; expires_at: number; session_expires_at: number | null }>("DELETE FROM agent_board_tickets WHERE hash=? RETURNING user_id,expires_at,session_expires_at", hash).toArray()[0];
    if (!row || row.expires_at <= now || row.session_expires_at !== null && row.session_expires_at <= now) return new Response("Board ticket expired or already used", { status: 401 });
    const stamp = this.stamp(row.user_id);
    if (!(await this.ports.canRead(row.user_id))) return new Response("Repository read access required", { status: 403 });
    if (this.ports.deleting() || this.stamp(row.user_id) !== stamp) return new Response("Repository access changed during connection", { status: 409 });
    const snapshot = JSON.stringify(this.snapshot());
    const pair = new WebSocketPair(), [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [TAG]);
    server.serializeAttachment({ userId: row.user_id, stamp, sessionExpiresAt: row.session_expires_at } satisfies ViewerAttachment);
    server.send(snapshot);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.authorized(ws)) return;
    if (typeof message !== "string" || message.length > MAX_CLIENT_MESSAGE) { ws.close(1008, "Unsupported board message"); return; }
    let value: unknown;
    try { value = JSON.parse(message); } catch { ws.close(1008, "Unsupported board message"); return; }
    const parsed = agentBoardClientMessageSchema.safeParse(value);
    if (!parsed.success) { ws.close(1008, "Unsupported board message"); return; }
    if (parsed.data.type === "resync") ws.send(JSON.stringify(this.snapshot()));
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try { ws.close(code === 1005 || code === 1006 || code === 1015 ? 1000 : code, "Board closed"); } catch { /* already closed */ }
  }

  /** Close every viewer whose repository authority changed since upgrade. */
  revalidate(): WebSocket[] {
    return this.ctx.getWebSockets(TAG).filter(ws => this.authorized(ws));
  }

  /** Recompute, persist and broadcast differences. Never throws into the caller's agent mutation. */
  refresh(): void {
    try {
      const events = this.ctx.storage.transactionSync(() => this.reconcile());
      if (!events.length) return;
      const viewers = this.revalidate();
      for (const event of events) {
        const frame = JSON.stringify(agentBoardEventSchema.parse(event));
        for (const ws of viewers) { try { ws.send(frame); } catch { /* closing socket */ } }
      }
    } catch (error) {
      console.error(JSON.stringify({ message: "agent board refresh failed", error: error instanceof Error ? error.message : "unknown" }));
    }
  }

  /** Persisted, sequence-consistent full view. Pending differences are first
   * broadcast to existing viewers so no sequence number is skipped for them. */
  snapshot(): AgentBoardEvent {
    this.refresh();
    return this.ctx.storage.transactionSync(() => {
      const agents = this.ctx.storage.sql.exec<{ doc: string }>("SELECT doc FROM agent_board_rows ORDER BY run_id").toArray().map(row => agentBoardAgentSchema.parse(JSON.parse(row.doc)));
      const overlaps = this.ctx.storage.sql.exec<{ doc: string }>("SELECT doc FROM agent_overlap_warnings ORDER BY id").toArray().map(row => overlapWarningSchema.parse(JSON.parse(row.doc)));
      return agentBoardEventSchema.parse({ type: "snapshot", seq: this.sequence(), agents, overlaps });
    });
  }

  /** Persisted overlap warnings that involve one change. */
  warningsFor(taskId: string): OverlapWarning[] {
    return this.ctx.storage.sql.exec<{ doc: string }>("SELECT doc FROM agent_overlap_warnings WHERE task_a=? OR task_b=? ORDER BY id", taskId, taskId).toArray().map(row => overlapWarningSchema.parse(JSON.parse(row.doc)));
  }

  /** Shared-context lines for one agent's prompt, from current concurrent branches. */
  coordinationContext(runId: string, taskId: string): string[] {
    const { participants } = this.collect();
    return coordinationContext(runId, taskId, participants, detectAgentOverlaps(participants, new Date().toISOString()));
  }

  private authorized(ws: WebSocket): boolean {
    const attachment = ws.deserializeAttachment() as ViewerAttachment | null;
    const current = attachment !== null && !this.ports.deleting() && this.stamp(attachment.userId) === attachment.stamp && (attachment.sessionExpiresAt === null || Date.now() < attachment.sessionExpiresAt);
    if (!current) { try { ws.close(AGENT_BOARD_ACCESS_CLOSED, "Repository access changed"); } catch { /* already closed */ } }
    return current;
  }

  /** Authority generation for one viewer. Direct members are fenced by their
   * membership epoch (bumped by SQL triggers on every insert, delete or role
   * change); inherited viewers by the saved organization source revisions. */
  private stamp(userId: string): string {
    const sql = this.ctx.storage.sql;
    const table = (name: string) => sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", name).toArray().length > 0;
    const incarnation = table("private_recovery_incarnation") ? sql.exec<{ value: string }>("SELECT value FROM private_recovery_incarnation WHERE id=1").toArray()[0]?.value ?? null : null;
    const role = table("members") ? sql.exec<{ role: string }>("SELECT role FROM members WHERE user_id=?", userId).toArray()[0]?.role ?? null : null;
    const epoch = role ? new MembershipEpochs(this.ctx.storage).read(userId) : null;
    const sources = !role && table("repository_organization_sources") ? sql.exec<{ id: string; revision: number }>("SELECT id,revision FROM repository_organization_sources ORDER BY id").toArray().map(row => [row.id, row.revision]) : [];
    return JSON.stringify({ incarnation, role, epoch, sources });
  }

  private sequence(): number { return this.ctx.storage.sql.exec<{ seq: number }>("SELECT seq FROM agent_board_sequence WHERE id=1").toArray()[0]!.seq; }
  private next(): number { return this.ctx.storage.sql.exec<{ seq: number }>("UPDATE agent_board_sequence SET seq=seq+1 WHERE id=1 RETURNING seq").toArray()[0]!.seq; }

  private collect(): { agents: Omit<AgentBoardAgent, "overlapIds">[]; participants: OverlapParticipant[] } {
    const tasks = this.ports.tasks();
    const runs = this.ctx.storage.sql.exec<{ doc: string }>("SELECT r.doc FROM agent_run_heads h JOIN agent_runs r ON r.id=h.run_id ORDER BY h.task_id LIMIT ?", MAX_RUNS).toArray().map(row => JSON.parse(row.doc) as AgentRunRecord);
    const agents: Omit<AgentBoardAgent, "overlapIds">[] = [], participants: OverlapParticipant[] = [];
    for (const run of runs) {
      const task = tasks[run.taskId];
      if (!task || run.phase === "failed" || STOPPED.has(task.status)) continue;
      const files = new Map<string, string | null>();
      for (const checkpoint of task.checkpoints) for (const file of checkpoint.filesChanged) if (file.length <= 500) files.set(file, null);
      for (const [file, content] of Object.entries(run.proposal?.files ?? {})) files.set(file, content);
      const title = ((run.context.issue?.title || run.goal).split("\n")[0] ?? "").trim().slice(0, 200) || run.taskId;
      const phase = run.phase === "claimed" ? "planning" : run.phase;
      agents.push({
        runId: run.runId, taskId: run.taskId, title, phase, taskStatus: task.status.slice(0, 40),
        filesTouched: [...files.keys()].sort().slice(0, MAX_FILES),
        commit: run.pushedCommit ?? (task.currentCommit && SHA.test(task.currentCommit) ? task.currentCommit : null),
        progress: { round: run.generation, step: AGENT_BOARD_STEPS.indexOf(phase) + 1, steps: AGENT_BOARD_STEPS.length },
        updatedAt: run.updatedAt,
      });
      participants.push({ runId: run.runId, taskId: run.taskId, title, files });
    }
    return { agents, participants };
  }

  /** Diff the current view against the persisted one inside the caller's transaction. */
  private reconcile(): AgentBoardEvent[] {
    const sql = this.ctx.storage.sql, events: AgentBoardEvent[] = [];
    const { agents, participants } = this.collect();
    const stored = new Map(sql.exec<{ id: string; doc: string }>("SELECT id,doc FROM agent_overlap_warnings").toArray().map(row => [row.id, overlapWarningSchema.parse(JSON.parse(row.doc))]));
    const warnings = detectAgentOverlaps(participants, new Date().toISOString()).map(warning => {
      const previous = stored.get(warning.id);
      return previous && previous.kind === warning.kind && previous.a.runId === warning.a.runId && previous.b.runId === warning.b.runId && previous.a.title === warning.a.title && previous.b.title === warning.b.title ? previous : warning;
    });
    const current = new Map(warnings.map(warning => [warning.id, warning]));
    for (const [id] of stored) if (!current.has(id)) { sql.exec("DELETE FROM agent_overlap_warnings WHERE id=?", id); events.push({ type: "overlap.cleared", seq: this.next(), id }); }
    for (const warning of warnings) {
      if (stored.get(warning.id) === warning) continue;
      sql.exec("INSERT INTO agent_overlap_warnings VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET task_a=excluded.task_a,task_b=excluded.task_b,doc=excluded.doc", warning.id, warning.a.taskId, warning.b.taskId, JSON.stringify(warning));
      events.push({ type: "overlap.added", seq: this.next(), overlap: warning });
    }
    const rows = new Map(sql.exec<{ run_id: string; doc: string }>("SELECT run_id,doc FROM agent_board_rows").toArray().map(row => [row.run_id, row.doc]));
    const live = new Set<string>();
    for (const view of agents) {
      const agent = agentBoardAgentSchema.parse({ ...view, overlapIds: warnings.filter(warning => warning.a.runId === view.runId || warning.b.runId === view.runId).map(warning => warning.id).slice(0, 200) });
      const doc = JSON.stringify(agent);
      live.add(agent.runId);
      if (rows.get(agent.runId) === doc) continue;
      sql.exec("INSERT INTO agent_board_rows VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET doc=excluded.doc", agent.runId, doc);
      events.push({ type: "agent.updated", seq: this.next(), agent });
    }
    for (const [runId] of rows) if (!live.has(runId)) { sql.exec("DELETE FROM agent_board_rows WHERE run_id=?", runId); events.push({ type: "agent.removed", seq: this.next(), runId }); }
    return events;
  }
}
