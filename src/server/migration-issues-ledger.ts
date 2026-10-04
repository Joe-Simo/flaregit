import { z } from "zod";

const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const nodeId = z.string().min(1).max(256).regex(/^[A-Za-z0-9_+=\/-]+$/);
const providerId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const sourceUrl = z.string().max(2048).url().refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "github.com" && !url.port && !url.username && !url.password && !url.search && !url.hash;
}, "Credential-free GitHub origin required");
const timestamp = z.string().datetime({ offset: true });
const scopeSchema = z.object({ operationId: identifier, projectId: z.string().regex(/^[a-z0-9]{12,16}$/), incarnation: z.string().uuid(), ownerId: z.string().min(1).max(256), provider: z.literal("github"), repositoryId: providerId, repositoryNodeId: nodeId, sourceUrl }).strict();
const issueSchema = z.object({ providerId, nodeId, number: z.number().int().positive().safe(), kind: z.enum(["issue", "pull_request"]), sourceUrl, actor: z.object({ providerId: providerId.nullable(), login: z.string().min(1).max(100), displayName: z.string().max(200).nullable() }).strict(), title: z.string().min(1).max(1024), body: z.string().max(65536), state: z.enum(["open", "closed"]), createdAt: timestamp, updatedAt: timestamp, closedAt: timestamp.nullable() }).strict();
const commentSchema = z.object({ providerId, nodeId, issueNumber: z.number().int().positive().safe(), repositoryId: providerId, repositoryNodeId: nodeId, sourceUrl: z.string().max(2048).url(), actor: issueSchema.shape.actor, body: z.string().max(65536), bodyHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: timestamp, updatedAt: timestamp, identity: z.literal("external-unclaimed"), nativeUserId: z.null() }).strict();
const missingSchema = z.object({ sourceId: z.string().min(1).max(200), kind: z.enum(["issue", "pull_request", "comment", "unsupported"]), reason: z.string().min(1).max(500) }).strict();
const pageSchema = z.object({ pageId: identifier, expectedRevision: z.number().int().nonnegative().safe(), cursor: z.string().max(1000).nullable(), nextCursor: z.string().min(1).max(1000).nullable(), records: z.array(issueSchema).max(100), comments: z.array(commentSchema).max(100).default([]), missing: z.array(missingSchema).max(100), observedAt: timestamp }).strict();
export type MigrationIssueScope = z.infer<typeof scopeSchema>;
export type MigrationExternalIssue = z.infer<typeof issueSchema>;
export type MigrationExternalComment = z.infer<typeof commentSchema>;
export interface MigrationCommentOrigin extends MigrationExternalComment { sourceActor?: MigrationExternalIssue["actor"]; parentIssueId: string; parentIssueNodeId: string; parentKind: MigrationExternalIssue["kind"] }
export type MigrationIssuePage = z.infer<typeof pageSchema>;
export interface MigrationIssueAuthority {
  authorize(scope: MigrationIssueScope): Promise<void>;
  /** Recheck the same owner/incarnation fence synchronously inside the commit. */
  assertCurrent(scope: MigrationIssueScope): void;
}
export interface MigrationIssueSnapshot {
  scope: MigrationIssueScope; status: "pending" | "complete" | "incomplete"; revision: number; cursor: string | null;
  issues: number; pullRequests: number; comments: number; missing: number; capturedPages: number;
  scopeOfCompletion: "supplied-issues-and-issue-comments-pagination-only"; published: false;
}
export interface MigrationIssueOrigin extends MigrationExternalIssue {
  repositoryId: string; repositoryNodeId: string; bodyHash: string; sourceActor?: MigrationExternalIssue["actor"];
  identity: "external-unclaimed"; nativeUserId: null;
}
export interface MigrationConversationManifest {
  hash: string; revision: number; scope: MigrationIssueScope; status: MigrationIssueSnapshot["status"];
  counts: { issues: number; pullRequests: number; comments: number; missing: number };
  scopeOfCompletion: MigrationIssueSnapshot["scopeOfCompletion"];
  excluded: readonly ["inline-review-comments", "timelines", "discussions", "reactions", "attachments"];
  atomicSourceSnapshot: false; published: false;
}
async function digest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
/** GitHub issue endpoints also include pull requests. Do not import them as issues. */
export function classifyGithubIssue(value: { pull_request?: unknown }): MigrationExternalIssue["kind"] {
  return value.pull_request && typeof value.pull_request === "object" ? "pull_request" : "issue";
}

/** Staging only: no native issue/user mutation, provider fetch or token storage.
 * Receipts prove captured supplied pages, not provider exhaustiveness or publication.
 */
export class MigrationIssuesLedger {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS migration_issue_operations(id TEXT PRIMARY KEY,scope TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL,cursor TEXT); CREATE TABLE IF NOT EXISTS migration_issue_origins(op TEXT NOT NULL,provider_id TEXT NOT NULL,node_id TEXT NOT NULL,number INTEGER NOT NULL,kind TEXT NOT NULL,doc TEXT NOT NULL,PRIMARY KEY(op,provider_id),UNIQUE(op,node_id),UNIQUE(op,number)); CREATE TABLE IF NOT EXISTS migration_comment_origins(op TEXT NOT NULL,provider_id TEXT NOT NULL,node_id TEXT NOT NULL,issue_provider_id TEXT NOT NULL,doc TEXT NOT NULL,PRIMARY KEY(op,provider_id),UNIQUE(op,node_id)); CREATE TABLE IF NOT EXISTS migration_issue_manifests(op TEXT NOT NULL,hash TEXT NOT NULL,revision INTEGER NOT NULL,doc TEXT NOT NULL,PRIMARY KEY(op,hash)); CREATE TABLE IF NOT EXISTS migration_issue_pages(op TEXT NOT NULL,page_id TEXT NOT NULL,payload_hash TEXT NOT NULL,cursor TEXT,observed_at TEXT NOT NULL,PRIMARY KEY(op,page_id)); CREATE TABLE IF NOT EXISTS migration_issue_missing(op TEXT NOT NULL,kind TEXT NOT NULL,source_id TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(op,kind,source_id));`);
  }
  get(id: string): MigrationIssueSnapshot | null {
    identifier.parse(id);
    const row = this.storage.sql.exec<{scope:string;status:MigrationIssueSnapshot["status"];revision:number;cursor:string|null}>("SELECT scope,status,revision,cursor FROM migration_issue_operations WHERE id=?", id).toArray()[0];
    if (!row) return null;
    const count = (query: string) => this.storage.sql.exec<{n:number}>(query, id).one().n;
    return { scope: JSON.parse(row.scope) as MigrationIssueScope, status: row.status, revision: row.revision, cursor: row.cursor, issues: count("SELECT COUNT(*) AS n FROM migration_issue_origins WHERE op=? AND kind='issue'"), pullRequests: count("SELECT COUNT(*) AS n FROM migration_issue_origins WHERE op=? AND kind='pull_request'"), comments: count("SELECT COUNT(*) AS n FROM migration_comment_origins WHERE op=?"), missing: count("SELECT COUNT(*) AS n FROM migration_issue_missing WHERE op=?"), capturedPages: count("SELECT COUNT(*) AS n FROM migration_issue_pages WHERE op=?"), scopeOfCompletion: "supplied-issues-and-issue-comments-pagination-only", published: false };
  }
  async begin(input: MigrationIssueScope, authority: MigrationIssueAuthority): Promise<MigrationIssueSnapshot> {
    const scope = scopeSchema.parse(input);
    const path = new URL(scope.sourceUrl).pathname;
    if (!/^\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+\/?$/.test(path)) throw new Error("Exact source repository URL required");
    await authority.authorize(scope);
    return this.storage.transactionSync(() => {
      authority.assertCurrent(scope);
      const previous = this.get(scope.operationId);
      if (previous) { if (JSON.stringify(previous.scope) !== JSON.stringify(scope)) throw new Error("Migration scope changed"); return previous; }
      if (this.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM migration_issue_operations").one().n >= 32) throw new Error("Migration operation capacity reached");
      this.storage.sql.exec("INSERT INTO migration_issue_operations VALUES(?,?,'pending',0,NULL)", scope.operationId, JSON.stringify(scope));
      return this.get(scope.operationId)!;
    });
  }
  async capture(id: string, input: MigrationIssuePage, authority: MigrationIssueAuthority): Promise<{ kind: "applied" | "duplicate"; snapshot: MigrationIssueSnapshot }> {
    const page = pageSchema.parse(input), previous = this.get(id);
    if (!previous) throw new Error("Saved migration required");
    if (new Set(page.records.map(record => record.providerId)).size !== page.records.length || new Set(page.records.map(record => record.nodeId)).size !== page.records.length || new Set(page.records.map(record => record.number)).size !== page.records.length) throw new Error("Duplicate source identities in page");
    if (new Set(page.comments.map(record => record.providerId)).size !== page.comments.length || new Set(page.comments.map(record => record.nodeId)).size !== page.comments.length) throw new Error("Duplicate comment identities in page");
    if (page.nextCursor !== null && page.nextCursor === page.cursor) throw new Error("Pagination did not advance");
    const base = new URL(previous.scope.sourceUrl).pathname.replace(/\/$/, "");
    for (const record of page.records) {
      const expected = `${base}/${record.kind === "issue" ? "issues" : "pull"}/${record.number}`;
      if (new URL(record.sourceUrl).pathname !== expected || Date.parse(record.updatedAt) < Date.parse(record.createdAt) || (record.closedAt !== null && Date.parse(record.closedAt) < Date.parse(record.createdAt))) throw new Error("Source issue origin differs");
      if (new TextEncoder().encode(record.body).length > 65536) throw new Error("Issue body capacity reached");
    }
    const { observedAt: _observedAt, ...semanticPage } = page;
    const payloadHash = await digest(JSON.stringify(semanticPage));
    const records: MigrationIssueOrigin[] = await Promise.all(page.records.map(async record => ({ ...record, repositoryId: previous.scope.repositoryId, repositoryNodeId: previous.scope.repositoryNodeId, bodyHash: await digest(record.body), identity: "external-unclaimed" as const, nativeUserId: null })));
    for (const comment of page.comments) {
      if (comment.repositoryId !== previous.scope.repositoryId || comment.repositoryNodeId !== previous.scope.repositoryNodeId || Date.parse(comment.updatedAt) < Date.parse(comment.createdAt) || new TextEncoder().encode(comment.body).length > 65536 || await digest(comment.body) !== comment.bodyHash) throw new Error("Comment origin or body hash differs");
    }
    await authority.authorize(previous.scope);
    return this.storage.transactionSync(() => {
      authority.assertCurrent(previous.scope);
      const current = this.get(id);
      if (!current || JSON.stringify(current.scope) !== JSON.stringify(previous.scope)) throw new Error("Migration scope changed");
      const receipt = this.storage.sql.exec<{payload_hash:string}>("SELECT payload_hash FROM migration_issue_pages WHERE op=? AND page_id=?", id, page.pageId).toArray()[0];
      if (receipt) { if (receipt.payload_hash !== payloadHash) throw new Error("Replayed page content changed"); return { kind: "duplicate" as const, snapshot: current }; }
      if (current.status !== "pending" || current.revision !== page.expectedRevision || current.cursor !== page.cursor) throw new Error("Saved migration cursor changed");
      if (current.capturedPages >= 1000) throw new Error("Migration capture capacity reached");
      if (page.nextCursor !== null && this.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM migration_issue_pages WHERE op=? AND cursor=?", id, page.nextCursor).one().n) throw new Error("Pagination cursor was already captured");
      for (const record of records) {
        const old = this.storage.sql.exec<{node_id:string;number:number;kind:string;doc:string}>("SELECT node_id,number,kind,doc FROM migration_issue_origins WHERE op=? AND provider_id=?", id, record.providerId).toArray()[0];
        if (old && (old.node_id !== record.nodeId || old.number !== record.number || old.kind !== record.kind)) throw new Error("External issue identity changed");
        if (old) {
          const original = JSON.parse(old.doc) as MigrationIssueOrigin;
          if (original.createdAt !== record.createdAt || (record.actor.providerId !== null && record.actor.providerId !== original.actor.providerId)) throw new Error("Immutable external issue author or creation changed");
          record.sourceActor = record.actor; record.actor = original.actor;
        }
        if (old && Date.parse((JSON.parse(old.doc) as MigrationIssueOrigin).updatedAt) > Date.parse(record.updatedAt)) throw new Error("External issue update is stale");
        this.storage.sql.exec("INSERT INTO migration_issue_origins VALUES(?,?,?,?,?,?) ON CONFLICT(op,provider_id) DO UPDATE SET doc=excluded.doc", id, record.providerId, record.nodeId, record.number, record.kind, JSON.stringify(record));
      }
      for (const comment of page.comments) {
        const parentRow = this.storage.sql.exec<{doc:string}>("SELECT doc FROM migration_issue_origins WHERE op=? AND number=?", id, comment.issueNumber).toArray()[0];
        if (!parentRow) throw new Error("Staged comment parent unavailable");
        const parent = JSON.parse(parentRow.doc) as MigrationIssueOrigin, url = new URL(comment.sourceUrl);
        if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.pathname !== `${base}/${parent.kind === "issue" ? "issues" : "pull"}/${parent.number}` || url.hash !== `#issuecomment-${comment.providerId}`) throw new Error("Comment parent origin differs");
        const origin: MigrationCommentOrigin = { ...comment, parentIssueId: parent.providerId, parentIssueNodeId: parent.nodeId, parentKind: parent.kind };
        const old = this.storage.sql.exec<{doc:string}>("SELECT doc FROM migration_comment_origins WHERE op=? AND provider_id=?", id, comment.providerId).toArray()[0];
        if (old) {
          const oldOrigin = JSON.parse(old.doc) as MigrationCommentOrigin;
          if (oldOrigin.nodeId !== origin.nodeId || oldOrigin.parentIssueId !== origin.parentIssueId || oldOrigin.parentIssueNodeId !== origin.parentIssueNodeId) throw new Error("External comment identity changed");
          if (oldOrigin.createdAt !== origin.createdAt || (origin.actor.providerId !== null && origin.actor.providerId !== oldOrigin.actor.providerId)) throw new Error("Immutable external comment author or creation changed");
          origin.sourceActor = origin.actor; origin.actor = oldOrigin.actor;
          if (Date.parse(oldOrigin.updatedAt) > Date.parse(origin.updatedAt)) throw new Error("External comment update is stale");
        }
        this.storage.sql.exec("INSERT INTO migration_comment_origins VALUES(?,?,?,?,?) ON CONFLICT(op,provider_id) DO UPDATE SET doc=excluded.doc", id, origin.providerId, origin.nodeId, origin.parentIssueId, JSON.stringify(origin));
      }
      for (const missing of page.missing) this.storage.sql.exec("INSERT INTO migration_issue_missing VALUES(?,?,?,?) ON CONFLICT(op,kind,source_id) DO UPDATE SET reason=excluded.reason", id, missing.kind, missing.sourceId, missing.reason);
      const bytes = this.storage.sql.exec<{n:number}>("SELECT COALESCE(SUM(length(CAST(doc AS BLOB))),0) AS n FROM migration_issue_origins WHERE op=?", id).one().n;
      const commentBytes = this.storage.sql.exec<{n:number}>("SELECT COALESCE(SUM(length(CAST(doc AS BLOB))),0) AS n FROM migration_comment_origins WHERE op=?", id).one().n;
      const counts = this.get(id)!;
      const missingBytes = this.storage.sql.exec<{n:number}>("SELECT COALESCE(SUM(length(CAST(reason AS BLOB))),0) AS n FROM migration_issue_missing WHERE op=?", id).one().n;
      if (counts.issues + counts.pullRequests + counts.comments > 25000 || counts.missing > 25000) throw new Error("Migration capture capacity reached");
      if (bytes + commentBytes + missingBytes > 8 * 1024 * 1024) throw new Error("Migration capture byte capacity reached");
      this.storage.sql.exec("INSERT INTO migration_issue_pages VALUES(?,?,?,?,?)", id, page.pageId, payloadHash, page.cursor, page.observedAt);
      const missing = this.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM migration_issue_missing WHERE op=?", id).one().n;
      const status = page.nextCursor === null ? missing ? "incomplete" : "complete" : "pending";
      this.storage.sql.exec("UPDATE migration_issue_operations SET status=?,revision=revision+1,cursor=? WHERE id=?", status, page.nextCursor, id);
      return { kind: "applied" as const, snapshot: this.get(id)! };
    });
  }
  async manifest(id: string, authority: MigrationIssueAuthority): Promise<MigrationConversationManifest> {
    const snapshot = this.get(id); if (!snapshot) throw new Error("Saved migration required");
    await authority.authorize(snapshot.scope);
    const frozen = this.storage.transactionSync(() => {
      authority.assertCurrent(snapshot.scope);
      const current = this.get(id)!;
      if (JSON.stringify(current) !== JSON.stringify(snapshot)) throw new Error("Migration changed before manifest capture");
      const documents = (table: "migration_issue_origins" | "migration_comment_origins") => this.storage.sql.exec<{doc:string}>(`SELECT doc FROM ${table} WHERE op=? ORDER BY length(provider_id),provider_id`, id).toArray().map(row => row.doc);
      const missing = this.storage.sql.exec<{kind:string;source_id:string;reason:string}>("SELECT kind,source_id,reason FROM migration_issue_missing WHERE op=? ORDER BY kind,source_id", id).toArray();
      return { snapshot: current, documents: { issues: documents("migration_issue_origins"), comments: documents("migration_comment_origins"), missing } };
    });
    const hash = await digest(JSON.stringify(frozen));
    const manifest: MigrationConversationManifest = { hash, revision: snapshot.revision, scope: snapshot.scope, status: snapshot.status, counts: { issues: snapshot.issues, pullRequests: snapshot.pullRequests, comments: snapshot.comments, missing: snapshot.missing }, scopeOfCompletion: snapshot.scopeOfCompletion, excluded: ["inline-review-comments", "timelines", "discussions", "reactions", "attachments"], atomicSourceSnapshot: false, published: false };
    await authority.authorize(snapshot.scope);
    return this.storage.transactionSync(() => {
      authority.assertCurrent(snapshot.scope);
      if (JSON.stringify(this.get(id)) !== JSON.stringify(snapshot)) throw new Error("Migration changed while hashing manifest");
      this.storage.sql.exec("INSERT OR IGNORE INTO migration_issue_manifests VALUES(?,?,?,?)", id, hash, manifest.revision, JSON.stringify(manifest));
      return manifest;
    });
  }
  comments(id: string, after = "0", limit = 50): MigrationCommentOrigin[] {
    identifier.parse(id); z.string().regex(/^(0|[1-9][0-9]{0,19})$/).parse(after); z.number().int().min(1).max(100).parse(limit);
    return this.storage.sql.exec<{doc:string}>("SELECT doc FROM migration_comment_origins WHERE op=? AND (length(provider_id)>length(?) OR (length(provider_id)=length(?) AND provider_id>?)) ORDER BY length(provider_id),provider_id LIMIT ?", id, after, after, after, limit).toArray().map(row => JSON.parse(row.doc) as MigrationCommentOrigin);
  }
  receipt(id: string, pageId: string): { contentHash: string; observedAt: string } | null {
    identifier.parse(id); identifier.parse(pageId);
    return this.storage.sql.exec<{contentHash:string;observedAt:string}>("SELECT payload_hash AS contentHash,observed_at AS observedAt FROM migration_issue_pages WHERE op=? AND page_id=?", id, pageId).toArray()[0] ?? null;
  }
  missing(id: string, limit = 50): z.infer<typeof missingSchema>[] {
    identifier.parse(id); z.number().int().min(1).max(100).parse(limit);
    return this.storage.sql.exec<{sourceId:string;kind:z.infer<typeof missingSchema>["kind"];reason:string}>("SELECT source_id AS sourceId,kind,reason FROM migration_issue_missing WHERE op=? ORDER BY kind,source_id LIMIT ?", id, limit).toArray();
  }
  origins(id: string, after = "0", limit = 50): MigrationIssueOrigin[] {
    identifier.parse(id); z.string().regex(/^(0|[1-9][0-9]{0,19})$/).parse(after); z.number().int().min(1).max(100).parse(limit);
    // Numeric IDs remain decimal strings; order by length then lexical value avoids precision loss.
    return this.storage.sql.exec<{doc:string}>("SELECT doc FROM migration_issue_origins WHERE op=? AND (length(provider_id)>length(?) OR (length(provider_id)=length(?) AND provider_id>?)) ORDER BY length(provider_id),provider_id LIMIT ?", id, after, after, after, limit).toArray().map(row => JSON.parse(row.doc) as MigrationIssueOrigin);
  }
}
