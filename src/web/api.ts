type SessionBinding = { identity: string; getToken: () => Promise<string | null>; owner: symbol };
let session: SessionBinding | null = null;
let identity: string | null = null;
let epoch = 0;
const responseGuards = new WeakMap<Response, () => void>();

/** Bind the captured session resource, not Clerk's dynamically active session. */
export function bindApiSession(principal: string, getToken: () => Promise<string | null>): () => void {
  if (identity !== principal) { identity = principal; epoch++; }
  const owner = Symbol(principal);
  session = { identity: principal, getToken, owner };
  return () => {
    if (session?.owner !== owner) return;
    session = null;
    // React StrictMode immediately rebinds the same layout effect. Clear credentials
    // synchronously, but avoid treating that rehearsal as a different principal.
    queueMicrotask(() => { if (!session && identity === principal) { identity = null; epoch++; } });
  };
}

function requestGuard(binding: SessionBinding | null, requestEpoch: number): () => void {
  return () => {
    if (binding && (epoch !== requestEpoch || session?.identity !== binding.identity)) {
      throw new DOMException("Your signed-in session changed. Retry from the current account.", "AbortError");
    }
  };
}

/** Guard delayed consumption too: a small response may already be buffered before a switch. */
class SessionResponse extends Response {
  constructor(body: BodyInit | null, init: ResponseInit, private readonly assertCurrent: () => void) { super(body, init); }
  override async text(): Promise<string> { this.assertCurrent(); const value = await super.text(); this.assertCurrent(); return value; }
  override async json(): Promise<unknown> { this.assertCurrent(); const value: unknown = await super.json(); this.assertCurrent(); return value; }
  override async blob(): Promise<Blob> { this.assertCurrent(); const value = await super.blob(); this.assertCurrent(); return value; }
  override async arrayBuffer(): Promise<ArrayBuffer> { this.assertCurrent(); const value = await super.arrayBuffer(); this.assertCurrent(); return value; }
  override async bytes() { this.assertCurrent(); const value = new Uint8Array(await super.arrayBuffer()); this.assertCurrent(); return value; }
  override async formData(): Promise<FormData> { this.assertCurrent(); const value = await super.formData(); this.assertCurrent(); return value; }
  override clone(): Response {
    this.assertCurrent();
    const copy = super.clone();
    const guarded = new SessionResponse(copy.body, { status: copy.status, statusText: copy.statusText, headers: copy.headers }, this.assertCurrent);
    responseGuards.set(guarded, this.assertCurrent);
    return guarded;
  }
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const binding = session;
  const assertCurrent = requestGuard(binding, epoch);
  const token = binding ? await binding.getToken() : null;
  assertCurrent();
  if (binding && !token) throw new DOMException("Your signed-in session is unavailable. Sign in again.", "AbortError");
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  try { assertCurrent(); } catch (cause) { await response.body?.cancel().catch(() => undefined); throw cause; }
  if (!binding) return response;
  const reader = response.body?.getReader();
  const body = reader ? new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        assertCurrent();
        const result = await reader.read();
        assertCurrent();
        if (result.done) { controller.close(); reader.releaseLock(); }
        else controller.enqueue(result.value);
      } catch (cause) {
        await reader.cancel().catch(() => undefined);
        controller.error(cause);
      }
    },
    async cancel(reason) { await reader.cancel(reason); },
  }) : null;
  const guarded = new SessionResponse(body, { status: response.status, statusText: response.statusText, headers: response.headers }, assertCurrent);
  responseGuards.set(guarded, assertCurrent);
  return guarded;
}

/** JSON helper: throws an Error carrying the server's message on any non-2xx response. */
export async function apiJson<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await apiFetch(`/api${path}`, {
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) } } : {}),
  });
  const text = await res.text();
  responseGuards.get(res)?.();
  if (!res.ok) throw new Error(text || `Request failed (${res.status})`);
  return (text ? JSON.parse(text) : {}) as T;
}
