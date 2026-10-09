import {expect, test} from "bun:test";
import {validateAuthorizationRequest, type AuthorizationRequest} from "../src/core/oauth-scopes";

const client = {clientId: "app", redirectUris: ["https://app.example/cb"]};
const valid: AuthorizationRequest = {
  clientId: "app",
  redirectUri: "https://app.example/cb",
  scope: "code:read issues:write code:read",
  codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  codeChallengeMethod: "S256",
};

test("a valid request returns deduplicated scopes", () => {
  expect(validateAuthorizationRequest(client, valid)).toEqual({ok: true, scopes: ["code:read", "issues:write"], redirectUri: "https://app.example/cb"});
});

test("redirect URI must match exactly", () => {
  for (const redirectUri of ["https://app.example/cb/", "https://app.example/cb?x=1", "https://evil.example/cb", undefined]) {
    expect(validateAuthorizationRequest(client, {...valid, redirectUri}).ok).toBe(false);
  }
});

test("unknown or missing scopes are refused", () => {
  expect(validateAuthorizationRequest(client, {...valid, scope: "code:read admin:write"})).toEqual({ok: false, error: "Unknown scope admin:write"});
  expect(validateAuthorizationRequest(client, {...valid, scope: ""}).ok).toBe(false);
});

test("PKCE S256 is required", () => {
  expect(validateAuthorizationRequest(client, {...valid, codeChallengeMethod: "plain"}).ok).toBe(false);
  expect(validateAuthorizationRequest(client, {...valid, codeChallengeMethod: undefined}).ok).toBe(false);
  expect(validateAuthorizationRequest(client, {...valid, codeChallenge: "short"}).ok).toBe(false);
  expect(validateAuthorizationRequest(client, {...valid, clientId: "other"}).ok).toBe(false);
});
