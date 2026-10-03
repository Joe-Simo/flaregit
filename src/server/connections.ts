import { applyExternalCheckReport, freezeExternalChecks, registerExternalCheckRun, type ExternalCheckPolicy, type ExternalCheckState, type FrozenExternalChecks } from "../core/external-checks.js";
import { RepositoryDeployments } from "./deployments.js";
import { integrationCapabilities, type IntegrationCallback, type IntegrationCapability } from "./integration-auth.js";

export interface ConnectionMetadata { id: string; name: string; capabilities: IntegrationCapability[]; active: boolean; createdAt: string }
type ConnectionRow = { id: string; name: string; capabilities: string; active: number; created_at: string }
export type CallbackReceipt = { kind: "applied" | "duplicate"; commentId?: number } | { kind: "rejected"; reason: string };

/** Repository DO-local storage only. Owner authorization and signature verification
 * precede these calls in the Worker. No provider report can register/select a run,
 * change policy, approve review, or write canonical Git history.
 */
export class RepositoryConnections {
  constructor(private readonly storage: DurableObjectStorage, private readonly repositoryId: string) {
    storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, name TEXT NOT NULL, capabilities TEXT NOT NULL, secret TEXT NOT NULL, active INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connection_policy (id INTEGER PRIMARY KEY CHECK(id=1), doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connection_candidates (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connection_receipts (service_id TEXT NOT NULL, event_id TEXT NOT NULL, digest TEXT NOT NULL, comment_id INTEGER, PRIMARY KEY(service_id,event_id));
      CREATE TABLE IF NOT EXISTS connection_reports (candidate_id TEXT NOT NULL, run_id TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY(candidate_id,run_id));
      CREATE TABLE IF NOT EXISTS connection_read_nonces (service_id TEXT NOT NULL, nonce TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(service_id,nonce));
    `);
  }
  private metadata(row: ConnectionRow): ConnectionMetadata { return { id: row.id, name: row.name, capabilities: JSON.parse(row.capabilities) as IntegrationCapability[], active: row.active === 1, createdAt: row.created_at }; }
  create(name: string, capabilities: IntegrationCapability[]) {
    if (typeof name !== "string" || !name.trim() || name.length > 100 || /[\x00-\x1f<>]/.test(name) || !Array.isArray(capabilities) || capabilities.length === 0 || new Set(capabilities).size !== capabilities.length || !capabilities.every((item) => integrationCapabilities.includes(item))) throw new Error("Invalid connection metadata or capabilities");
    return this.storage.transactionSync(() => {
    const total = this.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM connections").toArray()[0]!.count;
    if (total >= 100) throw new Error("Repository connection limit reached");
    const id = `svc_${crypto.randomUUID()}`;
    const secret = [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const createdAt = new Date().toISOString();
    this.storage.sql.exec("INSERT INTO connections VALUES (?, ?, ?, ?, 1, ?)", id, name.trim(), JSON.stringify(capabilities), secret, createdAt);
    return { metadata: { id, name: name.trim(), capabilities, active: true, createdAt }, secret };
    });
  }
  list(): ConnectionMetadata[] { return this.storage.sql.exec<ConnectionRow>("SELECT id,name,capabilities,active,created_at FROM connections ORDER BY created_at,id").toArray().map((row) => this.metadata(row)); }
  revoke(id: string): void { this.storage.sql.exec("UPDATE connections SET active=0 WHERE id=?", id); }
  /** Server-only authentication material; never return this from a browsing endpoint. */
  signingConfig(id: string): { secret: string; capabilities: IntegrationCapability[] } | null {
    const row = this.storage.sql.exec<{ secret: string; capabilities: string }>("SELECT secret,capabilities FROM connections WHERE id=? AND active=1", id).toArray()[0];
    return row ? { secret: row.secret, capabilities: JSON.parse(row.capabilities) as IntegrationCapability[] } : null;
  }
  /** Explicit read capability includes candidate metadata for review-only services.
   * A fresh nonce is required for each retry; no source or credential is released.
   */
  serviceCandidateSnapshot(serviceId: string, candidateId: string, commit: string, nonce: string) {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new Error("Invalid service nonce");
    return this.storage.transactionSync(() => {
      const connection = this.list().find((item) => item.id === serviceId && item.active);
      if (!connection?.capabilities.includes("read-candidate")) throw new Error("Service read capability unavailable");
      const state = this.candidateState(candidateId);
      if (!state || state.frozen.commit !== commit) throw new Error("Frozen candidate unavailable");
      const now = Date.now();
      this.storage.sql.exec("DELETE FROM connection_read_nonces WHERE at < ?", now - 10 * 60_000);
      if (this.storage.sql.exec("SELECT 1 FROM connection_read_nonces WHERE service_id=? AND nonce=?", serviceId, nonce).toArray().length) throw new Error("Service read nonce already used; retry with a new nonce");
      this.storage.sql.exec("INSERT INTO connection_read_nonces VALUES (?,?,?)", serviceId, nonce, now);
      return {
        repositoryId: this.repositoryId, candidateId, commit, tree: state.frozen.tree, policyVersion: state.frozen.policy.version,
        checks: state.frozen.policy.checks.filter((check) => check.providerId === serviceId).map((check) => ({ id: check.id, required: check.required, run: state.runs[state.selectedRuns[check.id] ?? ""] ?? null })),
      };
    });
  }
  policy(): ExternalCheckPolicy { const row = this.storage.sql.exec<{ doc: string }>("SELECT doc FROM connection_policy WHERE id=1").toArray()[0]; return row ? JSON.parse(row.doc) as ExternalCheckPolicy : { version: 1, mode: "augment", checks: [] }; }
  setPolicy(policy: ExternalCheckPolicy): void {
    this.storage.transactionSync(() => {
      const current = this.policy();
      if (policy.version !== current.version + 1) throw new Error("Policy must advance its exact current version");
      const providers = this.list().filter((connection) => connection.active && connection.capabilities.includes("report-check")).map((connection) => connection.id);
      freezeExternalChecks({ repositoryId: this.repositoryId, candidateId: "policy-validation", commit: "a".repeat(40), tree: "b".repeat(40), policy }, providers);
      this.storage.sql.exec("INSERT INTO connection_policy VALUES (1,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc", JSON.stringify(policy));
    });
  }
  candidateState(id: string): ExternalCheckState | null { const row = this.storage.sql.exec<{ doc: string }>("SELECT doc FROM connection_candidates WHERE id=?", id).toArray()[0]; return row ? JSON.parse(row.doc) as ExternalCheckState : null; }
  reports(candidateId: string): Array<{ providerId: string; report: Extract<IntegrationCallback["report"], { type: "check" }> }> {
    return this.storage.sql.exec<{ doc: string }>("SELECT doc FROM connection_reports WHERE candidate_id=? ORDER BY run_id", candidateId).toArray().map((row) => JSON.parse(row.doc) as { providerId: string; report: Extract<IntegrationCallback["report"], { type: "check" }> });
  }
  freeze(frozen: FrozenExternalChecks): ExternalCheckState {
    return this.storage.transactionSync(() => {
      if (frozen.repositoryId !== this.repositoryId) throw new Error("Candidate belongs to another repository");
      const existing = this.candidateState(frozen.candidateId);
      if (existing) { if (JSON.stringify(existing.frozen) !== JSON.stringify(frozen)) throw new Error("Frozen candidate identity cannot change"); return existing; }
      const providers = this.list().filter((connection) => connection.active && connection.capabilities.includes("report-check")).map((connection) => connection.id);
      // The repository controller supplies its policy snapshot captured atomically
      // when claiming the candidate. Later settings changes cannot rewrite it.
      const state = freezeExternalChecks(frozen, providers);
      this.storage.sql.exec("INSERT INTO connection_candidates VALUES (?,?)", frozen.candidateId, JSON.stringify(state));
      return state;
    });
  }
  registerRun(candidateId: string, checkId: string, runId: string): ExternalCheckState {
    return this.storage.transactionSync(() => {
      const state = this.candidateState(candidateId);
      if (!state) throw new Error("Candidate is not frozen");
      const next = registerExternalCheckRun(state, checkId, runId);
      this.storage.sql.exec("UPDATE connection_candidates SET doc=? WHERE id=?", JSON.stringify(next), candidateId);
      return next;
    });
  }
  async accept(callback: IntegrationCallback, authorize?: () => Promise<boolean>): Promise<CallbackReceipt> {
    // Freshly signed retries can change timestamp; dedup binds the stable event's contents.
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ repositoryId: callback.repositoryId, serviceId: callback.serviceId, eventId: callback.eventId, report: callback.report })));
    const digest = [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const eventHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([callback.serviceId, callback.eventId])));
    const scopedEventId = [...new Uint8Array(eventHash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    // Perform the repository/account fence after asynchronous hashing, directly
    // before committing a receipt or report. Denial consumes no event identity.
    if (authorize && !await authorize()) return { kind: "rejected", reason: "Repository service authority unavailable" };
    return this.storage.transactionSync((): CallbackReceipt => {
      if (callback.repositoryId !== this.repositoryId) return { kind: "rejected", reason: "Repository mismatch" };
      const connection = this.list().find((item) => item.id === callback.serviceId && item.active);
      const capability = callback.report.type === "check" ? "report-check" : callback.report.type === "deployment" ? "report-deployment" : "comment";
      if (!connection?.capabilities.includes(capability)) return { kind: "rejected", reason: "Connection unavailable or capability denied" };
      const previous = this.storage.sql.exec<{ digest: string; comment_id: number | null }>("SELECT digest,comment_id FROM connection_receipts WHERE service_id=? AND event_id=?", callback.serviceId, callback.eventId).toArray()[0];
      if (previous) return previous.digest === digest ? { kind: "duplicate", ...(previous.comment_id === null ? {} : { commentId: previous.comment_id }) } : { kind: "rejected", reason: "Event identity reused with different contents" };
      if (callback.report.type === "deployment") {
        const result = new RepositoryDeployments(this.storage,this.repositoryId).apply({...callback.report,eventId:callback.eventId},connection.id);
        if(result.kind==="rejected")return result;
        this.storage.sql.exec("INSERT INTO connection_receipts VALUES (?,?,?,NULL)", callback.serviceId,callback.eventId,digest);
        return {kind:result.kind};
      }
      const state = this.candidateState(callback.report.candidateId);
      if (!state || state.frozen.commit !== callback.report.commit) return { kind: "rejected", reason: "Report does not match frozen candidate" };
      let commentId: number | undefined;
      if (callback.report.type === "check") {
        const { type: _type, summary: _summary, detailsUrl: _url, ...report } = callback.report;
        const result = applyExternalCheckReport(state, { ...report, repositoryId: this.repositoryId, providerId: connection.id, eventId: scopedEventId }, connection.id);
        if (result.kind === "rejected") return { kind: "rejected", reason: result.reason };
        this.storage.sql.exec("UPDATE connection_candidates SET doc=? WHERE id=?", JSON.stringify(result.state), callback.report.candidateId);
        this.storage.sql.exec("INSERT INTO connection_reports VALUES (?,?,?) ON CONFLICT(candidate_id,run_id) DO UPDATE SET doc=excluded.doc", callback.report.candidateId, callback.report.runId, JSON.stringify({ providerId: connection.id, report: callback.report }));
      } else {
        const report = callback.report;
        this.storage.sql.exec('INSERT INTO comments (subject,author,body,path,line,"commit",created_at) VALUES (?,?,?,?,?,?,?)', `candidate:${report.candidateId}`, `[integration:${connection.id}] ${connection.name}`, report.body, report.path ?? null, report.line ?? null, report.commit, new Date().toISOString());
        commentId = this.storage.sql.exec<{ id: number }>("SELECT last_insert_rowid() AS id").toArray()[0]!.id;
      }
      this.storage.sql.exec("INSERT INTO connection_receipts VALUES (?,?,?,?)", callback.serviceId, callback.eventId, digest, commentId ?? null);
      return { kind: "applied", ...(commentId === undefined ? {} : { commentId }) };
    });
  }
}
