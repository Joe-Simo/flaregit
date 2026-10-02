import { DurableObject } from "cloudflare:workers";
import { freezeCandidateGeneration } from "../core/pipeline/freeze.js";
import { createProductDecision, detectContradiction } from "../core/decision/contradiction.js";
import type { Env } from "./env.js";
import { accountKeyFor, accountOf } from "./projects.js";
import type {
  CandidateGeneration,
  FlareGitProjectState,
  ProductDecision,
  PublicationJournalEntry,
  Requirement,
  Task,
  VerificationEvidence,
} from "../core/types.js";

export interface ClaimResult { candidate?: CandidateGeneration; decision?: ProductDecision; reason?: string }
export interface PrepareResult { ok: boolean; journal?: PublicationJournalEntry; error?: string; stale?: boolean }

/** Plain-typed view of the ledger RPC surface used by Workflows and Queues. */
export interface ProjectRow {
  id: string;
  name: string;
  role: "owner" | "member";
  kind: string;
  created_at: string;
}
export interface WebhookRow {
  id: string;
  url: string;
  events: string;
  active: number;
  created_at: string;
}
export interface DeliveryRow {
  id: string;
  /** Per-webhook sequence number; deliveries are sent strictly in this order. */
  seq: number;
  /** Milliseconds from enqueue to the first attempt. */
  queue_ms: number | null;
  webhook_id: string;
  event: string;
  status: "pending" | "success" | "failed";
  attempts: number;
  last_status: number | null;
  last_error: string | null;
  latency_ms: number | null;
  created_at: string;
  updated_at: string;
}

export interface ComponentStatus {
  component: string;
  degradedNow: boolean;
  lastCheckAt: number | null;
  checks24h: number;
  failed24h: number;
  lastFailureAt: number | null;
  lastFailureDetail: string | null;
  degradedMinutes24h: number;
}

export const WEBHOOK_EVENTS = ["change.ready", "change.accepted", "change.blocked", "decision.needed"] as const;

/** Limits on a token: `full` acts as the user; `read`/`write` are narrower; `repo` pins it to one repository; `expiresAt` (ms) makes it short-lived. */
export interface TokenScope {
  scope: "full" | "read" | "write";
  repo?: string;
  expiresAt?: number;
}

export interface DomainRow {
  domain: string;
  project_id: string;
  token: string;
  verified_at: string | null;
}

export interface InboxRow {
  id: number;
  project_id: string;
  project_name: string;
  kind: "direct" | "activity";
  type: string;
  title: string;
  created_at: string;
  state: "unread" | "archived" | "snoozed";
}

export interface ApiTokenRow {
  scope: string;
  repo: string | null;
  expires_at: number | null;
  id: string;
  label: string;
  created_at: string;
  last_used: string | null;
}

export interface ActivityRow {
  id: number;
  at: string;
  actor: string;
  type: string;
  summary: string;
}

export interface Ledger {
  listProjects(): Promise<ProjectRow[]>;
  addProject(p: { id: string; name: string; role: "owner" | "member"; kind: string }): Promise<void>;
  removeProject(id: string): Promise<void>;
  roleOf(userId: string): Promise<"owner" | "member" | null>;
  addMember(userId: string, role: "owner" | "member", label?: string): Promise<void>;
  removeMember(userId: string): Promise<void>;
  listMembers(): Promise<Array<{ user_id: string; role: string; label: string | null; added_at: string }>>;
  createInvite(createdBy: string): Promise<string>;
  acceptInvite(token: string, userId: string, label?: string): Promise<boolean>;
  logActivity(actor: string, type: string, summary: string, opts?: { exceptUser?: string }): Promise<void>;
  addInbox(item: { projectId: string; projectName: string; kind: "direct" | "activity"; type: string; title: string }): Promise<void>;
  listInbox(filter: "direct" | "activity" | "snoozed" | "archived"): Promise<InboxRow[]>;
  setInboxState(id: number, state: "unread" | "archived" | "snoozed"): Promise<void>;
  inboxUnread(): Promise<{ direct: number; activity: number }>;
  domainsFor(projectId: string): Promise<DomainRow[]>;
  claimDomain(domain: string, projectId: string): Promise<DomainRow>;
  verifyDomain(domain: string, projectId: string): Promise<{ lostBy: string[] }>;
  releaseDomain(domain: string, projectId: string): Promise<void>;
  createApiToken(userId: string, label: string, secret: string, opts?: TokenScope): Promise<{ id: string }>;
  listApiTokens(): Promise<ApiTokenRow[]>;
  revokeApiToken(id: string): Promise<void>;
  verifyApiToken(secret: string): Promise<{ userId: string; scope: TokenScope["scope"]; repo: string | null } | null>;
  recordProbe(component: string, ok: boolean, latencyMs?: number, detail?: string): Promise<void>;
  statusSummary(): Promise<ComponentStatus[]>;
  addWebhook(url: string, events: string[]): Promise<{ id: string; secret: string }>;
  listWebhooks(): Promise<WebhookRow[]>;
  removeWebhook(id: string): Promise<void>;
  listDeliveries(limit: number): Promise<DeliveryRow[]>;
  getDelivery(id: string): Promise<{ delivery: DeliveryRow & { payload: string }; webhook: { url: string; secret: string; active: number } } | null>;
  markDelivery(id: string, result: { ok: boolean; status?: number; error?: string; latencyMs?: number; final?: boolean }): Promise<number>;
  redeliver(id: string): Promise<boolean>;
  isBlocked(id: string): Promise<boolean>;
  applyRebase(taskId: string, r: { commit?: string; base?: string; parentAccepted?: boolean; failed?: string }): Promise<void>;
  listActivity(limit: number): Promise<ActivityRow[]>;
  setVerificationPolicy(policy: Record<string, unknown>): Promise<void>;
  destroy(): Promise<void>;
  initialize(init: { projectId: string; projectName: string; canonicalRepoName: string; head: string; verificationPolicy: Record<string, unknown>; kind?: "demo" | "import" | "empty"; defaultBranch?: string; ownerId?: string; source?: string }): Promise<FlareGitProjectState>;
  createTask(task: Task): Promise<Task>;
  resolveDecision(decisionId: string, selectedOptionId: string): Promise<{ taskIds: string[] }>;
  getState(): Promise<FlareGitProjectState>;
  claimLanding(req: { holder: string; taskIds: [string, string] }): Promise<ClaimResult>;
  recordVerification(candidateId: string, commit: string, evidence: VerificationEvidence): Promise<void>;
  preparePublish(candidateId: string): Promise<PrepareResult>;
  completePublish(journalId: string): Promise<void>;
  abortPublish(candidateId: string, journalId: string | undefined, reason: string, outcome: "failed" | "stale"): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  getBilling(): Promise<{ plan: "free" | "pro"; status: string; subscriptionId?: string; updatedAt: string }>;
  setBilling(b: { plan: "free" | "pro"; status: string; subscriptionId?: string; updatedAt: string }): Promise<void>;
  usageToday(): Promise<number>;
  consumeRun(limit: number): Promise<{ allowed: boolean; used: number }>;
  ingestCheckpoint(ev: { eventId: string; taskId: string; commit: string; ready: boolean }): Promise<{ applied: boolean }>;
}

const LEASE_MS = 20 * 60_000;

/**
 * Authoritative project state (SQLite-backed). Single writer: every transition — event ingestion,
 * landing lease, publication ledger, decisions — is validated and committed here, so duplicate or
 * late events and concurrent landings cannot corrupt accepted state.
 */
export class RepositoryController extends DurableObject<Env> {
  private state: FlareGitProjectState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS project (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS billing (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (user_id TEXT PRIMARY KEY, role TEXT NOT NULL, label TEXT, added_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY, created_by TEXT NOT NULL, expires_at INTEGER NOT NULL, used_by TEXT);
      CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, type TEXT NOT NULL, summary TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, url TEXT NOT NULL, secret TEXT NOT NULL, events TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, seq INTEGER NOT NULL DEFAULT 0, queue_ms INTEGER, webhook_id TEXT NOT NULL, event TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_status INTEGER, last_error TEXT, latency_ms INTEGER, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, project_name TEXT NOT NULL, kind TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'unread');
      CREATE TABLE IF NOT EXISTS domains (domain TEXT NOT NULL, project_id TEXT NOT NULL, token TEXT NOT NULL, verified_at TEXT, PRIMARY KEY (domain, project_id));
      CREATE TABLE IF NOT EXISTS probes (id INTEGER PRIMARY KEY AUTOINCREMENT, component TEXT NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL, latency_ms INTEGER, detail TEXT);
      CREATE INDEX IF NOT EXISTS probes_component_at ON probes (component, at);
      CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL, last_used TEXT);
      CREATE TABLE IF NOT EXISTS runs (day TEXT PRIMARY KEY, n INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK (id = 1), holder TEXT NOT NULL, expires_at INTEGER NOT NULL);
    `);
    // Databases created before ordered delivery lack these columns.
    for (const col of ["seq INTEGER NOT NULL DEFAULT 0", "queue_ms INTEGER"]) {
      try { this.ctx.storage.sql.exec(`ALTER TABLE deliveries ADD COLUMN ${col}`); } catch { /* already present */ }
    }
    for (const col of ["scope TEXT NOT NULL DEFAULT 'full'", "repo TEXT", "expires_at INTEGER"]) {
      try { this.ctx.storage.sql.exec(`ALTER TABLE api_tokens ADD COLUMN ${col}`); } catch { /* already present */ }
    }
  }

  private load(): FlareGitProjectState {
    if (this.state) return this.state;
    const row = this.ctx.storage.sql.exec<{ doc: string }>("SELECT doc FROM project WHERE id = 1").toArray()[0];
    if (!row) throw new Error("Project not initialized: call initialize() with the seeded canonical head");
    this.state = JSON.parse(row.doc) as FlareGitProjectState;
    return this.state;
  }

  private save(): void {
    this.ctx.storage.sql.exec("INSERT INTO project (id, doc) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc", JSON.stringify(this.state));
  }

  /** First-time setup with the real head of the canonical Artifacts repository. */
  async initialize(init: { projectId: string; projectName: string; canonicalRepoName: string; head: string; verificationPolicy: Record<string, unknown>; kind?: "demo" | "import" | "empty"; defaultBranch?: string; ownerId?: string; source?: string }): Promise<FlareGitProjectState> {
    const existing = this.ctx.storage.sql.exec("SELECT 1 FROM project WHERE id = 1").toArray();
    if (existing.length > 0) return this.load();
    this.state = {
      projectId: init.projectId,
      projectName: init.projectName,
      canonicalRepoName: init.canonicalRepoName,
      acceptedState: { currentCommit: init.head, acceptedAt: new Date().toISOString(), buildDigest: "seed", activeRequirements: [], history: [] },
      tasks: {},
      candidates: {},
      evidence: {},
      decisions: {},
      journal: [],
      policyVersion: 1,
      verificationPolicy: init.verificationPolicy,
      kind: init.kind,
      defaultBranch: init.defaultBranch ?? "main",
      ownerId: init.ownerId,
      source: init.source,
    };
    if (init.ownerId) await this.addMember(init.ownerId, "owner");
    await this.logActivity(init.ownerId ?? "system", "project.created", `Repository ${init.projectName} created`);
    this.save();
    return this.state;
  }

  async getState(): Promise<FlareGitProjectState> {
    return this.load();
  }

  /** Returns false if this event id was already processed (at-least-once delivery safe). */
  private firstDelivery(eventId: string): boolean {
    const res = this.ctx.storage.sql.exec("INSERT OR IGNORE INTO events (id, at) VALUES (?, ?)", eventId, new Date().toISOString());
    return res.rowsWritten > 0;
  }

  async createTask(task: Task): Promise<Task> {
    const s = this.load();
    if (s.tasks[task.id]) return s.tasks[task.id]!;
    s.tasks[task.id] = task;
    this.save();
    await this.logActivity(task.contributor.name, "task.created", `Change started: ${task.goal}`);
    return task;
  }

  async ingestCheckpoint(ev: { eventId: string; taskId: string; commit: string; ready: boolean; filesChanged?: string[] }): Promise<{ applied: boolean }> {
    if (!this.firstDelivery(ev.eventId)) return { applied: false };
    const s = this.load();
    const task = s.tasks[ev.taskId];
    if (!task || task.status === "cancelled" || task.status === "accepted") return { applied: false };
    // A push that arrives while the task is being integrated is newer work; it applies after the landing.
    task.currentCommit = ev.commit;
    task.checkpoints.push({
      id: `chk_${ev.eventId.slice(0, 8)}`,
      commitHash: ev.commit,
      author: task.contributor.name,
      message: ev.ready ? "Ready for integration" : "Work in progress",
      timestamp: new Date().toISOString(),
      isReadyForIntegration: ev.ready,
      filesChanged: ev.filesChanged ?? [],
    });
    if (task.status !== "integrating" && task.status !== "verifying") task.status = ev.ready ? "ready" : "checkpointed";
    task.updatedAt = new Date().toISOString();
    this.save();
    if (ev.ready) await this.emit("change.ready", { change: task.id, commit: ev.commit, goal: task.goal });
    await this.logActivity(task.contributor.name, ev.ready ? "task.ready" : "task.pushed", `${task.id} ${ev.ready ? "is ready for integration" : "pushed a checkpoint"} (${ev.commit.slice(0, 7)})`, { exceptUser: task.contributor.id });
    return { applied: true };
  }

  // ---- account registry (used on the per-account instance) ----
  async listProjects(): Promise<ProjectRow[]> {
    return this.ctx.storage.sql.exec("SELECT id, name, role, kind, created_at FROM projects ORDER BY created_at DESC").toArray() as unknown as ProjectRow[];
  }
  async addProject(p: { id: string; name: string; role: "owner" | "member"; kind: string }): Promise<void> {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO projects (id, name, role, kind, created_at) VALUES (?, ?, ?, ?, ?)", p.id, p.name, p.role, p.kind, new Date().toISOString());
  }
  async removeProject(id: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM projects WHERE id = ?", id);
  }

  // ---- membership and invites (per project) ----
  async roleOf(userId: string): Promise<"owner" | "member" | null> {
    const row = this.ctx.storage.sql.exec<{ role: string }>("SELECT role FROM members WHERE user_id = ?", userId).toArray()[0];
    return (row?.role as "owner" | "member" | undefined) ?? null;
  }
  async addMember(userId: string, role: "owner" | "member", label?: string): Promise<void> {
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO members (user_id, role, label, added_at) VALUES (?, ?, ?, ?)", userId, role, label ?? null, new Date().toISOString());
  }
  async removeMember(userId: string): Promise<void> {
    const role = await this.roleOf(userId);
    if (role === "owner") throw new Error("The owner cannot be removed");
    this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id = ?", userId);
  }
  async listMembers() {
    return this.ctx.storage.sql.exec<{ user_id: string; role: string; label: string | null; added_at: string }>("SELECT user_id, role, label, added_at FROM members ORDER BY added_at").toArray();
  }
  async createInvite(createdBy: string): Promise<string> {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    this.ctx.storage.sql.exec("INSERT INTO invites (token, created_by, expires_at) VALUES (?, ?, ?)", token, createdBy, Date.now() + 7 * 86_400_000);
    return token;
  }
  /** Single-use: the first signed-in user to present a valid token becomes a member. */
  async acceptInvite(token: string, userId: string, label?: string): Promise<boolean> {
    const row = this.ctx.storage.sql.exec<{ expires_at: number; used_by: string | null }>("SELECT expires_at, used_by FROM invites WHERE token = ?", token).toArray()[0];
    if (!row || row.used_by || row.expires_at < Date.now()) return false;
    this.ctx.storage.sql.exec("UPDATE invites SET used_by = ? WHERE token = ?", userId, token);
    if (!(await this.roleOf(userId))) await this.addMember(userId, "member", label);
    await this.logActivity(userId, "member.joined", `${label ?? "A collaborator"} joined the repository`);
    return true;
  }

  // ---- outgoing webhooks: durable outbox, signed delivery through the queue, visible log ----
  async addWebhook(url: string, events: string[]): Promise<{ id: string; secret: string }> {
    const id = `wh_${crypto.randomUUID().slice(0, 8)}`;
    const secret = `whsec_${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))}`;
    const chosen = events.filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
    this.ctx.storage.sql.exec("INSERT INTO webhooks (id, url, secret, events, active, created_at) VALUES (?, ?, ?, ?, 1, ?)", id, url, secret, chosen.join(","), new Date().toISOString());
    return { id, secret };
  }
  async listWebhooks(): Promise<WebhookRow[]> {
    return this.ctx.storage.sql.exec("SELECT id, url, events, active, created_at FROM webhooks ORDER BY created_at").toArray() as unknown as WebhookRow[];
  }
  async removeWebhook(id: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM webhooks WHERE id = ?", id);
  }
  async listDeliveries(limit: number): Promise<DeliveryRow[]> {
    return this.ctx.storage.sql
      .exec("SELECT id, seq, queue_ms, webhook_id, event, status, attempts, last_status, last_error, latency_ms, created_at, updated_at FROM deliveries ORDER BY created_at DESC LIMIT ?", Math.min(limit, 100))
      .toArray() as unknown as DeliveryRow[];
  }
  async getDelivery(id: string) {
    const d = this.ctx.storage.sql.exec("SELECT * FROM deliveries WHERE id = ?", id).toArray()[0] as unknown as (DeliveryRow & { payload: string }) | undefined;
    if (!d) return null;
    const w = this.ctx.storage.sql.exec("SELECT url, secret, active FROM webhooks WHERE id = ?", d.webhook_id).toArray()[0] as unknown as { url: string; secret: string; active: number } | undefined;
    return w ? { delivery: d, webhook: w } : null;
  }
  /** Records an attempt. Returns the attempt count so the consumer can decide whether to back off or give up. */
  async markDelivery(id: string, r: { ok: boolean; status?: number; error?: string; latencyMs?: number; final?: boolean }): Promise<number> {
    const row = this.ctx.storage.sql.exec<{ attempts: number }>("SELECT attempts FROM deliveries WHERE id = ?", id).toArray()[0];
    const attempts = (row?.attempts ?? 0) + 1;
    if (attempts === 1) {
      this.ctx.storage.sql.exec("UPDATE deliveries SET queue_ms = MAX(0, CAST((julianday(?) - julianday(created_at)) * 86400000 AS INTEGER)) WHERE id = ?", new Date().toISOString(), id);
    }
    const status = r.ok ? "success" : r.final ? "failed" : "pending";
    this.ctx.storage.sql.exec(
      "UPDATE deliveries SET status = ?, attempts = ?, last_status = ?, last_error = ?, latency_ms = ?, updated_at = ? WHERE id = ?",
      status, attempts, r.status ?? null, r.error ? r.error.slice(0, 300) : null, r.latencyMs ?? null, new Date().toISOString(), id
    );
    return attempts;
  }
  /** Records the result of re-basing a stacked change onto its parent's new tip. */
  async applyRebase(taskId: string, r: { commit?: string; base?: string; parentAccepted?: boolean; failed?: string }): Promise<void> {
    const s = this.load();
    const task = s.tasks[taskId];
    if (!task) return;
    if (r.failed) {
      task.status = "blocked";
      task.blockedReason = r.failed;
    } else if (r.commit && r.base) {
      task.currentCommit = r.commit;
      task.baseCommit = r.base;
      if (r.parentAccepted) delete task.dependsOn;
      if (task.status === "blocked") { task.status = "working"; delete task.blockedReason; }
    }
    task.updatedAt = new Date().toISOString();
    this.save();
    await this.logActivity("FlareGit", r.failed ? "stack.rebase_blocked" : "stack.rebased", r.failed ? `${taskId}: ${r.failed}` : `${taskId} was rebased onto its updated parent (${r.commit?.slice(0, 7)})`);
  }
  /** True while an earlier event for the same webhook is still pending, so receivers see events in order. */
  async isBlocked(id: string): Promise<boolean> {
    const d = this.ctx.storage.sql.exec<{ webhook_id: string; seq: number }>("SELECT webhook_id, seq FROM deliveries WHERE id = ?", id).toArray()[0];
    if (!d || d.seq === 0) return false;
    return this.ctx.storage.sql.exec("SELECT 1 FROM deliveries WHERE webhook_id = ? AND seq < ? AND status = 'pending' LIMIT 1", d.webhook_id, d.seq).toArray().length > 0;
  }
  async redeliver(id: string): Promise<boolean> {
    const d = this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM deliveries WHERE id = ?", id).toArray()[0];
    if (!d) return false;
    this.ctx.storage.sql.exec("UPDATE deliveries SET status = 'pending', attempts = 0, last_error = NULL, updated_at = ? WHERE id = ?", new Date().toISOString(), id);
    await this.env.INTEGRATION_QUEUE.send({ type: "webhook.deliver", projectId: this.load().projectId, deliveryId: id });
    return true;
  }
  /** Write the event to the outbox (durable) before anything is sent; the queue only carries a pointer. */
  private async emit(type: (typeof WEBHOOK_EVENTS)[number], data: Record<string, unknown>): Promise<void> {
    const hooks = this.ctx.storage.sql.exec("SELECT id, events FROM webhooks WHERE active = 1").toArray() as unknown as Array<{ id: string; events: string }>;
    if (hooks.length === 0) return;
    const s = this.load();
    const eventId = `evt_${crypto.randomUUID().slice(0, 12)}`;
    const payload = JSON.stringify({ id: eventId, type, createdAt: new Date().toISOString(), project: { id: s.projectId, name: s.projectName }, data });
    for (const h of hooks) {
      if (!h.events.split(",").includes(type)) continue;
      const deliveryId = `dlv_${crypto.randomUUID().slice(0, 10)}`;
      const now = new Date().toISOString();
      const seq = (this.ctx.storage.sql.exec<{ n: number }>("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM deliveries WHERE webhook_id = ?", h.id).toArray()[0]?.n ?? 1);
      this.ctx.storage.sql.exec("INSERT INTO deliveries (id, seq, webhook_id, event, status, attempts, payload, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)", deliveryId, seq, h.id, type, payload, now, now);
      await this.env.INTEGRATION_QUEUE.send({ type: "webhook.deliver", projectId: s.projectId, deliveryId }).catch(() => undefined); // row stays 'pending' and is visible/redeliverable
    }
    this.ctx.storage.sql.exec("DELETE FROM deliveries WHERE id IN (SELECT id FROM deliveries ORDER BY created_at DESC LIMIT -1 OFFSET 500)");
  }

  // ---- personal API tokens (stored as SHA-256 hashes; the secret is shown once) ----
  private async sha256(value: string): Promise<string> {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async createApiToken(userId: string, label: string, secret: string, opts: TokenScope = { scope: "full" }): Promise<{ id: string }> {
    this.ctx.storage.sql.exec("DELETE FROM api_tokens WHERE expires_at IS NOT NULL AND expires_at < ?", Date.now());
    const count = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM api_tokens").toArray()[0]?.n ?? 0;
    if (count >= 50) throw new Error("Token limit reached (50). Revoke one first.");
    const id = `tok_${crypto.randomUUID().slice(0, 8)}`;
    this.ctx.storage.sql.exec(
      "INSERT INTO api_tokens (id, hash, user_id, label, created_at, scope, repo, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id, await this.sha256(secret), userId, label.slice(0, 60), new Date().toISOString(), opts.scope, opts.repo ?? null, opts.expiresAt ?? null
    );
    return { id };
  }
  async listApiTokens(): Promise<ApiTokenRow[]> {
    return this.ctx.storage.sql
      .exec("SELECT id, label, created_at, last_used, scope, repo, expires_at FROM api_tokens WHERE expires_at IS NULL OR expires_at > ? ORDER BY created_at DESC", Date.now())
      .toArray() as unknown as ApiTokenRow[];
  }
  async revokeApiToken(id: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM api_tokens WHERE id = ?", id);
  }
  async verifyApiToken(secret: string): Promise<{ userId: string; scope: TokenScope["scope"]; repo: string | null } | null> {
    const row = this.ctx.storage.sql
      .exec<{ id: string; user_id: string; scope: TokenScope["scope"]; repo: string | null; expires_at: number | null }>("SELECT id, user_id, scope, repo, expires_at FROM api_tokens WHERE hash = ?", await this.sha256(secret))
      .toArray()[0];
    if (!row || (row.expires_at !== null && row.expires_at < Date.now())) return null;
    this.ctx.storage.sql.exec("UPDATE api_tokens SET last_used = ? WHERE id = ?", new Date().toISOString(), row.id);
    return { userId: row.user_id, scope: row.scope, repo: row.repo };
  }

  // ---- platform health (used on the global instance) ----
  async recordProbe(component: string, ok: boolean, latencyMs?: number, detail?: string): Promise<void> {
    this.ctx.storage.sql.exec("INSERT INTO probes (component, at, ok, latency_ms, detail) VALUES (?, ?, ?, ?, ?)", component, Date.now(), ok ? 1 : 0, latencyMs ?? null, detail ? detail.slice(0, 200) : null);
    this.ctx.storage.sql.exec("DELETE FROM probes WHERE at < ?", Date.now() - 3 * 86_400_000);
  }
  /** Raw facts per component: was it degraded, how many checks failed, for how long. No averaged uptime percentage. */
  async statusSummary(): Promise<ComponentStatus[]> {
    const since = Date.now() - 86_400_000;
    const rows = this.ctx.storage.sql.exec("SELECT component, at, ok, detail FROM probes WHERE at >= ? ORDER BY at", since).toArray() as unknown as Array<{ component: string; at: number; ok: number; detail: string | null }>;
    const by = new Map<string, typeof rows>();
    for (const r of rows) by.set(r.component, [...(by.get(r.component) ?? []), r]);
    return [...by.entries()].map(([component, list]) => {
      const failures = list.filter((r) => !r.ok);
      let degradedMs = 0;
      for (let i = 0; i < list.length; i++) {
        if (!list[i]!.ok) degradedMs += (list[i + 1]?.at ?? Date.now()) - list[i]!.at;
      }
      const last = list[list.length - 1];
      return {
        component,
        degradedNow: last ? !last.ok : false,
        lastCheckAt: last?.at ?? null,
        checks24h: list.length,
        failed24h: failures.length,
        lastFailureAt: failures[failures.length - 1]?.at ?? null,
        lastFailureDetail: failures[failures.length - 1]?.detail ?? null,
        degradedMinutes24h: Math.round(degradedMs / 60_000),
      };
    });
  }

  // ---- activity feed ----
  async logActivity(actor: string, type: string, summary: string, opts?: { exceptUser?: string }): Promise<void> {
    this.ctx.storage.sql.exec("INSERT INTO activity (at, actor, type, summary) VALUES (?, ?, ?, ?)", new Date().toISOString(), actor, type, summary.slice(0, 300));
    this.ctx.storage.sql.exec("DELETE FROM activity WHERE id <= (SELECT MAX(id) FROM activity) - 500");
    await this.notifyMembers(type, summary, opts?.exceptUser);
  }

  /**
   * Fans an activity out to every member's inbox. Things that need a person (a change to review, a decision,
   * a blocked landing or stack) are "direct"; everything else is repository chatter kept apart from them.
   */
  private async notifyMembers(type: string, summary: string, exceptUser?: string): Promise<void> {
    const DIRECT = new Set(["task.ready", "decision.needed", "integration.blocked", "integration.stale", "stack.rebase_blocked"]);
    const CHATTER = new Set(["integration.accepted", "stack.rebased", "member.joined", "task.created"]);
    if (!DIRECT.has(type) && !CHATTER.has(type)) return;
    const s = this.state ?? (() => { try { return this.load(); } catch { return null; } })();
    if (!s) return;
    const members = this.ctx.storage.sql.exec<{ user_id: string }>("SELECT user_id FROM members").toArray();
    await Promise.all(
      members
        .filter((m) => !exceptUser || !m.user_id.endsWith(exceptUser))
        .map(async (m) => {
          const account = accountOf(this.env, await accountKeyFor(m.user_id));
          await account.addInbox({ projectId: s.projectId, projectName: s.projectName, kind: DIRECT.has(type) ? "direct" : "activity", type, title: summary.slice(0, 200) }).catch(() => undefined);
        })
    );
  }

  // ---- domain ownership (used on the global instance) ----
  /** Anyone may claim a name; a claim confers nothing until DNS proves control. */
  async claimDomain(domain: string, projectId: string): Promise<DomainRow> {
    const existing = (this.ctx.storage.sql.exec("SELECT * FROM domains WHERE domain = ? AND project_id = ?", domain, projectId).toArray()[0] as unknown as DomainRow | undefined);
    if (existing) return existing;
    const token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    this.ctx.storage.sql.exec("INSERT INTO domains (domain, project_id, token, verified_at) VALUES (?, ?, ?, NULL)", domain, projectId, token);
    return { domain, project_id: projectId, token, verified_at: null };
  }
  async domainsFor(projectId: string): Promise<DomainRow[]> {
    return this.ctx.storage.sql.exec("SELECT * FROM domains WHERE project_id = ? ORDER BY domain", projectId).toArray() as unknown as DomainRow[];
  }
  /**
   * Called only after DNS proved control for this project. Control of the DNS zone is the authority, so any other
   * project holding the same verified name loses it at once (an impostor cannot keep a name its owner can reclaim).
   */
  async verifyDomain(domain: string, projectId: string): Promise<{ lostBy: string[] }> {
    const lost = this.ctx.storage.sql.exec<{ project_id: string }>("SELECT project_id FROM domains WHERE domain = ? AND project_id != ? AND verified_at IS NOT NULL", domain, projectId).toArray().map((r) => r.project_id);
    this.ctx.storage.sql.exec("UPDATE domains SET verified_at = NULL WHERE domain = ? AND project_id != ?", domain, projectId);
    this.ctx.storage.sql.exec("UPDATE domains SET verified_at = ? WHERE domain = ? AND project_id = ?", new Date().toISOString(), domain, projectId);
    return { lostBy: lost };
  }
  async releaseDomain(domain: string, projectId: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM domains WHERE domain = ? AND project_id = ?", domain, projectId);
  }

  // ---- notification inbox (used on the account instance) ----
  async addInbox(item: { projectId: string; projectName: string; kind: "direct" | "activity"; type: string; title: string }): Promise<void> {
    // "Snooze until the next push" ends as soon as anything new happens in that repository.
    this.ctx.storage.sql.exec("UPDATE inbox SET state = 'unread' WHERE project_id = ? AND state = 'snoozed'", item.projectId);
    this.ctx.storage.sql.exec("INSERT INTO inbox (project_id, project_name, kind, type, title, created_at) VALUES (?, ?, ?, ?, ?, ?)", item.projectId, item.projectName, item.kind, item.type, item.title, new Date().toISOString());
    this.ctx.storage.sql.exec("DELETE FROM inbox WHERE id <= (SELECT MAX(id) FROM inbox) - 300");
  }
  async listInbox(filter: "direct" | "activity" | "snoozed" | "archived"): Promise<InboxRow[]> {
    const byState = filter === "snoozed" || filter === "archived";
    return this.ctx.storage.sql
      .exec(`SELECT * FROM inbox WHERE ${byState ? "state = ?" : "state = 'unread' AND kind = ?"} ORDER BY id DESC LIMIT 100`, filter)
      .toArray() as unknown as InboxRow[];
  }
  async setInboxState(id: number, state: "unread" | "archived" | "snoozed"): Promise<void> {
    this.ctx.storage.sql.exec("UPDATE inbox SET state = ? WHERE id = ?", state, id);
  }
  async inboxUnread(): Promise<{ direct: number; activity: number }> {
    const rows = this.ctx.storage.sql.exec<{ kind: string; n: number }>("SELECT kind, COUNT(*) AS n FROM inbox WHERE state = 'unread' GROUP BY kind").toArray();
    return { direct: rows.find((r) => r.kind === "direct")?.n ?? 0, activity: rows.find((r) => r.kind === "activity")?.n ?? 0 };
  }
  async listActivity(limit: number): Promise<ActivityRow[]> {
    return this.ctx.storage.sql.exec("SELECT id, at, actor, type, summary FROM activity ORDER BY id DESC LIMIT ?", Math.min(limit, 200)).toArray() as unknown as ActivityRow[];
  }

  async setVerificationPolicy(policy: Record<string, unknown>): Promise<void> {
    const s = this.load();
    s.verificationPolicy = policy;
    s.policyVersion += 1;
    this.save();
    await this.logActivity("owner", "config.updated", "Verification settings changed");
  }

  /** Delete everything this project stores (account deletion / repository deletion). */
  async destroy(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.state = null;
  }

  async getBilling(): Promise<{ plan: "free" | "pro"; status: string; subscriptionId?: string; updatedAt: string }> {
    const row = this.ctx.storage.sql.exec<{ doc: string }>("SELECT doc FROM billing WHERE id = 1").toArray()[0];
    return row ? JSON.parse(row.doc) : { plan: "free", status: "none", updatedAt: new Date(0).toISOString() };
  }

  async setBilling(b: { plan: "free" | "pro"; status: string; subscriptionId?: string; updatedAt: string }): Promise<void> {
    this.ctx.storage.sql.exec("INSERT INTO billing (id, doc) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc", JSON.stringify(b));
  }

  async usageToday(): Promise<number> {
    const day = new Date().toISOString().slice(0, 10);
    return this.ctx.storage.sql.exec<{ n: number }>("SELECT n FROM runs WHERE day = ?", day).toArray()[0]?.n ?? 0;
  }

  /** Spend guard: atomically count a model-backed run against today's per-project allowance. */
  async consumeRun(limit: number): Promise<{ allowed: boolean; used: number }> {
    const day = new Date().toISOString().slice(0, 10);
    const row = this.ctx.storage.sql.exec<{ n: number }>("SELECT n FROM runs WHERE day = ?", day).toArray()[0];
    const used = row?.n ?? 0;
    if (used >= limit) return { allowed: false, used };
    this.ctx.storage.sql.exec("INSERT INTO runs (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1", day);
    return { allowed: true, used: used + 1 };
  }

  async cancelTask(taskId: string): Promise<void> {
    const task = this.load().tasks[taskId];
    if (!task || task.status === "accepted") throw new Error("Cannot cancel");
    task.status = "cancelled";
    this.save();
  }

  /** Acquire the single landing lease and freeze a candidate against the current accepted head. */
  async claimLanding(req: { holder: string; taskIds: [string, string] }): Promise<ClaimResult> {
    const s = this.load();
    const now = Date.now();
    const lease = this.ctx.storage.sql.exec<{ holder: string; expires_at: number }>("SELECT holder, expires_at FROM lease WHERE id = 1").toArray()[0];
    if (lease && lease.expires_at > now && lease.holder !== req.holder) return { reason: "Another landing holds the lease" };

    const tasks = req.taskIds.map((id) => s.tasks[id]);
    if (tasks.some((t) => !t)) return { reason: "Unknown task" };
    const [a, b] = tasks as [Task, Task];
    for (const t of [a, b]) {
      if (t.status === "accepted" || t.status === "cancelled") return { reason: `Task ${t.id} is ${t.status}` };
      if (t.status === "working" || t.status === "checkpointed" || t.status === "needs_decision") return { reason: `Task ${t.id} is not ready` };
    }
    for (const ra of a.requirements.filter((r) => r.status === "approved")) {
      for (const rb of b.requirements.filter((r) => r.status === "approved")) {
        if (!detectContradiction(ra, rb)) continue;
        const decision = createProductDecision(ra, rb);
        s.decisions[decision.id] = decision;
        a.status = b.status = "needs_decision";
        this.save();
        await this.emit("decision.needed", { decision: decision.id, question: decision.question });
        return { decision };
      }
    }
    const candidate = freezeCandidateGeneration({
      tasks: [a, b],
      acceptedBaseCommit: s.acceptedState.currentCommit,
      policyVersion: s.policyVersion,
      verificationPolicy: s.verificationPolicy,
      approvedRequirements: [...s.acceptedState.activeRequirements, ...a.requirements, ...b.requirements].filter((r: Requirement) => r.status === "approved"),
    });
    s.candidates[candidate.id] = candidate;
    a.status = b.status = "integrating";
    a.activeCandidateId = b.activeCandidateId = candidate.id;
    this.ctx.storage.sql.exec("INSERT INTO lease (id, holder, expires_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at", req.holder, now + LEASE_MS);
    this.save();
    return { candidate };
  }

  private releaseLease(): void {
    this.ctx.storage.sql.exec("DELETE FROM lease WHERE id = 1");
  }

  async recordVerification(candidateId: string, commit: string, evidence: VerificationEvidence): Promise<void> {
    const s = this.load();
    const c = s.candidates[candidateId];
    if (!c) throw new Error("Unknown candidate");
    s.evidence[evidence.id] = evidence;
    c.candidateCommit = commit;
    c.evidenceId = evidence.id;
    c.status = evidence.status === "passed" && evidence.candidateCommit === commit ? "verified" : "verifying";
    this.save();
  }

  /** Ledger step 1: validate every invariant, then journal PREPARED. The workflow then pushes with a lease. */
  async preparePublish(candidateId: string): Promise<PrepareResult> {
    const s = this.load();
    const c = s.candidates[candidateId];
    const ev = c?.evidenceId ? s.evidence[c.evidenceId] : undefined;
    if (!c || !ev || !c.candidateCommit) return { ok: false, error: "No verified candidate" };
    if (ev.status !== "passed" || ev.candidateCommit !== c.candidateCommit) return { ok: false, error: "Evidence does not match candidate" };
    if (ev.expectedAcceptedBase !== c.expectedAcceptedBase || ev.requirementsVersion !== c.frozenPolicyVersion) return { ok: false, error: "Evidence was produced for different inputs" };
    const cancelled = c.participatingTaskIds.filter((id) => s.tasks[id]?.status === "cancelled");
    if (cancelled.length > 0) return { ok: false, error: `Task ${cancelled[0]} was cancelled before publication` };
    if (s.acceptedState.currentCommit !== c.expectedAcceptedBase) {
      c.status = "stale";
      this.save();
      return { ok: false, stale: true, error: "Accepted head moved" };
    }
    const journal: PublicationJournalEntry = {
      id: `jrnl_${crypto.randomUUID().slice(0, 8)}`,
      candidateId,
      candidateCommit: c.candidateCommit,
      candidateTree: ev.candidateTree,
      expectedHead: c.expectedAcceptedBase,
      newHead: c.candidateCommit,
      outputDigest: ev.builtOutputDigest,
      state: "PREPARED",
      timestamp: new Date().toISOString(),
    };
    s.journal.push(journal);
    this.save();
    return { ok: true, journal };
  }

  /** Ledger step 2: the Artifacts ref update succeeded (or was found already applied). */
  async completePublish(journalId: string): Promise<void> {
    const s = this.load();
    const j = s.journal.find((e) => e.id === journalId);
    if (!j) throw new Error("Unknown journal entry");
    if (j.state === "ACCEPTED") return; // idempotent
    const c = s.candidates[j.candidateId]!;
    j.state = "ACCEPTED";
    j.timestamp = new Date().toISOString();
    c.status = "accepted";
    s.acceptedState.currentCommit = j.newHead;
    s.acceptedState.buildDigest = j.outputDigest;
    s.acceptedState.acceptedAt = j.timestamp;
    s.acceptedState.history.push({ commit: j.newHead, candidateId: c.id, acceptedAt: j.timestamp, participatingTasks: c.participatingTaskIds, evidenceId: c.evidenceId!, outputDigest: j.outputDigest });
    for (const id of c.participatingTaskIds) {
      const t = s.tasks[id]!;
      t.status = t.currentCommit === c.participatingCommits[id] ? "accepted" : "ready";
      for (const r of t.requirements) if (r.status === "approved" && !s.acceptedState.activeRequirements.some((x) => x.id === r.id)) s.acceptedState.activeRequirements.push(r);
    }
    this.releaseLease();
    this.save();
    await this.emit("change.accepted", { commit: j.newHead, changes: c.participatingTaskIds, tree: j.candidateTree ?? null });
    await this.logActivity("FlareGit", "integration.accepted", `Accepted ${j.newHead.slice(0, 7)} (${c.participatingTaskIds.join(" + ")})`);
  }

  async abortPublish(candidateId: string, journalId: string | undefined, reason: string, outcome: "failed" | "stale"): Promise<void> {
    const s = this.load();
    const c = s.candidates[candidateId];
    if (!c) return;
    const j = journalId ? s.journal.find((e) => e.id === journalId) : undefined;
    if (j && j.state !== "ACCEPTED") Object.assign(j, { state: "ABORTED", error: reason, timestamp: new Date().toISOString() });
    c.status = outcome;
    c.failureBlocker = outcome === "failed" ? reason : undefined;
    for (const id of c.participatingTaskIds) {
      const t = s.tasks[id]!;
      if (t.status === "cancelled") continue;
      t.status = outcome === "stale" ? "ready" : "blocked";
      t.blockedReason = outcome === "failed" ? reason : undefined;
    }
    this.releaseLease();
    this.save();
    if (outcome === "failed") await this.emit("change.blocked", { changes: c.participatingTaskIds, reason: reason.slice(0, 280) });
    await this.logActivity("FlareGit", outcome === "stale" ? "integration.stale" : "integration.blocked", outcome === "stale" ? "Base moved; will recompose" : `Blocked: ${reason}`.slice(0, 280));
  }

  async resolveDecision(decisionId: string, selectedOptionId: string): Promise<{ taskIds: string[] }> {
    const s = this.load();
    const d = s.decisions[decisionId];
    if (!d) throw new Error("Unknown decision");
    if (d.status === "resolved") return { taskIds: [] };
    const [idA, idB] = d.conflictingRequirementIds;
    if (selectedOptionId !== idA && selectedOptionId !== idB) throw new Error("Unknown option");
    d.selectedOptionId = selectedOptionId;
    d.status = "resolved";
    d.resolvedAt = new Date().toISOString();
    const taskIds: string[] = [];
    for (const t of Object.values(s.tasks)) {
      for (const r of t.requirements) {
        if (r.id === (selectedOptionId === idA ? idB : idA)) r.status = "superseded";
        if (r.id === selectedOptionId && r.policyPatch) {
          s.verificationPolicy = { ...s.verificationPolicy, ...r.policyPatch };
          s.policyVersion += 1;
        }
      }
      if (t.status === "needs_decision") {
        t.status = "ready";
        taskIds.push(t.id);
      }
    }
    this.save();
    return { taskIds };
  }
}
