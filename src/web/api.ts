let tokenGetter: (() => Promise<string | null>) | null = null;

/** Called once by the auth gate so every API call carries the signed-in user's Clerk session token. */
export function setTokenGetter(getter: () => Promise<string | null>): void {
  tokenGetter = getter;
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = tokenGetter ? await tokenGetter() : null;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

/** JSON helper: throws an Error carrying the server's message on any non-2xx response. */
export async function apiJson<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await apiFetch(`/api${path}`, {
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) } } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Request failed (${res.status})`);
  return (text ? JSON.parse(text) : {}) as T;
}
