import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqlOAuthStore, SqlPackageStore, type SqlLike } from "../src/core/durable-stores";
import { createOAuthServer, OAUTH_REFRESH_TTL_MS } from "../src/core/oauth-server";
import { PackageRegistry } from "../src/core/package-registry";
import { handleAuthorityCall, type AuthorityBackend, type AuthorityCall } from "../src/server/authority-api";

const dir = mkdtempSync(join(tmpdir(), "flaregit-authority-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function openSql(name: string): SqlLike {
  const db = new Database(join(dir, name));
  return {
    exec(query, ...bindings) {
      const statement = db.query(query);
      if (/^\s*select/i.test(query)) {
        const rows = statement.all(...(bindings as never[]));
        return { toArray: () => rows };
      }
      statement.run(...(bindings as never[]));
      return { toArray: () => [] };
    },
  };
}

const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "https://app.example/cb";

function backend(name: string, clock?: () => number): AuthorityBackend {
  const sql = openSql(`${name}.sqlite`);
  return {
    oauth: createOAuthServer({ store: createSqlOAuthStore(sql), clock }),
    registry: new PackageRegistry(new SqlPackageStore(sql)),
  };
}

function call(api: AuthorityBackend, input: Partial<AuthorityCall> & Pick<AuthorityCall, "method" | "pathname">) {
  return handleAuthorityCall(api, { search: "", body: undefined, ...input });
}

const json = (reply: { body: string }) => JSON.parse(reply.body) as Record<string, unknown>;

test("registering an app and authorizing needs a browser session, not an API token or anonymous caller", async () => {
  const api = backend("auth-gate");
  const app = { name: "App", redirectUris: [REDIRECT], scopes: ["code:read"] };
  expect((await call(api, { method: "POST", pathname: "/api/oauth/apps", body: app })).status).toBe(401);
  const created = await call(api, { method: "POST", pathname: "/api/oauth/apps", body: app, userId: "user-1" });
  expect(created.status).toBe(201);
  const clientId = json(created).clientId as string;
  const authorize = { clientId, redirectUri: REDIRECT, scope: "code:read", codeChallenge: CHALLENGE, state: "s" };
  expect((await call(api, { method: "POST", pathname: "/api/oauth/authorize", body: authorize })).status).toBe(401);
  expect((await call(api, { method: "POST", pathname: "/api/oauth/authorize", body: authorize, userId: "user-1" })).status).toBe(200);
});

test("a token exchange works without a session and a replayed code is refused", async () => {
  const api = backend("token-flow");
  const created = await call(api, { method: "POST", pathname: "/api/oauth/apps", body: { name: "App", redirectUris: [REDIRECT], scopes: ["code:read"] }, userId: "u" });
  const clientId = json(created).clientId as string;
  const authorized = await call(api, { method: "POST", pathname: "/api/oauth/authorize", body: { clientId, redirectUri: REDIRECT, scope: "code:read", codeChallenge: CHALLENGE }, userId: "u" });
  const code = json(authorized).code as string;
  const token = { grant_type: "authorization_code", code, clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER };
  const exchanged = await call(api, { method: "POST", pathname: "/api/oauth/token", body: token });
  expect(exchanged.status).toBe(200);
  expect(json(exchanged)).toMatchObject({ token_type: "Bearer", scope: "code:read" });
  expect((await call(api, { method: "POST", pathname: "/api/oauth/token", body: token })).status).toBe(400);
});

test("an unknown grant type and a non-object body are refused", async () => {
  const api = backend("bad-input");
  expect((await call(api, { method: "POST", pathname: "/api/oauth/token", body: { grant_type: "password" } })).status).toBe(400);
  expect((await call(api, { method: "POST", pathname: "/api/oauth/token", body: ["x"] })).status).toBe(400);
  expect((await call(api, { method: "POST", pathname: "/api/oauth/token", body: { grant_type: "password", status: 200 } })).status).toBe(400);
});

test("SQLite restart and HTTP refresh rotation preserve the original grant expiry", async () => {
  let now = 1_000;
  let api = backend("refresh-expiry", () => now);
  const created = await call(api, { method: "POST", pathname: "/api/oauth/apps", body: { name: "App", redirectUris: [REDIRECT], scopes: ["code:read"] }, userId: "u" });
  const clientId = json(created).clientId as string;
  const authorized = await call(api, { method: "POST", pathname: "/api/oauth/authorize", body: { clientId, redirectUri: REDIRECT, scope: "code:read", codeChallenge: CHALLENGE }, userId: "u" });
  const exchanged = await call(api, { method: "POST", pathname: "/api/oauth/token", body: { grant_type: "authorization_code", code: json(authorized).code, clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER } });
  expect(exchanged.status).toBe(200);

  now += OAUTH_REFRESH_TTL_MS - 1;
  api = backend("refresh-expiry", () => now);
  const rotated = await call(api, { method: "POST", pathname: "/api/oauth/token", body: { grant_type: "refresh_token", refreshToken: json(exchanged).refresh_token, clientId } });
  expect(rotated.status).toBe(200);
  expect(json(rotated).expires_in).toBe(0);
  const accessToken = json(rotated).access_token as string;
  expect((await api.oauth.introspect(accessToken)).active).toBe(true);

  now += 1;
  api = backend("refresh-expiry", () => now);
  expect(await api.oauth.introspect(accessToken)).toEqual({ active: false });
  const expired = await call(api, { method: "POST", pathname: "/api/oauth/token", body: { grant_type: "refresh_token", refreshToken: json(rotated).refresh_token, clientId } });
  expect(expired.status).toBe(400);
  expect(json(expired)).toMatchObject({ error: "Refresh token has expired" });
});

test("malformed URL escapes in registry names, versions and file paths return 400", async () => {
  const api = backend("malformed-url");
  for (const pathname of ["/api/registry/%", "/api/registry/widget/%GG", "/api/registry/widget/1.0.0/files/%E0%A4%A", "/api/registry/%FF/resolve"]) {
    const reply = await call(api, { method: "GET", pathname });
    expect(reply.status).toBe(400);
    expect(json(reply)).toEqual({ error: "Invalid URL encoding" });
  }
});

test("a body containing a status key cannot choose the HTTP reply", async () => {
  const api = backend("status-key");
  const reply = await call(api, { method: "POST", pathname: "/api/oauth/revoke", body: { token: "x", status: 418 } });
  expect(reply.status).toBe(200);
});

test("publishing needs a session and records the session user as owner; visibility follows it", async () => {
  const api = backend("registry");
  const files = { "index.ts": "export const a = 1;\n" };
  expect((await call(api, { method: "POST", pathname: "/api/registry/widget/1.0.0", body: { files } })).status).toBe(401);
  expect((await call(api, { method: "POST", pathname: "/api/registry/widget/1.0.0", body: { files }, userId: "acme" })).status).toBe(201);
  expect((await call(api, { method: "POST", pathname: "/api/registry/secret/1.0.0", body: { files, private: true }, userId: "acme" })).status).toBe(201);

  expect((await call(api, { method: "GET", pathname: "/api/registry/widget" })).status).toBe(200);
  expect((await call(api, { method: "GET", pathname: "/api/registry/secret" })).status).toBe(404);
  expect((await call(api, { method: "GET", pathname: "/api/registry/secret", userId: "acme" })).status).toBe(200);
  expect((await call(api, { method: "GET", pathname: "/api/registry/secret", userId: "mallory" })).status).toBe(404);
});

test("file fetch returns text and resolve picks the highest matching version", async () => {
  const api = backend("fetch");
  await call(api, { method: "POST", pathname: "/api/registry/widget/1.0.0", body: { files: { "lib/a.ts": "one" } }, userId: "acme" });
  await call(api, { method: "POST", pathname: "/api/registry/widget/1.2.0", body: { files: { "lib/a.ts": "two" } }, userId: "acme" });
  const fetched = await call(api, { method: "GET", pathname: "/api/registry/widget/1.2.0/files/lib/a.ts" });
  expect(fetched).toMatchObject({ status: 200, contentType: "text/plain; charset=utf-8", body: "two" });
  const resolved = await call(api, { method: "GET", pathname: "/api/registry/widget/resolve", search: "?range=1.x" });
  expect(json(resolved)).toMatchObject({ version: "1.2.0" });
});

test("deprecation needs a session and the owner; unknown resources are 404", async () => {
  const api = backend("deprecate");
  await call(api, { method: "POST", pathname: "/api/registry/widget/1.0.0", body: { files: { "a.ts": "a" } }, userId: "acme" });
  expect((await call(api, { method: "POST", pathname: "/api/registry/widget/1.0.0/deprecate", body: { message: "old" } })).status).toBe(401);
  expect((await call(api, { method: "POST", pathname: "/api/registry/widget/1.0.0/deprecate", body: { message: "old" }, userId: "mallory" })).status).toBe(403);
  expect((await call(api, { method: "POST", pathname: "/api/registry/widget/1.0.0/deprecate", body: { message: "old" }, userId: "acme" })).status).toBe(200);
  expect((await call(api, { method: "GET", pathname: "/api/nothing/here" })).status).toBe(404);
});


test("malformed private visibility cannot accidentally publish publicly", async () => {
  const api = backend("malformed-private");
  for (const privateValue of ["true", 1, null, {}, []]) {
    expect((await call(api, {method: "POST", pathname: "/api/registry/secret/1.0.0", userId: "acme", body: {files: {"index.ts": "secret"}, private: privateValue}})).status).toBe(400);
  }
  expect((await call(api, {method: "GET", pathname: "/api/registry/secret"})).status).toBe(404);
});
