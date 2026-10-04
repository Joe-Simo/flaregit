import { z } from "zod";
import { classifyGithubIssue, type MigrationExternalIssue, type MigrationIssueScope, type MigrationExternalComment, type MigrationIssuePage } from "./migration-issues-ledger";

const PER_PAGE = 10;
const MAX_PAGE = 1000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const id = z.union([z.string().regex(/^[1-9][0-9]{0,19}$/), z.number().int().positive().safe()]).transform(String);
const nodeId = z.string().min(1).max(256).regex(/^[A-Za-z0-9_+=\/-]+$/);
const timestamp = z.string().datetime({ offset: true });
const actorSchema = z.object({ id, login: z.string().min(1).max(100), name: z.string().max(200).nullable().optional() }).nullable();
const issueSchema = z.object({ id, node_id: nodeId, number: z.number().int().positive().safe(), html_url: z.string().max(2048), user: actorSchema, title: z.string().min(1).max(1024), body: z.string().max(65536).nullable(), state: z.enum(["open", "closed"]), comments: z.number().int().nonnegative().safe(), created_at: timestamp, updated_at: timestamp, closed_at: timestamp.nullable(), pull_request: z.unknown().optional() });
const commentSchema = z.object({ id, node_id: nodeId, html_url: z.string().max(2048), user: actorSchema, body: z.string().max(65536), created_at: timestamp, updated_at: timestamp });
const cursorSchema = z.object({ version: z.literal(1), phase: z.enum(["issues", "comments"]), issuePage: z.number().int().min(1).max(MAX_PAGE), nextIssuePage: z.number().int().min(1).max(MAX_PAGE).nullable(), pendingIssues: z.array(z.number().int().positive().safe()).max(PER_PAGE), commentPage: z.number().int().min(1).max(MAX_PAGE) }).strict();
type Cursor = z.infer<typeof cursorSchema>;
export interface GithubMigrationCapture {
  pageId: string; cursor: string | null; nextCursor: string | null; observedAt: string;
  issues: MigrationExternalIssue[]; comments: MigrationExternalComment[];
  missing: Array<{sourceId:string;kind:"comment";reason:string}>;
  completionScope: "observed-issues-and-issue-comments-pagination";
  excluded: readonly ["inline-review-comments", "timelines", "discussions", "reactions", "attachments"];
  atomicSourceSnapshot: false;
}
export interface GithubMigrationReaderCapabilities {
  authorize(scope: MigrationIssueScope): Promise<void>;
  beforeCall(scope: MigrationIssueScope, receiptKey: string): Promise<void>;
  fetch(request: Request): Promise<Response>;
  getReadToken?(): Promise<string | undefined>;
  /** Must durably CAS this cursor and record pageId/content; the reader never publishes. */
  capture(scope: MigrationIssueScope, page: GithubMigrationCapture): Promise<void>;
}
function actor(value: z.infer<typeof actorSchema>): MigrationExternalIssue["actor"] {
  return value ? { providerId: value.id, login: value.login, displayName: value.name ?? null } : { providerId: null, login: "deleted-user", displayName: null };
}
export function normalizeGithubMigrationSource(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  const path = url.pathname.replace(/\/$/, "").replace(/\.git$/i, "");
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(path)) throw new Error("Exact public GitHub source required");
  return `https://github.com${path}`;
}
function source(scope: MigrationIssueScope): { path: string; api: string } {
  if (scope.provider !== "github") throw new Error("Exact public GitHub source required");
  const path = new URL(normalizeGithubMigrationSource(scope.sourceUrl)).pathname;
  return { path, api: `https://api.github.com/repos${path}` };
}
function sourceOrigin(value: string, pathname: string, commentId?: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.pathname.toLowerCase() !== pathname.toLowerCase() || (commentId === undefined ? Boolean(url.hash) : url.hash !== `#issuecomment-${commentId}`)) throw new Error("GitHub origin changed");
}
async function hash(body: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function encode(cursor: Cursor | null): string | null { return cursor ? JSON.stringify(cursor) : null; }
function advanceComments(cursor: Cursor): Cursor | null {
  const pendingIssues = cursor.pendingIssues.slice(1);
  return pendingIssues.length ? { ...cursor, pendingIssues, commentPage: 1 } : cursor.nextIssuePage !== null ? { version: 1, phase: "issues", issuePage: cursor.nextIssuePage, nextIssuePage: null, pendingIssues: [], commentPage: 1 } : null;
}
interface GithubReadCapabilities { authorize(): Promise<void>; beforeCall(): Promise<void>; fetch(request: Request): Promise<Response>; token?: string }
async function readGithubJson(url: string, capabilities: GithubReadCapabilities, allowMissing = false): Promise<unknown | null> {
    if (new URL(url).origin !== "https://api.github.com") throw new Error("Migration API host is invalid");
    await capabilities.authorize(); await capabilities.beforeCall(); await capabilities.authorize();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Migration read deadline reached")); }, 15000); });
    try {
      const headers = new Headers({ Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "FlareGit-migration" });
      if (capabilities.token) headers.set("Authorization", `Bearer ${capabilities.token}`);
      const response = await Promise.race([capabilities.fetch(new Request(url, { headers, redirect: "manual", signal: controller.signal })), expired]);
      if (response.status >= 300 && response.status < 400) throw new Error("Migration redirect refused");
      if (allowMissing && response.status === 404) return null;
      if (!response.ok) throw new Error(response.status === 403 || response.status === 429 ? "Migration provider allowance or authorization unavailable; saved cursor retained" : "Migration provider read unavailable; saved cursor retained");
      if (!response.body) throw new Error("Migration response unavailable");
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) { const result = await Promise.race([reader.read(), expired]); if (result.done) break; size += result.value.byteLength; if (size > MAX_RESPONSE_BYTES) { await Promise.race([reader.cancel(), expired]); throw new Error("Migration response capacity reached"); } chunks.push(result.value); }
      } catch (error) { void reader.cancel().catch(() => undefined); throw error; }
      finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch { throw new Error("Migration read not confirmed; saved cursor retained"); }
    finally { if (timer) clearTimeout(timer); }

}
export async function readPublicGithubRepositoryIdentity(sourceUrl: string, authorize: () => Promise<void>, beforeCall: () => Promise<void>, fetcher: (request: Request) => Promise<Response> = fetch): Promise<{repositoryId:string;repositoryNodeId:string;sourceUrl:string}> {
  const normalized = normalizeGithubMigrationSource(sourceUrl), path = new URL(normalized).pathname;
  const repository = z.object({ id, node_id: nodeId, html_url: z.string(), private: z.boolean() }).parse(await readGithubJson(`https://api.github.com/repos${path}`, { authorize, beforeCall, fetch: fetcher }));
  const canonical = normalizeGithubMigrationSource(repository.html_url);
  if (repository.private || new URL(canonical).pathname.toLowerCase() !== path.toLowerCase()) throw new Error("Public migration source identity changed");
  await authorize();
  return { repositoryId: repository.id, repositoryNodeId: repository.node_id, sourceUrl: canonical };
}
/** Only constructs known-host read URLs. Tokens never appear in cursor, receipts or errors. */
export async function readGithubMigrationSlice(scope: MigrationIssueScope, savedCursor: string | null, capabilities: GithubMigrationReaderCapabilities): Promise<GithubMigrationCapture> {
  const origin = source(scope);
  if (savedCursor !== null && savedCursor.length > 1000) throw new Error("Migration cursor exceeds capacity");
  const cursor: Cursor = savedCursor === null ? { version: 1, phase: "issues", issuePage: 1, nextIssuePage: null, pendingIssues: [], commentPage: 1 } : cursorSchema.parse(JSON.parse(savedCursor));
  if (new Set(cursor.pendingIssues).size !== cursor.pendingIssues.length || (cursor.phase === "comments" ? cursor.pendingIssues.length === 0 : cursor.pendingIssues.length !== 0)) throw new Error("Migration cursor identity is invalid");
  await capabilities.authorize(scope);
  let token: string | undefined;
  try { token = await capabilities.getReadToken?.(); } catch { throw new Error("Migration read credential unavailable"); }
  if (token !== undefined && (!token || token.length > 255 || /[^A-Za-z0-9_]/.test(token))) throw new Error("Migration read credential is invalid");
  const pageId = cursor.phase === "issues" ? `github-issues-${cursor.issuePage}` : `github-comments-${cursor.pendingIssues[0]}-${cursor.commentPage}`;
  const read = (url: string, key: string, allowMissing = false) => readGithubJson(url, {
    authorize: () => capabilities.authorize(scope), beforeCall: () => capabilities.beforeCall(scope, key), fetch: capabilities.fetch, token,
  }, allowMissing);
  // Recheck numeric identity every slice: a renamed/recreated URL is not this source.
  const repository = z.object({ id, node_id: nodeId, html_url: z.string(), private: z.boolean() }).parse(await read(origin.api, `${pageId}-repository`));
  sourceOrigin(repository.html_url, origin.path);
  if (repository.private || repository.id !== scope.repositoryId || repository.node_id !== scope.repositoryNodeId) throw new Error("Public migration source identity changed");
  const issues: MigrationExternalIssue[] = [], comments: MigrationExternalComment[] = [], missing: GithubMigrationCapture["missing"] = [];
  let next: Cursor | null;
  if (cursor.phase === "issues") {
    const url = `${origin.api}/issues?state=all&sort=created&direction=asc&per_page=${PER_PAGE}&page=${cursor.issuePage}`;
    const values = z.array(issueSchema).max(PER_PAGE).parse(await read(url, pageId));
    if (new Set(values.map(value => value.id)).size !== values.length || new Set(values.map(value => value.node_id)).size !== values.length || new Set(values.map(value => value.number)).size !== values.length) throw new Error("Duplicate issue identities in provider page");
    if (values.length === PER_PAGE && cursor.issuePage === MAX_PAGE) throw new Error("Migration page capacity reached; saved cursor retained");
    const pendingIssues: number[] = [];
    for (const value of values) {
      if (value.pull_request !== undefined && (!value.pull_request || typeof value.pull_request !== "object")) throw new Error("Pull request classification unavailable");
      const kind = classifyGithubIssue(value);
      sourceOrigin(value.html_url, `${origin.path}/${kind === "issue" ? "issues" : "pull"}/${value.number}`);
      if (Date.parse(value.updated_at) < Date.parse(value.created_at) || new TextEncoder().encode(value.body ?? "").length > 65536) throw new Error("Migration timestamps changed");
      issues.push({ providerId: value.id, nodeId: value.node_id, number: value.number, kind, sourceUrl: value.html_url, actor: actor(value.user), title: value.title, body: value.body ?? "", state: value.state, createdAt: value.created_at, updatedAt: value.updated_at, closedAt: value.closed_at });
      if (value.comments > 0) pendingIssues.push(value.number);
    }
    const nextIssuePage = values.length === PER_PAGE ? cursor.issuePage + 1 : null;
    next = pendingIssues.length ? { version: 1, phase: "comments", issuePage: cursor.issuePage, nextIssuePage, pendingIssues, commentPage: 1 } : nextIssuePage !== null ? { version: 1, phase: "issues", issuePage: nextIssuePage, nextIssuePage: null, pendingIssues: [], commentPage: 1 } : null;
  } else {
    const issueNumber = cursor.pendingIssues[0]!;
    const values = await read(`${origin.api}/issues/${issueNumber}/comments?per_page=${PER_PAGE}&page=${cursor.commentPage}`, pageId, true);
    if (values === null) { missing.push({ sourceId: `issue-${issueNumber}-comments`, kind: "comment", reason: "Provider returned inaccessible issue comments" }); next = advanceComments(cursor); }
    else {
      const parsed = z.array(commentSchema).max(PER_PAGE).parse(values);
      if (new Set(parsed.map(value => value.id)).size !== parsed.length || new Set(parsed.map(value => value.node_id)).size !== parsed.length) throw new Error("Duplicate comment identities in provider page");
      if (parsed.length === PER_PAGE && cursor.commentPage === MAX_PAGE) throw new Error("Migration comment capacity reached; saved cursor retained");
      for (const value of parsed) {
        // PR issue comments have /pull/<number> origins; both paths are distinct from inline reviews.
        const commentUrl = new URL(value.html_url);
        if (![`${origin.path}/issues/${issueNumber}`, `${origin.path}/pull/${issueNumber}`].includes(commentUrl.pathname)) throw new Error("Comment parent origin changed");
        sourceOrigin(value.html_url, commentUrl.pathname, value.id);
        if (Date.parse(value.updated_at) < Date.parse(value.created_at) || new TextEncoder().encode(value.body).length > 65536) throw new Error("Comment metadata capacity or timestamps invalid");
        comments.push({ providerId: value.id, nodeId: value.node_id, issueNumber, repositoryId: scope.repositoryId, repositoryNodeId: scope.repositoryNodeId, sourceUrl: value.html_url, actor: actor(value.user), body: value.body, bodyHash: await hash(value.body), createdAt: value.created_at, updatedAt: value.updated_at, identity: "external-unclaimed", nativeUserId: null });
      }
      next = parsed.length === PER_PAGE ? { ...cursor, commentPage: cursor.commentPage + 1 } : advanceComments(cursor);
    }
  }
  const captured: GithubMigrationCapture = { pageId, cursor: savedCursor, nextCursor: encode(next), observedAt: new Date().toISOString(), issues, comments, missing, completionScope: "observed-issues-and-issue-comments-pagination", excluded: ["inline-review-comments", "timelines", "discussions", "reactions", "attachments"], atomicSourceSnapshot: false };
  await capabilities.authorize(scope); await capabilities.capture(scope, captured);
  return captured;
}

/** Adapt the composite reader page without discarding PR records or comments. */
export function migrationPageFromGithubCapture(page: GithubMigrationCapture, expectedRevision: number): MigrationIssuePage {
  return { pageId: page.pageId, expectedRevision, cursor: page.cursor, nextCursor: page.nextCursor, records: page.issues, comments: page.comments, missing: page.missing, observedAt: page.observedAt };
}
