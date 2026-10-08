/** F14 slice: in-memory OAuth authorization server. Codes and tokens are random and stored only as SHA-256 digests; codes are single-use, refresh tokens rotate, and reuse of a rotated refresh token revokes the grant. */

import {OAUTH_SCOPES, validateAuthorizationRequest, type OAuthScope} from "./oauth-scopes";

export const OAUTH_CODE_TTL_MS = 10 * 60 * 1000;
export const OAUTH_ACCESS_TTL_MS = 60 * 60 * 1000;
/** Absolute authorization lifetime: rotation never extends this window. */
export const OAUTH_REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const encoder = new TextEncoder();
// RFC 7636 section 4.1: 43 to 128 unreserved characters.
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

export interface AppRecord {
  readonly clientId: string;
  readonly name: string;
  readonly redirectUris: readonly string[];
  readonly scopes: readonly OAuthScope[];
}

export interface CodeRecord {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly userId: string;
  readonly scopes: readonly OAuthScope[];
  readonly repositoryId?: string;
  readonly codeChallenge: string;
  readonly expiresAt: number;
  used: boolean;
  grantId?: string;
}

export interface GrantRecord {
  readonly id: string;
  readonly clientId: string;
  readonly userId: string;
  readonly scopes: readonly OAuthScope[];
  readonly repositoryId?: string;
  readonly expiresAt?: number;
  revoked: boolean;
}

export interface AccessTokenRecord {
  readonly grantId: string;
  readonly expiresAt: number;
}

export interface RefreshTokenRecord {
  readonly grantId: string;
  readonly expiresAt?: number;
  consumed: boolean;
}

/** Codes and tokens are keyed by the base64url SHA-256 digest of the secret, so no raw secret rests in the store. */
/** The only operations the server needs. A Map satisfies it; so does a durable store. Every change must be written back with `set`. */
export interface KeyValue<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): unknown;
  values(): Iterable<V>;
}

export interface OAuthStore {
  readonly apps: KeyValue<AppRecord>;
  readonly codes: KeyValue<CodeRecord>;
  readonly grants: KeyValue<GrantRecord>;
  readonly accessTokens: KeyValue<AccessTokenRecord>;
  readonly refreshTokens: KeyValue<RefreshTokenRecord>;
}

export interface MemoryOAuthStore {
  readonly apps: Map<string, AppRecord>;
  readonly codes: Map<string, CodeRecord>;
  readonly grants: Map<string, GrantRecord>;
  readonly accessTokens: Map<string, AccessTokenRecord>;
  readonly refreshTokens: Map<string, RefreshTokenRecord>;
}

/** Creates the default in-memory store. Pass a durable store to `createOAuthServer` to keep state across restarts. */
export function createMemoryOAuthStore(): MemoryOAuthStore {
  return {apps: new Map(), codes: new Map(), grants: new Map(), accessTokens: new Map(), refreshTokens: new Map()};
}

export type OAuthResult<T> = ({readonly ok: true} & T) | {readonly ok: false; readonly error: string};

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly scopes: OAuthScope[];
}

export type IntrospectionResult =
  | {readonly active: true; readonly scopes: OAuthScope[]; readonly userId: string; readonly clientId: string; readonly repositoryId?: string; readonly expiresAt: number}
  | {readonly active: false};

export interface RegisterAppRequest {
  readonly name: string;
  readonly redirectUris: readonly string[];
  readonly scopes: readonly string[];
}

export interface AuthorizeRequest {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scope: string;
  readonly codeChallenge?: string;
  readonly codeChallengeMethod?: string;
  readonly userId: string;
  readonly state?: string;
  readonly repositoryId?: string;
}

export interface ExchangeRequest {
  readonly code: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
}

export interface RefreshRequest {
  readonly refreshToken: string;
  readonly clientId: string;
}

export interface OAuthServer {
  readonly store: OAuthStore;
  registerApp(request: RegisterAppRequest): OAuthResult<{readonly clientId: string}>;
  authorize(request: AuthorizeRequest): Promise<OAuthResult<{readonly code: string; readonly redirectTo: string}>>;
  exchange(request: ExchangeRequest): Promise<OAuthResult<TokenPair>>;
  refresh(request: RefreshRequest): Promise<OAuthResult<TokenPair>>;
  /** Revokes the grant behind an access or refresh token. Unknown tokens are ignored, as RFC 7009 requires. */
  revoke(token: string): Promise<void>;
  app(clientId: string): AppRecord | undefined;
  installations(userId: string, repositoryId: string): Promise<readonly Pick<GrantRecord,"id"|"clientId"|"scopes"|"expiresAt"|"repositoryId">[]>;
  uninstall(userId: string, repositoryId: string, grantId: string): boolean;
  introspect(accessToken: string): Promise<IntrospectionResult>;
}

export interface OAuthServerOptions {
  /** Milliseconds since the epoch. Injected so expiry can be tested. */
  readonly clock?: () => number;
  /** Production authority must resolve current account lifecycle; failures deny authorization. */
  readonly isUserActive?: (userId: string) => Promise<boolean>;
  readonly canAccessRepository?: (userId: string, repositoryId: string) => Promise<boolean>;
  readonly store?: OAuthStore;
}

const fail = (error: string) => ({ok: false, error}) as const;

const isOAuthScope = (value: string): value is OAuthScope => (OAUTH_SCOPES as readonly string[]).includes(value);

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

/** Random bytes from the Web Crypto CSPRNG, base64url encoded. */
const randomToken = (byteLength: number): string => toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));

const digest = async (value: string): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));

/** Web Crypto has no timingSafeEqual, so every byte is compared before the result is decided. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

const storeKey = async (secret: string): Promise<string> => toBase64Url(await digest(secret));

/** Redirect URIs must be https, or http on a loopback host, and must not carry a fragment (RFC 6749 section 3.1.2). */
function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash !== "") return false;
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

export function createOAuthServer(options: OAuthServerOptions = {}): OAuthServer {
  const clock = options.clock ?? (() => Date.now());
  const store: OAuthStore = options.store ?? createMemoryOAuthStore();

  const isUserActive = async (userId: string): Promise<boolean | null> => {
    try { return await (options.isUserActive?.(userId) ?? Promise.resolve(true)); } catch { return null; }
  };
  const repositoryActive = async (userId: string, repositoryId?: string): Promise<boolean | null> => {
    if (repositoryId === undefined) return true;
    try { return /^[a-z0-9]{12,16}$/.test(repositoryId) && await (options.canAccessRepository?.(userId, repositoryId) ?? Promise.resolve(false)); } catch { return null; }
  };
  const grantActive = (grant: GrantRecord): boolean => !grant.revoked && grant.expiresAt !== undefined && Number.isFinite(grant.expiresAt) && clock() < grant.expiresAt;
  async function issuedResult(grant: GrantRecord, now: number): Promise<OAuthResult<TokenPair>> {
    const pair = await issueTokens(grant, now);
    if (!await isUserActive(grant.userId) || !await repositoryActive(grant.userId, grant.repositoryId)) { revokeGrant(grant.id); return fail("Account is unavailable"); }
    const fresh = store.grants.get(grant.id);
    if (!fresh || !grantActive(fresh) || fresh.userId !== grant.userId) return fail("Grant is no longer active");
    return {ok: true, ...pair};
  }

  // Raw tokens are returned to the caller once and only their digests are kept.
  async function issueTokens(grant: GrantRecord, now: number): Promise<TokenPair> {
    const accessToken = "fgo_" + randomToken(32);
    const refreshToken = randomToken(32);
    const expiresAt = Math.min(now + OAUTH_ACCESS_TTL_MS, grant.expiresAt ?? now);
    store.accessTokens.set(await storeKey(accessToken), {grantId: grant.id, expiresAt});
    store.refreshTokens.set(await storeKey(refreshToken), {grantId: grant.id, expiresAt: grant.expiresAt, consumed: false});
    return {accessToken, refreshToken, expiresIn: Math.max(0, Math.floor((expiresAt - now) / 1000)), scopes: [...grant.scopes]};
  }

  const revokeGrant = (grantId: string): void => {
    const grant = store.grants.get(grantId);
    if (grant !== undefined) {
      grant.revoked = true;
      store.grants.set(grantId, grant);
    }
  };

  return {
    store,

    registerApp(request) {
      const name = request.name.trim();
      if (name.length === 0) return fail("App name is required");
      if (request.redirectUris.length === 0) return fail("At least one redirect URI is required");
      for (const uri of request.redirectUris) if (!isAllowedRedirectUri(uri)) return fail(`Redirect URI ${uri} must use https, or http on localhost`);
      if (request.scopes.length === 0) return fail("At least one scope is required");
      for (const scope of request.scopes) if (!isOAuthScope(scope)) return fail(`Unknown scope ${scope}`);
      const clientId = randomToken(16);
      store.apps.set(clientId, {
        clientId,
        name,
        redirectUris: [...new Set(request.redirectUris)],
        scopes: [...new Set(request.scopes)] as OAuthScope[],
      });
      return {ok: true, clientId};
    },

    async authorize(request) {
      const app = store.apps.get(request.clientId);
      if (app === undefined) return fail("Unknown client");
      const validation = validateAuthorizationRequest({clientId: app.clientId, redirectUris: app.redirectUris}, request);
      if (!validation.ok) return fail(validation.error);
      if (request.codeChallenge === undefined) return fail("A valid S256 code challenge is required");
      if (request.userId.trim() === "") return fail("A signed-in user is required");
      const unregistered = validation.scopes.find((scope) => !app.scopes.includes(scope));
      if (unregistered !== undefined) return fail(`Scope ${unregistered} was not registered for this app`);

      const code = randomToken(32);
      const codeKey = await storeKey(code);
      if (!await isUserActive(request.userId) || !await repositoryActive(request.userId, request.repositoryId)) return fail("Account is unavailable");
      if (JSON.stringify(store.apps.get(request.clientId)) !== JSON.stringify(app)) return fail("App authorization changed");
      store.codes.set(codeKey, {
        clientId: app.clientId,
        redirectUri: validation.redirectUri,
        userId: request.userId,
        repositoryId: request.repositoryId,
        scopes: validation.scopes,
        codeChallenge: request.codeChallenge,
        expiresAt: clock() + OAUTH_CODE_TTL_MS,
        used: false,
      });
      const redirect = new URL(validation.redirectUri);
      redirect.searchParams.set("code", code);
      if (request.state !== undefined) redirect.searchParams.set("state", request.state);
      return {ok: true, code, redirectTo: redirect.toString()};
    },

    async exchange(request) {
      if (!CODE_VERIFIER.test(request.codeVerifier)) return fail("code_verifier must be 43 to 128 unreserved characters");
      // Hash everything asynchronously first, so the check-and-set below runs without an await in between.
      const codeKey = await storeKey(request.code);
      const verifierDigest = toBase64Url(await digest(request.codeVerifier));
      const initial = store.codes.get(codeKey);
      if (initial === undefined) return fail("Unknown authorization code");
      if (!await isUserActive(initial.userId) || !await repositoryActive(initial.userId, initial.repositoryId)) return fail("Account is unavailable");
      const now = clock();

      const record = store.codes.get(codeKey);
      if (record && record.userId !== initial.userId) return fail("Authorization code changed");
      if (record === undefined) return fail("Unknown authorization code");
      if (record.used) {
        // RFC 6749 section 4.1.2: a replayed code revokes the tokens already issued from it.
        if (record.grantId !== undefined) revokeGrant(record.grantId);
        return fail("Authorization code has already been used");
      }
      if (now >= record.expiresAt) return fail("Authorization code has expired");
      if (request.clientId !== record.clientId) return fail("Client does not match the authorization code");
      if (request.redirectUri !== record.redirectUri) return fail("Redirect URI does not match the authorization request");
      if (!timingSafeEqual(encoder.encode(verifierDigest), encoder.encode(record.codeChallenge))) return fail("PKCE verification failed");

      record.used = true;
      const grant: GrantRecord = {id: randomToken(16), clientId: record.clientId, userId: record.userId, scopes: record.scopes, repositoryId: record.repositoryId, expiresAt: now + OAUTH_REFRESH_TTL_MS, revoked: false};
      store.grants.set(grant.id, grant);
      record.grantId = grant.id;
      store.codes.set(codeKey, record);
      return issuedResult(grant, now);
    },

    async refresh(request) {
      const refreshKey = await storeKey(request.refreshToken);
      const initial = store.refreshTokens.get(refreshKey);
      const initialGrant = initial && store.grants.get(initial.grantId);
      if (!initialGrant) return fail("Unknown refresh token");
      const userActive = await isUserActive(initialGrant.userId);
      const repositoryAvailable = await repositoryActive(initialGrant.userId, initialGrant.repositoryId);
      if (!userActive || !repositoryAvailable) {
        if (userActive === false || repositoryAvailable === false) revokeGrant(initialGrant.id);
        return fail("Account is unavailable");
      }
      const record = store.refreshTokens.get(refreshKey);
      if (record && record.grantId !== initialGrant.id) return fail("Refresh token changed");
      if (record === undefined) return fail("Unknown refresh token");
      const grant = store.grants.get(record.grantId);
      if (grant === undefined) return fail("Unknown refresh token");
      if (grant.clientId !== request.clientId) return fail("Client does not match the refresh token");
      if (grant.revoked) return fail("Grant has been revoked");
      if (record.consumed) {
        // A rotated refresh token came back, so treat the whole grant family as compromised.
        grant.revoked = true;
        store.grants.set(grant.id, grant);
        return fail("Refresh token reuse detected; the grant has been revoked");
      }
      const now = clock();
      // Legacy persisted records without a bounded expiry require fresh authorization.
      if (record.expiresAt === undefined || grant.expiresAt === undefined || !Number.isFinite(record.expiresAt) || !Number.isFinite(grant.expiresAt) || now >= record.expiresAt || now >= grant.expiresAt) {
        revokeGrant(grant.id);
        return fail("Refresh token has expired");
      }
      // No await between the lookup and this write, so a rotated token cannot be spent twice.
      record.consumed = true;
      store.refreshTokens.set(refreshKey, record);
      return issuedResult(grant, now);
    },

    app(clientId) { const app = store.apps.get(clientId); return app ? {...app, scopes:[...app.scopes], redirectUris:[...app.redirectUris]} : undefined; },
    async installations(userId, repositoryId) { if (!await isUserActive(userId) || !await repositoryActive(userId, repositoryId)) return []; return [...store.grants.values()].filter(grant => grant.userId === userId && grant.repositoryId === repositoryId && grantActive(grant)).map(({id,clientId,scopes,expiresAt,repositoryId}) => ({id,clientId,scopes:[...scopes],expiresAt,repositoryId})); },
    uninstall(userId, repositoryId, grantId) { const grant = store.grants.get(grantId); if (!grant || grant.userId !== userId || grant.repositoryId !== repositoryId) return false; revokeGrant(grantId); return true; },
    async revoke(token) {
      const key = await storeKey(token);
      const grantId = store.accessTokens.get(key)?.grantId ?? store.refreshTokens.get(key)?.grantId;
      if (grantId !== undefined) revokeGrant(grantId);
    },

    async introspect(accessToken) {
      const key = await storeKey(accessToken);
      const initial = store.accessTokens.get(key);
      const initialGrant = initial && store.grants.get(initial.grantId);
      if (!initialGrant) return {active: false};
      const userActive = await isUserActive(initialGrant.userId);
      const repositoryAvailable = await repositoryActive(initialGrant.userId, initialGrant.repositoryId);
      if (!userActive || !repositoryAvailable) {
        if (userActive === false || repositoryAvailable === false) revokeGrant(initialGrant.id);
        return {active: false};
      }
      const record = store.accessTokens.get(key);
      const grant = record && store.grants.get(record.grantId);
      if (!record || !grant || grant.userId !== initialGrant.userId || !grantActive(grant) || clock() >= record.expiresAt) return {active: false};
      return {active: true, scopes: [...grant.scopes], userId: grant.userId, clientId: grant.clientId, repositoryId: grant.repositoryId, expiresAt: Math.min(record.expiresAt, grant.expiresAt!)};
    },
  };
}
