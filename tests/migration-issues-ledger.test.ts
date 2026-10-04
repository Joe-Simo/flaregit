import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readGithubMigrationSlice, migrationPageFromGithubCapture } from "../src/server/github-migration-reader";
import { MigrationIssuesLedger, classifyGithubIssue, type MigrationIssueScope, type MigrationIssuePage, type MigrationIssueAuthority, type MigrationExternalIssue } from "../src/server/migration-issues-ledger";

const scope: MigrationIssueScope = { operationId: "migration-issues-owned", projectId: "p123456789abc", incarnation: "11111111-1111-4111-8111-111111111111", ownerId: "signed-owner", provider: "github", repositoryId: "123456", repositoryNodeId: "MDEwOlJlcG9zaXRvcnkxMjM0NTY=", sourceUrl: "https://github.com/synthetic/owned" };
const issue: MigrationExternalIssue = { providerId: "90071992547409930", nodeId: "I_123", number: 1, kind: "issue", sourceUrl: `${scope.sourceUrl}/issues/1`, actor: { providerId: "654321", login: "external-author", displayName: "External Person" }, title: "Preserve the conversation", body: "Original source body", state: "open", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", closedAt: null };
const page = (input: Partial<MigrationIssuePage> = {}): MigrationIssuePage => ({ pageId: "page1", expectedRevision: 0, cursor: null, nextCursor: "page2", records: [issue], comments: [], missing: [], observedAt: "2026-10-04T00:00:00Z", ...input });
function storage(db: Database): DurableObjectStorage {
  return { sql: { exec(query: string, ...bindings: Array<string | number | null>) {
    if (query.includes("CREATE TABLE")) { db.exec(query); return { toArray: () => [] }; }
    const values = db.query(query).all(...bindings);
    return { toArray: () => values, one: () => { if (values.length !== 1) throw new Error("One SQL row required"); return values[0]; } };
  } }, transactionSync<T>(fn: () => T): T { return db.transaction(fn)(); } } as unknown as DurableObjectStorage;
}
const authority: MigrationIssueAuthority = { authorize: async current => { expect(current.ownerId).toBe(scope.ownerId); }, assertCurrent: current => { expect(current.incarnation).toBe(scope.incarnation); } };

test("real SQLite reopen preserves page receipts, external attribution and exact decimal IDs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flaregit-migration-issues-")), path = join(directory, "ledger.sqlite");
  let db = new Database(path), ledger = new MigrationIssuesLedger(storage(db));
  try {
    await ledger.begin(scope, authority);
    expect((await ledger.capture(scope.operationId, page(), authority)).snapshot.status).toBe("pending");
    db.close(); db = new Database(path); ledger = new MigrationIssuesLedger(storage(db));
    expect((await ledger.capture(scope.operationId, page({ observedAt: "2026-10-04T01:00:00Z" }), authority)).kind).toBe("duplicate");
    expect(ledger.receipt(scope.operationId, "page1")?.observedAt).toBe("2026-10-04T00:00:00Z");
    expect(ledger.get(scope.operationId)?.revision).toBe(1);
    const original = ledger.origins(scope.operationId)[0]!;
    expect(original.providerId).toBe(issue.providerId); expect(original.repositoryId).toBe(scope.repositoryId); expect(original.repositoryNodeId).toBe(scope.repositoryNodeId);
    expect(original.actor).toEqual(issue.actor); expect(original.createdAt).toBe(issue.createdAt); expect(original.body).toBe(issue.body); expect(original.bodyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(original.identity).toBe("external-unclaimed"); expect(original.nativeUserId).toBeNull();
    const pr = { ...issue, providerId: "2", nodeId: "PR_2", number: 2, kind: classifyGithubIssue({ pull_request: { url: "https://api.github.com/synthetic" } }), sourceUrl: `${scope.sourceUrl}/pull/2` };
    const finished = await ledger.capture(scope.operationId, page({ pageId: "page2", expectedRevision: 1, cursor: "page2", nextCursor: null, records: [pr] }), authority);
    expect(finished.snapshot).toMatchObject({ status: "complete", issues: 1, pullRequests: 1, capturedPages: 2, published: false, scopeOfCompletion: "supplied-issues-and-issue-comments-pagination-only" });
    expect(ledger.origins(scope.operationId).map(record => record.providerId)).toEqual(["2", issue.providerId]);
  } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
});

test("changed replay, stale cursor, source identity and revoked owner do not advance durable state", async () => {
  const db = new Database(":memory:"), ledger = new MigrationIssuesLedger(storage(db));
  try {
    await ledger.begin(scope, authority); await ledger.capture(scope.operationId, page(), authority);
    const before = ledger.get(scope.operationId);
    await expect(ledger.capture(scope.operationId, page({ records: [{ ...issue, body: "Changed replay" }] }), authority)).rejects.toThrow("Replayed page content changed");
    await expect(ledger.capture(scope.operationId, page({ pageId: "other" }), authority)).rejects.toThrow("cursor changed");
    await expect(ledger.capture(scope.operationId, page({ pageId: "page2", expectedRevision: 1, cursor: "page2", nextCursor: null }), { authorize: async () => {}, assertCurrent: () => { throw new Error("Owner revoked during await"); } })).rejects.toThrow("Owner revoked");
    await expect(ledger.begin({ ...scope, repositoryId: "999" }, authority)).rejects.toThrow("scope changed");
    expect(ledger.get(scope.operationId)).toEqual(before);
  } finally { db.close(); }
});

test("explicit missing records stay incomplete and paginated upserts retain one origin", async () => {
  const db = new Database(":memory:"), ledger = new MigrationIssuesLedger(storage(db));
  try {
    await ledger.begin(scope, authority); await ledger.capture(scope.operationId, page(), authority);
    const result = await ledger.capture(scope.operationId, page({ pageId: "page2", expectedRevision: 1, cursor: "page2", nextCursor: null, records: [{ ...issue, body: "Updated source body", updatedAt: "2026-10-03T00:00:00Z" }], missing: [{ sourceId: "comment-deleted", kind: "comment", reason: "Provider reported inaccessible comment" }] }), authority);
    expect(result.snapshot).toMatchObject({ issues: 1, missing: 1, status: "incomplete", published: false });
    expect(ledger.origins(scope.operationId)[0]?.body).toBe("Updated source body");
    expect(ledger.missing(scope.operationId)).toEqual([{ sourceId: "comment-deleted", kind: "comment", reason: "Provider reported inaccessible comment" }]);
    expect(classifyGithubIssue({})).toBe("issue");
  } finally { db.close(); }
});

test("malformed cross-repository origins, duplicate identities and nonadvancing pages are refused", async () => {
  const db = new Database(":memory:"), ledger = new MigrationIssuesLedger(storage(db));
  try {
    await ledger.begin(scope, authority);
    await expect(ledger.capture(scope.operationId, page({ records: [{ ...issue, sourceUrl: "https://github.com/other/repo/issues/1" }] }), authority)).rejects.toThrow("origin differs");
    await expect(ledger.capture(scope.operationId, page({ records: [issue, issue] }), authority)).rejects.toThrow("Duplicate source identities");
    await expect(ledger.capture(scope.operationId, page({ cursor: "loop", nextCursor: "loop" }), authority)).rejects.toThrow("did not advance");
    expect(ledger.get(scope.operationId)?.revision).toBe(0);
  } finally { db.close(); }
});

test("older source updates and pagination cycles preserve the stored page frontier", async () => {
  const db = new Database(":memory:"), ledger = new MigrationIssuesLedger(storage(db));
  try {
    await ledger.begin(scope, authority); await ledger.capture(scope.operationId, page(), authority);
    const stale = page({ pageId: "stale", expectedRevision: 1, cursor: "page2", nextCursor: "page3", records: [{ ...issue, updatedAt: "2026-10-01T00:00:00Z", body: "Older source" }] });
    await expect(ledger.capture(scope.operationId, stale, authority)).rejects.toThrow("update is stale");
    expect(ledger.get(scope.operationId)?.revision).toBe(1);
    await ledger.capture(scope.operationId, page({ pageId: "page2", expectedRevision: 1, cursor: "page2", nextCursor: "page3", records: [] }), authority);
    await expect(ledger.capture(scope.operationId, page({ pageId: "page3", expectedRevision: 2, cursor: "page3", nextCursor: "page2", records: [] }), authority)).rejects.toThrow("already captured");
    expect(ledger.get(scope.operationId)?.cursor).toBe("page3");
    expect(ledger.origins(scope.operationId)[0]?.body).toBe(issue.body);
  } finally { db.close(); }
});

test("composite pages stage linked external comments atomically and produce a stable exact manifest", async () => {
  const db = new Database(":memory:"), ledger = new MigrationIssuesLedger(storage(db));
  const body = "Preserved source comment";
  const bodyHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const comment = { providerId: "12345", nodeId: "IC_12345", issueNumber: 1, repositoryId: scope.repositoryId, repositoryNodeId: scope.repositoryNodeId, sourceUrl: `${scope.sourceUrl}/issues/1#issuecomment-12345`, actor: issue.actor, body, bodyHash, createdAt: issue.createdAt, updatedAt: issue.updatedAt, identity: "external-unclaimed" as const, nativeUserId: null };
  try {
    await ledger.begin(scope, authority);
    const composite = page({ comments: [comment], nextCursor: null });
    const finished = await ledger.capture(scope.operationId, composite, authority);
    expect(finished.snapshot).toMatchObject({ issues: 1, comments: 1, status: "complete", published: false });
    expect(ledger.comments(scope.operationId)[0]).toMatchObject({ parentIssueId: issue.providerId, parentIssueNodeId: issue.nodeId, parentKind: "issue", actor: issue.actor, body, bodyHash, nativeUserId: null });
    const manifest = await ledger.manifest(scope.operationId, authority);
    expect(manifest).toMatchObject({ revision: 1, counts: { issues: 1, pullRequests: 0, comments: 1, missing: 0 }, atomicSourceSnapshot: false, published: false });
    expect(manifest.hash).toMatch(/^[a-f0-9]{64}$/); expect(manifest.excluded).toContain("inline-review-comments");
    expect((await ledger.capture(scope.operationId, { ...composite, observedAt: "2026-10-04T02:00:00Z" }, authority)).kind).toBe("duplicate");
    expect((await ledger.manifest(scope.operationId, authority)).hash).toBe(manifest.hash);
    await expect(ledger.capture(scope.operationId, { ...composite, comments: [{ ...comment, body: "Changed content" }] }, authority)).rejects.toThrow("body hash differs");
  } finally { db.close(); }
});

test("missing comment parents and wrong external parent origins roll back issues and cursor together", async () => {
  const db = new Database(":memory:"), ledger = new MigrationIssuesLedger(storage(db));
  const bodyHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("body")))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const comment = { providerId: "12345", nodeId: "IC_12345", issueNumber: 2, repositoryId: scope.repositoryId, repositoryNodeId: scope.repositoryNodeId, sourceUrl: `${scope.sourceUrl}/issues/2#issuecomment-12345`, actor: issue.actor, body: "body", bodyHash, createdAt: issue.createdAt, updatedAt: issue.updatedAt, identity: "external-unclaimed" as const, nativeUserId: null };
  try {
    await ledger.begin(scope, authority);
    await expect(ledger.capture(scope.operationId, page({ comments: [comment], nextCursor: null }), authority)).rejects.toThrow("parent unavailable");
    expect(ledger.get(scope.operationId)).toMatchObject({ revision: 0, issues: 0, comments: 0 });
    await expect(ledger.capture(scope.operationId, page({ comments: [{ ...comment, issueNumber: 1, sourceUrl: `${scope.sourceUrl}/pull/1#issuecomment-12345` }], nextCursor: null }), authority)).rejects.toThrow("parent origin differs");
    expect(ledger.get(scope.operationId)).toMatchObject({ revision: 0, issues: 0, comments: 0 });
  } finally { db.close(); }
});


test("public reader adapter persists PR conversation origins and nested comments without dropping either", async () => {
  const db = new Database(":memory:"), ledger = new MigrationIssuesLedger(storage(db));
  try {
    await ledger.begin(scope, authority);
    const rawIssue = { id: "77", node_id: "PR_77", number: 3, html_url: `${scope.sourceUrl}/pull/3`, user: { id: 88, login: "external-pr-author" }, title: "External PR", body: "Original PR description", state: "closed", comments: 1, created_at: issue.createdAt, updated_at: issue.updatedAt, closed_at: issue.updatedAt, pull_request: { url: "https://api.github.com/repos/synthetic/owned/pulls/3" } };
    const rawComment = { id: "99", node_id: "IC_99", html_url: `${scope.sourceUrl}/pull/3#issuecomment-99`, user: { id: 88, login: "external-pr-author" }, body: "Preserved PR issue comment", created_at: issue.createdAt, updated_at: issue.updatedAt };
    const capabilities = { authorize: async () => {}, beforeCall: async () => {}, fetch: async (request: Request) => Response.json(new URL(request.url).pathname.endsWith("/comments") ? [rawComment] : new URL(request.url).pathname.endsWith("/issues") ? [rawIssue] : { id: scope.repositoryId, node_id: scope.repositoryNodeId, html_url: scope.sourceUrl, private: false }), capture: async (_scope: MigrationIssueScope, capture: Parameters<typeof migrationPageFromGithubCapture>[0]) => { await ledger.capture(scope.operationId, migrationPageFromGithubCapture(capture, ledger.get(scope.operationId)!.revision), authority); } };
    const first = await readGithubMigrationSlice(scope, null, capabilities);
    await readGithubMigrationSlice(scope, first.nextCursor, capabilities);
    expect(ledger.get(scope.operationId)).toMatchObject({ issues: 0, pullRequests: 1, comments: 1, status: "complete", published: false });
    expect(ledger.comments(scope.operationId)[0]).toMatchObject({ parentKind: "pull_request", parentIssueId: "77", parentIssueNodeId: "PR_77", actor: { providerId: "88", login: "external-pr-author" } });
    expect((await ledger.manifest(scope.operationId, authority)).counts).toEqual({ issues: 0, pullRequests: 1, comments: 1, missing: 0 });
  } finally { db.close(); }
});


test("upserts preserve original external author and refuse changed creation or impersonation", async () => {
  const db = new Database(":memory:"), ledger = new MigrationIssuesLedger(storage(db));
  try {
    await ledger.begin(scope, authority); await ledger.capture(scope.operationId, page(), authority);
    const next = page({ pageId: "page2", expectedRevision: 1, cursor: "page2", nextCursor: "page3", records: [{ ...issue, actor: { ...issue.actor, providerId: "999" }, updatedAt: "2026-10-03T00:00:00Z" }] });
    await expect(ledger.capture(scope.operationId, next, authority)).rejects.toThrow("Immutable external issue");
    await expect(ledger.capture(scope.operationId, { ...next, records: [{ ...issue, createdAt: "2026-09-30T00:00:00Z" }] }, authority)).rejects.toThrow("Immutable external issue");
    await ledger.capture(scope.operationId, { ...next, records: [{ ...issue, actor: { providerId: null, login: "deleted-user", displayName: null }, updatedAt: "2026-10-03T00:00:00Z" }] }, authority);
    expect(ledger.origins(scope.operationId)[0]?.actor).toEqual(issue.actor);
    expect(ledger.origins(scope.operationId)[0]?.sourceActor).toEqual({ providerId: null, login: "deleted-user", displayName: null });
  } finally { db.close(); }
});
