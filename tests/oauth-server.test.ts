import {expect, test} from "bun:test";
import {createOAuthServer, OAUTH_ACCESS_TTL_MS, OAUTH_CODE_TTL_MS, type AuthorizeRequest, type OAuthServer, type TokenPair} from "../src/core/oauth-server";

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
  for (const redirectUri of ["http://app.example/cb", "https://app.example/cb#fragment", "ftp://app.example/cb", "not a url"]) {
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
  expect(await server.introspect(issued.accessToken)).toEqual({active: true, scopes: ["code:read", "issues:write"], userId: "user-1", clientId});
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
  expect(results.filter((result) => result.ok)).toHaveLength(1);
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
  expect(server.store.codes.has(await digest(code))).toBe(true);
  expect(server.store.accessTokens.has(await digest(issued.accessToken))).toBe(true);
  expect(server.store.accessTokens.has(await digest(rotated.accessToken))).toBe(true);
  expect(server.store.refreshTokens.has(await digest(issued.refreshToken))).toBe(true);
  expect(server.store.refreshTokens.has(await digest(rotated.refreshToken))).toBe(true);
  expect(server.store.accessTokens.size).toBe(2);
});
