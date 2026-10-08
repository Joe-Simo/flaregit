/** HTTP mapping for the OAuth server and package registry. Pure: the caller supplies the parsed body and the verified session, so this runs without the Worker runtime. */
import type { OAuthServer } from "../core/oauth-server";
import type { PackageRegistry, Viewer } from "../core/package-registry";

export interface AuthorityBackend {
  readonly oauth: OAuthServer;
  readonly registry: PackageRegistry;
}

export interface AuthorityCall {
  readonly method: string;
  readonly pathname: string;
  readonly search: string;
  readonly body: unknown;
  /** Set only for a browser session. API tokens and anonymous callers leave it undefined. */
  readonly userId?: string;
}

export interface AuthorityReply {
  readonly status: number;
  readonly contentType: "application/json" | "text/plain; charset=utf-8";
  readonly body: string;
}

/** Largest accepted request body: a 10 MiB package plus JSON encoding overhead. */
export const AUTHORITY_MAX_BODY_BYTES = 11 * 1024 * 1024;

const json = (status: number, value: unknown): AuthorityReply => ({ status, contentType: "application/json", body: JSON.stringify(value) });
const failure = (status: number, error: string): AuthorityReply => json(status, { error });

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const asStrings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : null;

const RESOURCE = /^\/api\/registry\/([^/]+)(?:\/(resolve|([^/]+)(?:\/(deprecate|files\/(.+)))?))?$/;

export async function handleAuthorityCall(backend: AuthorityBackend, call: AuthorityCall): Promise<AuthorityReply> {
  const { method, pathname, body, userId } = call;
  const viewer: Viewer = { id: userId, memberOf: [] };
  const needsSession = (): AuthorityReply | null => (userId === undefined ? failure(401, "Sign in with a browser session to continue") : null);
  const badBody = failure(400, "Request body must be a JSON object");

  if (pathname === "/api/oauth/apps" && method === "POST") {
    const denied = needsSession();
    if (denied) return denied;
    const input = asObject(body);
    if (!input) return badBody;
    if (!("name" in input) || !asStrings(input.redirectUris) || !asStrings(input.scopes) || typeof input.name !== "string") {
      return failure(400, "An app needs a name, redirectUris and scopes");
    }
    const registered = backend.oauth.registerApp({ name: input.name, redirectUris: asStrings(input.redirectUris)!, scopes: asStrings(input.scopes)! });
    return registered.ok ? json(201, { clientId: registered.clientId }) : failure(400, registered.error);
  }

  if (pathname === "/api/oauth/authorize" && method === "POST") {
    const denied = needsSession();
    if (denied) return denied;
    const input = asObject(body);
    if (!input) return badBody;
    const authorized = await backend.oauth.authorize({
      clientId: String(input.clientId ?? ""),
      redirectUri: String(input.redirectUri ?? ""),
      scope: String(input.scope ?? ""),
      codeChallenge: String(input.codeChallenge ?? ""),
      codeChallengeMethod: "S256",
      userId: userId!,
      state: typeof input.state === "string" ? input.state : undefined,
    });
    return authorized.ok ? json(200, { code: authorized.code }) : failure(400, authorized.error);
  }

  if (pathname === "/api/oauth/token" && method === "POST") {
    const input = asObject(body);
    if (!input) return badBody;
    if (input.grant_type === "authorization_code") {
      const exchanged = await backend.oauth.exchange({
        code: String(input.code ?? ""),
        clientId: String(input.clientId ?? ""),
        redirectUri: String(input.redirectUri ?? ""),
        codeVerifier: String(input.codeVerifier ?? ""),
      });
      return exchanged.ok ? json(200, tokenBody(exchanged)) : failure(400, exchanged.error);
    }
    if (input.grant_type === "refresh_token") {
      const refreshed = await backend.oauth.refresh({ refreshToken: String(input.refreshToken ?? ""), clientId: String(input.clientId ?? "") });
      return refreshed.ok ? json(200, tokenBody(refreshed)) : failure(400, refreshed.error);
    }
    return failure(400, "grant_type must be authorization_code or refresh_token");
  }

  if (pathname === "/api/oauth/revoke" && method === "POST") {
    const input = asObject(body);
    if (!input) return badBody;
    if (typeof input.token !== "string" || input.token === "") return failure(400, "A token is required");
    await backend.oauth.revoke(input.token);
    return json(200, { ok: true });
  }

  const match = RESOURCE.exec(pathname);
  if (!match) return failure(404, "Not found");
  const name = decodeURIComponent(match[1]!);
  const tail = match[2];

  if (tail === undefined && method === "GET") {
    const metadata = backend.registry.metadata(name, viewer);
    return metadata.ok ? json(200, metadata.metadata) : failure(metadata.status, metadata.error);
  }

  if (tail === "resolve" && method === "GET") {
    const range = new URLSearchParams(call.search).get("range") ?? "";
    const resolved = backend.registry.resolve(name, range, viewer);
    return resolved.ok ? json(200, { version: resolved.version, integrity: resolved.integrity }) : failure(resolved.status, resolved.error);
  }

  const version = tail !== undefined && tail !== "resolve" ? decodeURIComponent(match[3]!) : undefined;
  const action = match[4];

  if (version !== undefined && action === undefined && method === "POST") {
    const denied = needsSession();
    if (denied) return denied;
    const input = asObject(body);
    if (!input) return badBody;
    const files = asObject(input.files);
    if (!files) return failure(400, "files must map paths to text");
    const published = await backend.registry.publish({
      name,
      version,
      files: files as Record<string, string>,
      ownerId: userId!,
      private: typeof input.private === "boolean" ? input.private : undefined,
    });
    return published.ok ? json(201, { name: published.name, version: published.version, integrity: published.integrity }) : failure(published.status, published.error);
  }

  if (version !== undefined && action === "deprecate" && method === "POST") {
    const denied = needsSession();
    if (denied) return denied;
    const input = asObject(body);
    if (!input) return badBody;
    if (typeof input.message !== "string" || input.message.trim() === "") return failure(400, "A deprecation needs a message");
    const deprecated = await backend.registry.deprecate(name, version, input.message, userId!);
    return deprecated.ok ? json(200, { ok: true }) : failure(deprecated.status, deprecated.error);
  }

  if (version !== undefined && action !== undefined && action.startsWith("files/") && method === "GET") {
    const path = match[5]!.split("/").map(decodeURIComponent).join("/");
    const fetched = await backend.registry.fetchFile(name, version, path, viewer);
    return fetched.ok
      ? { status: 200, contentType: "text/plain; charset=utf-8", body: fetched.content }
      : failure(fetched.status, fetched.error);
  }

  return failure(405, "Method not allowed for this resource");
}

function tokenBody(pair: { readonly accessToken: string; readonly refreshToken: string; readonly expiresIn: number; readonly scopes: readonly string[] }) {
  return { access_token: pair.accessToken, refresh_token: pair.refreshToken, expires_in: pair.expiresIn, scope: pair.scopes.join(" "), token_type: "Bearer" };
}
