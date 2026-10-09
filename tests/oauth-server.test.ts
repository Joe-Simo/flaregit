import {expect, test} from "bun:test";
import {createOAuthServer, OAUTH_ACCESS_TTL_MS, OAUTH_CODE_TTL_MS, OAUTH_REFRESH_TTL_MS, type AuthorizeRequest, type MemoryOAuthStore, type OAuthServer, type TokenPair} from "../src/core/oauth-server";

// RFC 7636 appendix B: the challenge is base64url(SHA-256(verifier)).
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const REDIRECT = "https://app.example/cb";
const START = 1_800_000_000_000;

function setup() {
  let now = START;
  const server = createOAuthServer({clock: () => now});
  const registered = server.registerApp({name: "Test app", redirectUris: [REDIRECT], scopes: ["code:read", "issues:write"]});
  if (!registered.ok) throw new Error(registered.error);
  return {server, clientId: registered.clientId, advance: (ms: number) => void (now += ms)};
}

function authorize(server: OAuthServer, clientId: string, overrides: Partial<AuthorizeRequest> = {}) {
  return server.authorize({
    clientId,
    redirectUri: REDIRECT,
    scope: "code:read issues:write",
    codeChallenge: CHALLENGE,
    codeChallengeMethod: "S256",
    userId: "user-1",
    state: "xyz",
    ...overrides,
  });
}

async function codeFor(server: OAuthServer, clientId: string): Promise<string> {
  const authorized = await authorize(server, clientId);
  if (!authorized.ok) throw new Error(authorized.error);
  return authorized.code;
}

async function issueTokens(server: OAuthServer, clientId: string): Promise<TokenPair> {
  const code = await codeFor(server, clientId);
  const issued = await server.exchange({code, clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER});
  if (!issued.ok) throw new Error(issued.error);
  return issued;
}

test("app registration accepts https and loopback http and refuses other redirects and scopes", () => {
  const server = createOAuthServer();
  expect(server.registerApp({name: "Ok", redirectUris: [REDIRECT, "http://localhost:3000/cb", "http://127.0.0.1:8080/cb"], scopes: ["code:read"]}).ok).toBe(true);
  for (const redirectUri of ["http://app.example/cb", "https://app.example/cb#fragment", "https://user:password@app.example/cb", "ftp://app.example/cb", "not a url"]) {
    expect(server.registerApp({name: "Bad", redirectUris: [redirectUri], scopes: ["code:read"]}).ok).toBe(false);
  }
  expect(server.registerApp({name: "Bad", redirectUris: [REDIRECT], scopes: ["admin:write"]})).toEqual({ok: false, error: "Unknown scope admin:write"});
  expect(server.registerApp({name: "Bad", redirectUris: [REDIRECT], scopes: []}).ok).toBe(false);
  expect(server.registerApp({name: "  ", redirectUris: [REDIRECT], scopes: ["code:read"]}).ok).toBe(false);
});

test("authorization refuses unknown clients, inexact redirects, unknown or over-requested scopes, and missing PKCE", async () => {
  const {server, clientId} = setup();
  expect((await authorize(server, "unknown-client")).ok).toBe(false);
  for (const redirectUri of ["https://app.example/cb/", "https://app.example/cb?x=1", "https://evil.example/cb"]) {
    expect((await authorize(server, clientId, {redirectUri})).ok).toBe(false);
  }
  expect(await authorize(server, clientId, {scope: "code:read admin:write"})).toEqual({ok: false, error: "Unknown scope admin:write"});
  // reviews:read is a known scope, but this app never registered it.
  expect(await authorize(server, clientId, {scope: "reviews:read"})).toEqual({ok: false, error: "Scope reviews:read was not registered for this app"});
  expect((await authorize(server, clientId, {codeChallengeMethod: "plain"})).ok).toBe(false);
  expect((await authorize(server, clientId, {codeChallenge: undefined, codeChallengeMethod: undefined})).ok).toBe(false);
});

test("happy path exchanges a real S256 verifier for tokens that introspect as active", async () => {
  const {server, clientId} = setup();
  const authorized = await authorize(server, clientId, {scope: "code:read issues:write code:read"});
  if (!authorized.ok) throw new Error(authorized.error);
  const redirect = new URL(authorized.redirectTo);
  expect(redirect.origin + redirect.pathname).toBe(REDIRECT);
  expect(redirect.searchParams.get("code")).toBe(authorized.code);
  expect(redirect.searchParams.get("state")).toBe("xyz");

  const issued = await server.exchange({code: authorized.code, clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER});
  if (!issued.ok) throw new Error(issued.error);
  expect(issued.scopes).toEqual(["code:read", "issues:write"]);
  expect(issued.expiresIn).toBe(3600);
  expect(await server.introspect(issued.accessToken)).toEqual({active: true, scopes: ["code:read", "issues:write"], userId: "user-1", clientId, repositoryId: undefined, expiresAt:START+OAUTH_ACCESS_TTL_MS});
});

test("a replayed code is refused and revokes the tokens already issued from it", async () => {
  const {server, clientId} = setup();
  const code = await codeFor(server, clientId);
  const first = await server.exchange({code, clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER});
  if (!first.ok) throw new Error(first.error);
  expect(await server.exchange({code, clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER})).toEqual({ok: false, error: "Authorization code has already been used"});
  expect(await server.introspect(first.accessToken)).toEqual({active: false});
});

test("a wrong or malformed code verifier is refused", async () => {
  const {server, clientId} = setup();
  const code = await codeFor(server, clientId);
  expect(await server.exchange({code, clientId, redirectUri: REDIRECT, codeVerifier: "A".repeat(43)})).toEqual({ok: false, error: "PKCE verification failed"});
  expect((await server.exchange({code, clientId, redirectUri: REDIRECT, codeVerifier: "short"})).ok).toBe(false);
});

test("a code is accepted until ten minutes after issue and refused from that moment on", async () => {
  const {server, clientId, advance} = setup();
  const early = await codeFor(server, clientId);
  const late = await codeFor(server, clientId);
  advance(OAUTH_CODE_TTL_MS - 1);
  expect((await server.exchange({code: early, clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER})).ok).toBe(true);
  advance(1);
  expect(await server.exchange({code: late, clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER})).toEqual({ok: false, error: "Authorization code has expired"});
});

test("the exchange redirect URI and client must match the authorization", async () => {
  const {server, clientId} = setup();
  const code = await codeFor(server, clientId);
  expect(await server.exchange({code, clientId, redirectUri: "https://app.example/other", codeVerifier: VERIFIER})).toEqual({
    ok: false,
    error: "Redirect URI does not match the authorization request",
  });
  expect((await server.exchange({code, clientId: "other-client", redirectUri: REDIRECT, codeVerifier: VERIFIER})).ok).toBe(false);
});

test("refresh rotates the refresh token, and reuse of an old one revokes the grant family", async () => {
  const {server, clientId} = setup();
  const issued = await issueTokens(server, clientId);
  const rotated = await server.refresh({refreshToken: issued.refreshToken, clientId});
  if (!rotated.ok) throw new Error(rotated.error);
  expect(rotated.refreshToken).not.toBe(issued.refreshToken);
  expect(rotated.accessToken).not.toBe(issued.accessToken);
  expect(await server.introspect(rotated.accessToken)).toMatchObject({active: true, userId: "user-1"});

  // Presenting the already-rotated token again is treated as theft.
  expect(await server.refresh({refreshToken: issued.refreshToken, clientId})).toEqual({
    ok: false,
    error: "Refresh token reuse detected; the grant has been revoked",
  });
  expect(await server.refresh({refreshToken: rotated.refreshToken, clientId})).toEqual({ok: false, error: "Grant has been revoked"});
  expect(await server.introspect(rotated.accessToken)).toEqual({active: false});
  expect(await server.introspect(issued.accessToken)).toEqual({active: false});
});

test("refresh refuses a token presented by a different client", async () => {
  const {server, clientId} = setup();
  const issued = await issueTokens(server, clientId);
  expect((await server.refresh({refreshToken: issued.refreshToken, clientId: "other-client"})).ok).toBe(false);
  expect((await server.refresh({refreshToken: issued.refreshToken, clientId})).ok).toBe(true);
});

test("revoke ends access and refresh tokens for the grant", async () => {
  const {server, clientId} = setup();
  const byAccess = await issueTokens(server, clientId);
  await server.revoke(byAccess.accessToken);
  expect(await server.introspect(byAccess.accessToken)).toEqual({active: false});
  expect((await server.refresh({refreshToken: byAccess.refreshToken, clientId})).ok).toBe(false);

  const byRefresh = await issueTokens(server, clientId);
  await server.revoke(byRefresh.refreshToken);
  expect(await server.introspect(byRefresh.accessToken)).toEqual({active: false});
  expect((await server.refresh({refreshToken: byRefresh.refreshToken, clientId})).ok).toBe(false);

  // Unknown tokens are ignored rather than reported, as RFC 7009 requires.
  await server.revoke("not-a-token");
});

test("access tokens are active for one hour and inactive after", async () => {
  const {server, clientId, advance} = setup();
  const issued = await issueTokens(server, clientId);
  advance(OAUTH_ACCESS_TTL_MS - 1);
  expect(await server.introspect(issued.accessToken)).toMatchObject({active: true});
  advance(1);
  expect(await server.introspect(issued.accessToken)).toEqual({active: false});
});

test("concurrent exchanges of one code cannot both succeed", async () => {
  const {server, clientId} = setup();
  const code = await codeFor(server, clientId);
  const attempt = () => server.exchange({code, clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER});
  const results = await Promise.all([attempt(), attempt()]);
  // A concurrent replay revokes the issued grant; the first attempt may observe that revocation before returning.
  expect(results.filter((result) => result.ok).length).toBeLessThanOrEqual(1);
  expect(results.some(result => !result.ok && result.error.includes("already been used"))).toBe(true);
});

test("codes, access tokens and refresh tokens are stored only as SHA-256 digests", async () => {
  const {server, clientId} = setup();
  const code = await codeFor(server, clientId);
  const issued = await server.exchange({code, clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER});
  if (!issued.ok) throw new Error(issued.error);
  const rotated = await server.refresh({refreshToken: issued.refreshToken, clientId});
  if (!rotated.ok) throw new Error(rotated.error);

  const dump = JSON.stringify(server.store, (_key, value) => (value instanceof Map ? [...value.entries()] : value));
  for (const secret of [code, issued.accessToken, issued.refreshToken, rotated.accessToken, rotated.refreshToken]) {
    expect(dump).not.toContain(secret);
  }

  const digest = async (value: string) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64url");
  const memory = server.store as MemoryOAuthStore;
  expect(memory.codes.has(await digest(code))).toBe(true);
  expect(memory.accessTokens.has(await digest(issued.accessToken))).toBe(true);
  expect(memory.accessTokens.has(await digest(rotated.accessToken))).toBe(true);
  expect(memory.refreshTokens.has(await digest(issued.refreshToken))).toBe(true);
  expect(memory.refreshTokens.has(await digest(rotated.refreshToken))).toBe(true);
  expect(memory.accessTokens.size).toBe(2);
});


test("refresh rotation preserves the absolute expiry and expires the whole grant", async () => {
  const {server, clientId, advance} = setup();
  const issued = await issueTokens(server, clientId);
  advance(OAUTH_REFRESH_TTL_MS - 1);
  const rotated = await server.refresh({refreshToken: issued.refreshToken, clientId});
  if (!rotated.ok) throw new Error(rotated.error);
  expect(rotated.expiresIn).toBe(0);
  expect(await server.introspect(rotated.accessToken)).toMatchObject({active: true});
  advance(1);
  expect(await server.introspect(rotated.accessToken)).toEqual({active: false});
  expect(await server.refresh({refreshToken: rotated.refreshToken, clientId})).toEqual({ok: false, error: "Refresh token has expired"});
});

test("persisted unbounded refresh grants require fresh authorization", async () => {
  const {server, clientId} = setup();
  const issued = await issueTokens(server, clientId);
  const memory = server.store as MemoryOAuthStore;
  for (const [key, grant] of memory.grants) {
    const {expiresAt: _expiresAt, ...legacy} = grant;
    memory.grants.set(key, legacy);
  }
  expect(await server.introspect(issued.accessToken)).toEqual({active: false});
  expect(await server.refresh({refreshToken: issued.refreshToken, clientId})).toEqual({ok: false, error: "Refresh token has expired"});
});

test("inactive accounts cannot authorize, exchange, refresh or expose introspected identity", async () => {
  let active = true;
  const server = createOAuthServer({isUserActive: async () => active});
  const app = server.registerApp({name: "Lifecycle", redirectUris: [REDIRECT], scopes: ["code:read", "issues:write"]});
  if (!app.ok) throw Error(app.error);
  const pair = await issueTokens(server, app.clientId);
  const pending = await codeFor(server, app.clientId);
  active = false;
  expect((await authorize(server, app.clientId)).ok).toBe(false);
  expect((await server.exchange({code: pending, clientId: app.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER})).ok).toBe(false);
  expect(await server.introspect(pair.accessToken)).toEqual({active: false});
  expect((await server.refresh({refreshToken: pair.refreshToken, clientId: app.clientId})).ok).toBe(false);
  active = true;
  expect(await server.introspect(pair.accessToken)).toEqual({active: false});
});

test("lifecycle awaits preserve code single-use and refresh reuse revocation", async () => {
  const server = createOAuthServer({isUserActive: async () => {await Promise.resolve(); return true;}});
  const app = server.registerApp({name: "Concurrent", redirectUris: [REDIRECT], scopes: ["code:read", "issues:write"]});
  if (!app.ok) throw Error(app.error);
  const code = await codeFor(server, app.clientId);
  const exchanged = await Promise.all([1,2].map(() => server.exchange({code, clientId: app.clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER})));
  expect(exchanged.filter(value => value.ok).length).toBeLessThanOrEqual(1);
  const pair = await issueTokens(server, app.clientId);
  const rotated = await Promise.all([1,2].map(() => server.refresh({refreshToken: pair.refreshToken, clientId: app.clientId})));
  expect(rotated.filter(value => value.ok).length).toBeLessThanOrEqual(1);
  expect(await server.introspect(pair.accessToken)).toEqual({active: false});
});

test('observed membership revocation permanently ends an installed grant even after membership returns', async () => {
  let member = true;
  const server = createOAuthServer({canAccessRepository: async () => member});
  const app = server.registerApp({name: 'Issues integration', redirectUris: [REDIRECT], scopes: ['issues:read']});
  if (!app.ok) throw Error(app.error);
  const request = {repositoryId:'p123456789abc',scope:'issues:read'};
  const authorization = await authorize(server, app.clientId, request);
  if (!authorization.ok) throw Error(authorization.error);
  const pair = await server.exchange({code:authorization.code,clientId:app.clientId,redirectUri:REDIRECT,codeVerifier:VERIFIER});
  if (!pair.ok) throw Error(pair.error);
  expect(await server.introspect(pair.accessToken)).toMatchObject({active:true,repositoryId:request.repositoryId});
  member = false;
  expect(await server.introspect(pair.accessToken)).toEqual({active:false});
  expect((await authorize(server, app.clientId, request)).ok).toBe(false);
  member = true;
  expect(await server.introspect(pair.accessToken)).toEqual({active:false});
  expect((await server.refresh({refreshToken:pair.refreshToken,clientId:app.clientId})).ok).toBe(false);
  expect(await server.installations('user-1',request.repositoryId)).toEqual([]);
  expect((await authorize(server, app.clientId, request)).ok).toBe(true);
});

test('temporary membership lookup failure denies access without consuming installation authority', async () => {
 let unavailable = false;
 const server = createOAuthServer({canAccessRepository: async () => {if(unavailable)throw Error('Transport unavailable');return true;}});
 const app=server.registerApp({name:'Lookup recovery',redirectUris:[REDIRECT],scopes:['issues:read']});
 if(!app.ok)throw Error(app.error);
 const code=await authorize(server,app.clientId,{repositoryId:'p123456789abc',scope:'issues:read'});
 if(!code.ok)throw Error(code.error);
 const pair=await server.exchange({code:code.code,clientId:app.clientId,redirectUri:REDIRECT,codeVerifier:VERIFIER});
 if(!pair.ok)throw Error(pair.error);
 unavailable=true;
 expect(await server.introspect(pair.accessToken)).toEqual({active:false});
 expect((await server.refresh({refreshToken:pair.refreshToken,clientId:app.clientId})).ok).toBe(false);
 unavailable=false;
 expect(await server.introspect(pair.accessToken)).toMatchObject({active:true});
 expect((await server.refresh({refreshToken:pair.refreshToken,clientId:app.clientId})).ok).toBe(true);
});
