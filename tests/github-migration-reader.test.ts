import { expect, test } from "bun:test";
import { GithubMigrationReadError, normalizeGithubMigrationSource, readPublicGithubRepositoryIdentity, readGithubMigrationSlice, type GithubMigrationFailureCode, type GithubMigrationCapture, type GithubMigrationReaderCapabilities } from "../src/server/github-migration-reader";
import type { MigrationIssueScope } from "../src/server/migration-issues-ledger";

const scope: MigrationIssueScope = { operationId: "migration-reader", projectId: "p123456789abc", incarnation: "11111111-1111-4111-8111-111111111111", ownerId: "owner", provider: "github", repositoryId: "123", repositoryNodeId: "R_123", sourceUrl: "https://github.com/synthetic/owned" };
const repository = { id: 123, node_id: "R_123", html_url: scope.sourceUrl, private: false };
const issue = { id: 456, node_id: "I_456", number: 1, html_url: `${scope.sourceUrl}/issues/1`, user: { id: 12, login: "source-author" }, title: "Source conversation", body: "Original body", state: "open", comments: 1, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", closed_at: null };
const comment = { id: 789, node_id: "IC_789", html_url: `${scope.sourceUrl}/issues/1#issuecomment-789`, user: null, body: "Preserve deleted author attribution", created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" };
function fixture(response: (request: Request) => Response | Promise<Response>) {
  const calls: Request[] = [], receipts: string[] = [], captured: GithubMigrationCapture[] = [];
  const capabilities: GithubMigrationReaderCapabilities = {
    authorize: async () => {}, beforeCall: async (_scope, key) => { receipts.push(key); },
    fetch: async request => { calls.push(request); expect(receipts.length).toBe(calls.length); return response(request); },
    capture: async (_scope, page) => { captured.push(page); },
  };
  return { capabilities, calls, receipts, captured };
}
const json = (value: unknown) => Response.json(value);

test("constructed public issue/comment pages preserve external origins and durable resumable cursor", async () => {
  const f = fixture(request => new URL(request.url).pathname.endsWith("/comments") ? json([comment]) : new URL(request.url).pathname.endsWith("/issues") ? json([issue]) : json(repository));
  const initial = await readGithubMigrationSlice(scope, null, f.capabilities);
  expect(initial.issues[0]).toMatchObject({ providerId: "456", actor: { providerId: "12", login: "source-author", displayName: null }, kind: "issue" });
  expect(initial.nextCursor).not.toBeNull(); expect(initial.comments.length).toBe(0);
  const resumed = await readGithubMigrationSlice(scope, initial.nextCursor, f.capabilities);
  expect(resumed.nextCursor).toBeNull(); expect(resumed.comments[0]).toMatchObject({ providerId: "789", identity: "external-unclaimed", nativeUserId: null, actor: { providerId: null, login: "deleted-user" }, issueNumber: 1 });
  expect(resumed.comments[0]?.bodyHash).toMatch(/^[a-f0-9]{64}$/);
  expect(resumed.atomicSourceSnapshot).toBe(false); expect(resumed.excluded).toContain("inline-review-comments");
  expect(f.captured.length).toBe(2); expect(f.calls.length).toBe(4);
  expect(f.calls.every(request => new URL(request.url).origin === "https://api.github.com" && request.method === "GET" && request.redirect === "manual")).toBe(true);
});

test("PR issue classification and nested inaccessible comments remain explicit", async () => {
  const pr = { ...issue, html_url: `${scope.sourceUrl}/pull/1`, pull_request: { url: "https://api.github.com/repos/synthetic/owned/pulls/1" } };
  const f = fixture(request => new URL(request.url).pathname.endsWith("/comments") ? new Response(null, { status: 404 }) : new URL(request.url).pathname.endsWith("/issues") ? json([pr]) : json(repository));
  const first = await readGithubMigrationSlice(scope, null, f.capabilities);
  expect(first.issues[0]?.kind).toBe("pull_request");
  const last = await readGithubMigrationSlice(scope, first.nextCursor, f.capabilities);
  expect(last.missing).toEqual([{ sourceId: "issue-1-comments", kind: "comment", reason: "Provider returned inaccessible issue comments" }]);
  expect(last.comments).toEqual([]); expect(last.nextCursor).toBeNull();
});

test("rate limits, redirect responses, identity replacement and private sources do not capture a page", async () => {
  for (const result of [new Response(null, { status: 429 }), new Response(null, { status: 302, headers: { Location: "https://attacker.example/" } }), json({ ...repository, id: 999 }), json({ ...repository, private: true })]) {
    const f = fixture(() => result);
    await expect(readGithubMigrationSlice(scope, null, f.capabilities)).rejects.toThrow();
    expect(f.captured.length).toBe(0); expect(f.calls.length).toBe(1);
  }
});

test("budget refusal and hostile cursor cannot cause a fetch or credential leak", async () => {
  const token = "synthetic_read_token_123456";
  const f = fixture(() => { throw new Error(`Transport failed ${token}`); });
  f.capabilities.getReadToken = async () => token;
  await expect(readGithubMigrationSlice(scope, null, f.capabilities)).rejects.toThrow("Migration read not confirmed; saved cursor retained");
  expect(f.calls[0]?.headers.get("Authorization")).toBe(`Bearer ${token}`);
  expect(JSON.stringify(f.captured)).not.toContain(token);
  const denied = fixture(() => json(repository)); denied.capabilities.beforeCall = async () => { throw new Error("Budget unavailable"); };
  await expect(readGithubMigrationSlice(scope, null, denied.capabilities)).rejects.toThrow("Budget unavailable"); expect(denied.calls.length).toBe(0);
  const hostile = fixture(() => json(repository));
  await expect(readGithubMigrationSlice(scope, '{"url":"https://attacker.example"}', hostile.capabilities)).rejects.toThrow(); expect(hostile.calls.length).toBe(0);
});

test("full pages progress through constructed page numbers and ignore arbitrary Link URLs", async () => {
  const values = Array.from({ length: 10 }, (_, index) => ({ ...issue, id: 456 + index, node_id: `I_${index}`, number: index + 1, html_url: `${scope.sourceUrl}/issues/${index + 1}`, comments: 0 }));
  const f = fixture(request => new URL(request.url).pathname.endsWith("/issues") ? new Response(JSON.stringify(new URL(request.url).searchParams.get("page") === "1" ? values : []), { headers: { Link: '<https://attacker.example/secrets>; rel="next"' } }) : json(repository));
  const first = await readGithubMigrationSlice(scope, null, f.capabilities);
  const last = await readGithubMigrationSlice(scope, first.nextCursor, f.capabilities);
  expect(last.nextCursor).toBeNull(); expect(new URL(f.calls[3]!.url).searchParams.get("page")).toBe("2"); expect(f.calls.some(request => request.url.includes("attacker"))).toBe(false);
});

test("oversized streaming response and cross-repository comment origins fail before capture", async () => {
  const huge = fixture(() => new Response("x".repeat(1024 * 1024 + 1)));
  await expect(readGithubMigrationSlice(scope, null, huge.capabilities)).rejects.toThrow("could not be validated"); expect(huge.captured.length).toBe(0);
  const f = fixture(request => new URL(request.url).pathname.endsWith("/comments") ? json([{ ...comment, html_url: "https://github.com/other/repo/issues/1#issuecomment-789" }]) : new URL(request.url).pathname.endsWith("/issues") ? json([issue]) : json(repository));
  const first = await readGithubMigrationSlice(scope, null, f.capabilities);
  await expect(readGithubMigrationSlice(scope, first.nextCursor, f.capabilities)).rejects.toThrow("source identity changed"); expect(f.captured.length).toBe(1);
});

test("opaque cursors resume each nested comment page before returning to issue pagination", async () => {
  const values = Array.from({ length: 10 }, (_, index) => ({ ...comment, id: 789 + index, node_id: `IC_${789 + index}`, html_url: `${scope.sourceUrl}/issues/1#issuecomment-${789 + index}` }));
  const f = fixture(request => {
    const url = new URL(request.url);
    return url.pathname.endsWith("/comments") ? json(url.searchParams.get("page") === "1" ? values : []) : url.pathname.endsWith("/issues") ? json([issue]) : json(repository);
  });
  const issuesPage = await readGithubMigrationSlice(scope, null, f.capabilities);
  const commentsPage = await readGithubMigrationSlice(scope, issuesPage.nextCursor, f.capabilities);
  expect(commentsPage.comments.length).toBe(10); expect(commentsPage.nextCursor).not.toBeNull();
  const last = await readGithubMigrationSlice(scope, commentsPage.nextCursor, f.capabilities);
  expect(last.comments.length).toBe(0); expect(last.nextCursor).toBeNull(); expect(last.pageId).toBe("github-comments-1-2");
});

test("duplicate or unsafe provider numeric identities cannot enter a receipt", async () => {
  for (const records of [[issue, issue], [{ ...issue, id: Number.MAX_SAFE_INTEGER + 1 }]]) {
    const f = fixture(request => new URL(request.url).pathname.endsWith("/issues") ? json(records) : json(repository));
    await expect(readGithubMigrationSlice(scope, null, f.capabilities)).rejects.toThrow(); expect(f.captured.length).toBe(0);
  }
});


test("shared public identity discovery normalizes legitimate aliases and rejects foreign or private source", async () => {
  let funded = 0, calls = 0, authorized = 0;
  const canonical = "https://github.com/Synthetic/Owned";
  const fetcher = async (request: Request) => { calls++; expect(funded).toBe(calls); expect(request.headers.has("Authorization")).toBe(false); expect(request.redirect).toBe("manual"); return json({ ...repository, html_url: canonical }); };
  expect(normalizeGithubMigrationSource("https://github.com/synthetic/owned.git/")).toBe(scope.sourceUrl);
  expect(await readPublicGithubRepositoryIdentity("https://github.com/synthetic/owned.git/", async () => { authorized++; }, async () => { funded++; }, fetcher)).toEqual({ repositoryId: scope.repositoryId, repositoryNodeId: scope.repositoryNodeId, sourceUrl: canonical });
  await readPublicGithubRepositoryIdentity(scope.sourceUrl, async () => {}, async () => { funded++; }, fetcher);
  expect(funded).toBe(2); expect(authorized).toBe(3);
  for (const value of [{ ...repository, html_url: "https://github.com/foreign/repo" }, { ...repository, private: true }]) await expect(readPublicGithubRepositoryIdentity(scope.sourceUrl, async () => {}, async () => {}, async () => json(value))).rejects.toThrow("identity changed");
  await expect(readPublicGithubRepositoryIdentity("https://github.com/synthetic/owned?token=secret", async () => {}, async () => {}, fetcher)).rejects.toThrow("could not be validated");
  expect(calls).toBe(2);
});

test("shared public discovery rechecks authorization after response before revealing an identity", async () => {
  let calls = 0;
  await expect(readPublicGithubRepositoryIdentity(scope.sourceUrl, async () => { if (++calls === 3) throw new Error("Owner revoked"); }, async () => {}, async () => json(repository))).rejects.toThrow("Owner revoked");
});

test("shared discovery total deadline cancels a stalled body even when transport ignores abort", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const started = Date.now();
  await expect(readPublicGithubRepositoryIdentity(scope.sourceUrl, async () => {}, async () => {}, async () => new Response(stream))).rejects.toThrow("GitHub read timed out");
  expect(cancelled).toBe(true); expect(Date.now() - started).toBeLessThan(17000);
}, 20000);


test("safe provider failure taxonomy identifies actual allowance proof without exposing bodies", async () => {
  const secret = "never_expose_provider_body_or_token";
  const cases: Array<{ status: number; headers: Record<string, string>; code: GithubMigrationFailureCode; retry: number | undefined }> = [
    { status: 429, headers: { "Retry-After": "12" }, code: "rate_limited", retry: 12 },
    { status: 403, headers: { "X-RateLimit-Remaining": "0", "Retry-After": "999999" }, code: "rate_limited", retry: undefined },
    { status: 403, headers: { "X-RateLimit-Remaining": "100" }, code: "auth", retry: undefined },
    { status: 401, headers: {}, code: "auth", retry: undefined },
    { status: 404, headers: {}, code: "not_found", retry: undefined },
    { status: 503, headers: {}, code: "provider_unavailable", retry: undefined },
  ];
  for (const item of cases) {
    let caught: unknown;
    try { await readPublicGithubRepositoryIdentity(scope.sourceUrl, async () => {}, async () => {}, async () => new Response(secret, { status: item.status, headers: item.headers })); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(GithubMigrationReadError);
    const error = caught as GithubMigrationReadError;
    expect(error.code).toBe(item.code); expect(error.httpStatus).toBe(item.status); expect(error.retryAfterSeconds).toBe(item.retry);
    expect(error.message).not.toContain(secret); expect(JSON.stringify(error)).not.toContain(secret);
  }
});

test("authority and funding callback errors retain their original class before any read", async () => {
  class FundingUnavailable extends Error {}
  const funding = new FundingUnavailable("Funded allowance unavailable");
  let reads = 0;
  try { await readPublicGithubRepositoryIdentity(scope.sourceUrl, async () => {}, async () => { throw funding; }, async () => { reads++; return json(repository); }); throw new Error("Expected refusal"); }
  catch (error) { expect(error).toBe(funding); }
  const authority = new FundingUnavailable("Owner authority changed");
  try { await readPublicGithubRepositoryIdentity(scope.sourceUrl, async () => { throw authority; }, async () => {}, async () => { reads++; return json(repository); }); throw new Error("Expected refusal"); }
  catch (error) { expect(error).toBe(authority); }
  expect(reads).toBe(0);
  await expect(readPublicGithubRepositoryIdentity(scope.sourceUrl, async () => {}, async () => {}, async () => json({ token: "never-log-malformed-metadata" }))).rejects.toThrow("could not be validated");
});


test("default metadata transport preserves global native fetch receiver and restores the test seam", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = new Proxy(original, { apply(_target, receiver, args) {
    if (receiver !== globalThis) throw new Error("Synthetic native fetch receiver required");
    const request: unknown = args[0];
    if (!(request instanceof Request)) throw new Error("Expected constructed request");
    calls++; expect(new URL(request.url).origin).toBe("https://api.github.com");
    return Promise.resolve(json(repository));
  } });
  try {
    expect(await readPublicGithubRepositoryIdentity(scope.sourceUrl, async () => {}, async () => {})).toEqual({ repositoryId: scope.repositoryId, repositoryNodeId: scope.repositoryNodeId, sourceUrl: scope.sourceUrl });
    expect(calls).toBe(1);
  } finally { globalThis.fetch = original; }
  expect(globalThis.fetch).toBe(original);
});
