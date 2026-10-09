/** F14 slice: OAuth authorization request validation. Redirect URIs match exactly, only known scopes are granted, and PKCE S256 is required. */

export const OAUTH_SCOPES = ["issues:read", "issues:write", "code:read", "code:write", "reviews:read", "reviews:write", "checks:read", "checks:write"] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export interface OAuthClient {
  readonly clientId: string;
  readonly redirectUris: readonly string[];
}

export interface AuthorizationRequest {
  readonly clientId?: string;
  readonly redirectUri?: string;
  /** Space-separated scope list. */
  readonly scope?: string;
  readonly codeChallenge?: string;
  readonly codeChallengeMethod?: string;
}

export type AuthorizationValidation =
  | {readonly ok: true; readonly scopes: OAuthScope[]; readonly redirectUri: string}
  | {readonly ok: false; readonly error: string};

const fail = (error: string): AuthorizationValidation => ({ok: false, error});
// RFC 7636: the S256 challenge is a base64url SHA-256 digest, 43 characters.
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function validateAuthorizationRequest(client: OAuthClient, request: AuthorizationRequest): AuthorizationValidation {
  if (request.clientId !== client.clientId) return fail("Unknown client");
  if (request.redirectUri === undefined || !client.redirectUris.includes(request.redirectUri)) return fail("Redirect URI does not exactly match a registered URI");
  const requested = (request.scope ?? "").split(" ").filter((scope) => scope.length > 0);
  if (requested.length === 0) return fail("At least one scope is required");
  for (const scope of requested) if (!OAUTH_SCOPES.includes(scope as OAuthScope)) return fail(`Unknown scope ${scope}`);
  if (request.codeChallengeMethod !== "S256") return fail("PKCE with code_challenge_method S256 is required");
  if (request.codeChallenge === undefined || !S256_CHALLENGE.test(request.codeChallenge)) return fail("A valid S256 code challenge is required");
  return {ok: true, scopes: [...new Set(requested)] as OAuthScope[], redirectUri: request.redirectUri};
}
