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
