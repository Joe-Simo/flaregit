const DEFAULT_TIMEOUT_MS = 15_000;
class AuthConfigurationError extends Error {}
type Request = (input: string, init: RequestInit) => Promise<Response>;
type Schedule = (callback: () => void, delay: number) => () => void;
const schedule: Schedule = (callback, delay) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); };

/** Bound both the configuration request and its response body, without treating a slow load as an outage. */
export async function loadAuthConfiguration(parent: AbortSignal, options: { request?: Request; timeoutMs?: number; schedule?: Schedule } = {}): Promise<string> {
  const controller = new AbortController();
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const stop = (reason: unknown) => { controller.abort(reason); rejectAbort(reason); };
  const cancel = () => stop(parent.reason ?? new DOMException("Configuration request cancelled.", "AbortError"));
  parent.addEventListener("abort", cancel, { once: true });
  const clearTimer = (options.schedule ?? schedule)(() => stop(new AuthConfigurationError("Sign-in setup is taking longer than expected. Retry to reconnect.")), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  if (parent.aborted) cancel();
  const read = async () => {
    controller.signal.throwIfAborted();
    const response = await (options.request ?? fetch)("/auth-config", { signal: controller.signal, cache: "no-store", credentials: "omit" });
    controller.signal.throwIfAborted();
    if (!response.ok) throw new AuthConfigurationError("Could not load sign-in. Please retry.");
    const value: unknown = await response.json();
    controller.signal.throwIfAborted();
    if (typeof value !== "object" || value === null || !("publishableKey" in value) || value.publishableKey === null || value.publishableKey === undefined || value.publishableKey === "") throw new AuthConfigurationError("Sign-in is not configured yet.");
    if (typeof value.publishableKey !== "string" || !/^pk_(?:test|live)_[A-Za-z0-9+/=_-]+$/.test(value.publishableKey)) throw new AuthConfigurationError("Sign-in configuration could not be verified. Please retry.");
    return value.publishableKey;
  };
  try { return await Promise.race([read(), aborted]); }
  catch (failure) {
    if (controller.signal.aborted) throw controller.signal.reason ?? failure;
    if (failure instanceof AuthConfigurationError) throw failure;
    throw new AuthConfigurationError("Could not load sign-in. Please retry.");
  }
  finally { clearTimer(); parent.removeEventListener("abort", cancel); controller.abort(); }
}
