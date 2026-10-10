import {checkedPreparedPublicationReceipt,clearPreparedPublicationRecovery,type PreparedPublicationRequest} from './prepared-publication-recovery';
import {checkedCandidateRuntimeInspection} from './candidate-runtime-inspection';
import {clearIntegrationIntentRecovery} from './integration-intent-recovery';
import {clearIssueDraftRecovery} from './issue-draft-recovery';
type SessionBinding = { identity: string; getToken: () => Promise<string | null>; owner: symbol };
let session: SessionBinding | null = null;
let identity: string | null = null;
let epoch = 0;
/** Recovery data is scoped to the captured active session, never an email or repository alone. */
export function apiSessionIdentity(): string | null { return session?.identity ?? null; }
const responseGuards = new WeakMap<Response, () => void>();
let readRevision = 0;
type SharedRead = { controller: AbortController; consumers: number; value: Promise<string> };
const sharedReads = new Map<string, SharedRead>();
function invalidateSharedReads() { readRevision++; sharedReads.clear(); }

/** Bind the captured session resource, not Clerk's dynamically active session. */
export function bindApiSession(principal: string, getToken: () => Promise<string | null>): () => void {
  if (identity !== principal) { const previousIdentity=identity; if (previousIdentity) { clearSessionConversationDrafts(previousIdentity); clearSessionReviewDrafts(previousIdentity); } clearOtherSessionRecovery(principal);clearPreparedPublicationRecovery(principal); clearIssueDraftRecovery(principal); clearIntegrationIntentRecovery(principal); identity = principal; epoch++; }
  const owner = Symbol(principal);
  session = { identity: principal, getToken, owner };
  return () => {
    if (session?.owner !== owner) return;
    session = null;
    // Binding loss can be loading, a public route or a remount. Clear credentials
    // immediately; preserve scoped recovery until verified sign-out or another principal.
    queueMicrotask(() => { if (!session && identity === principal) epoch++; });
  };
}

/** Invoke only after the authentication SDK confirms a loaded signed-out state. */
export function clearVerifiedApiSession():void{session=null;identity=null;epoch++;clearVerifiedSessionRecovery();clearPreparedPublicationRecovery(null);clearIssueDraftRecovery(null);clearIntegrationIntentRecovery(null);}

function requestGuard(binding: SessionBinding | null, requestEpoch: number): () => void {
  return () => {
    if (binding && (epoch !== requestEpoch || session?.identity !== binding.identity)) {
      throw new DOMException("Your signed-in session changed. Retry from the current account.", "AbortError");
    }
  };
}

type ResponseMetadata = Readonly<Pick<Response, "url" | "redirected" | "type" | "status" | "statusText">>;

/** Guard delayed consumption too: a small response may already be buffered before a switch. */
class SessionResponse extends Response {
  constructor(body: BodyInit | null, init: ResponseInit, private readonly assertCurrent: () => void, private readonly metadata: ResponseMetadata) {
    // Opaque/error responses have status 0, which ResponseInit cannot construct.
    // Preserve their observable status while retaining guarded body consumption.
    super(body, { ...init, status: init.status === 0 ? 200 : init.status });
  }
  override get url(): string { return this.metadata.url; }
  override get redirected(): boolean { return this.metadata.redirected; }
  override get type(): ResponseType { return this.metadata.type; }
  override get status(): number { return this.metadata.status; }
  override get statusText(): string { return this.metadata.statusText; }
  override get ok(): boolean { return this.metadata.status >= 200 && this.metadata.status < 300; }
  override async text(): Promise<string> { this.assertCurrent(); const value = await super.text(); this.assertCurrent(); return value; }
  override async json(): Promise<unknown> { this.assertCurrent(); const value: unknown = await super.json(); this.assertCurrent(); return value; }
  override async blob(): Promise<Blob> { this.assertCurrent(); const value = await super.blob(); this.assertCurrent(); return value; }
  override async arrayBuffer(): Promise<ArrayBuffer> { this.assertCurrent(); const value = await super.arrayBuffer(); this.assertCurrent(); return value; }
  override async bytes() { this.assertCurrent(); const value = new Uint8Array(await super.arrayBuffer()); this.assertCurrent(); return value; }
  override async formData(): Promise<FormData> { this.assertCurrent(); const value = await super.formData(); this.assertCurrent(); return value; }
  override clone(): Response {
    this.assertCurrent();
    const copy = super.clone();
    const guarded = new SessionResponse(copy.body, { status: copy.status, statusText: copy.statusText, headers: copy.headers }, this.assertCurrent, this.metadata);
    responseGuards.set(guarded, this.assertCurrent);
    return guarded;
  }
}

/**
 * `preservesReads` marks a non-GET request that changes no repository state (for example minting a
 * live-board socket ticket), so it does not supersede concurrent repository reads.
 */
export type ApiRequestInit = RequestInit & { preservesReads?: boolean };
export async function apiFetch(input: string, init: ApiRequestInit = {}): Promise<Response> {
  const { preservesReads = false, ...request } = init;
  const mutation = !preservesReads && !["GET", "HEAD"].includes((request.method ?? "GET").toUpperCase());
  if (mutation) invalidateSharedReads();
  try { return await sessionFetch(input, request); }
  finally { if (mutation) invalidateSharedReads(); }
}
async function sessionFetch(input: string, init: RequestInit): Promise<Response> {
  const binding = session;
  if(!binding&&identity!==null)throw new DOMException("Your secure session is temporarily unavailable. Wait for authentication before retrying.","AbortError");
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
  const guarded = new SessionResponse(body, { status: response.status, statusText: response.statusText, headers: response.headers }, assertCurrent, { url: response.url, redirected: response.redirected, type: response.type, status: response.status, statusText: response.statusText });
  responseGuards.set(guarded, assertCurrent);
  return guarded;
}

export function apiRetryAfterSeconds(value: string | null, now = Date.now()): number | null {
  if(value===null)return null;
  const seconds=/^[0-9]+$/.test(value) ? Number(value) : (Date.parse(value)-now)/1000;
  return Number.isFinite(seconds) && seconds>=0 && seconds<=Number.MAX_SAFE_INTEGER ? Math.ceil(seconds) : null;
}
/** Expected cancellation when a mutation supersedes an otherwise authorized GET. */
export class StaleRepositoryReadError extends DOMException {
  constructor(){super("Repository state changed during this read. Refresh to get current state.","AbortError");}
}
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter: number | null) { super(message); this.name="ApiError"; }
}
/** A read superseded by a concurrent mutation is read again this many times before it is reported. */
const STALE_READ_ATTEMPTS = 3;
type ApiJsonInit = ApiRequestInit & { json?: unknown };
/**
 * JSON helper: throws an Error carrying the server's message on any non-2xx response. A shared GET
 * superseded by a mutation is never returned; it is read again after the mutation, a bounded number of times.
 */
export async function apiJson<T>(path: string, init: ApiJsonInit = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await apiJsonOnce<T>(path, init); }
    catch (cause) {
      if (!(cause instanceof StaleRepositoryReadError) || attempt >= STALE_READ_ATTEMPTS || init.signal?.aborted) throw cause;
    }
  }
}
async function apiJsonOnce<T>(path: string, init: ApiJsonInit): Promise<T> {
  const binding = session, requestEpoch = epoch, revision = readRevision;
  const shareable = binding && Object.keys(init).every(key => key === "signal" || key === "method") && (init.method ?? "GET").toUpperCase() === "GET";
  if (!shareable) return JSON.parse(await jsonText(path, init)) as T;
  init.signal?.throwIfAborted();
  const key = JSON.stringify([binding.identity, requestEpoch, revision, path]);
  let shared = sharedReads.get(key);
  if (!shared) {
    const controller = new AbortController();
    const entry: SharedRead = { controller, consumers: 0, value: Promise.resolve("") };
    entry.value = jsonText(path, { signal: controller.signal }).finally(() => { if (sharedReads.get(key) === entry) sharedReads.delete(key); });
    sharedReads.set(key, entry); shared = entry;
  }
  const entry = shared;
  entry.consumers++;
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(init.signal?.reason ?? new DOMException("Read cancelled", "AbortError"));
    init.signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    const text = await Promise.race([entry.value, cancelled]);
    requestGuard(binding, requestEpoch)();
    if (revision !== readRevision) throw new StaleRepositoryReadError();
    return JSON.parse(text) as T;
  } finally {
    if (abort) init.signal?.removeEventListener("abort", abort);
    entry.consumers--;
    if (entry.consumers === 0) { entry.controller.abort(); if (sharedReads.get(key) === entry) sharedReads.delete(key); }
  }
}
async function jsonText(path: string, init: ApiJsonInit): Promise<string> {
  const { json, ...rest } = init;
  const res = await apiFetch(`/api${path}`, {
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) } } : {}),
  });
  const text = await res.text();
  responseGuards.get(res)?.();
  if (!res.ok) {
    let message=text || `Request failed (${res.status})`;
    try { const problem: unknown=JSON.parse(text); if(problem && typeof problem==="object" && "error" in problem && typeof problem.error==="string")message=problem.error; } catch { /* Plain-text failure messages remain supported. */ }
    throw new ApiError(message,res.status,apiRetryAfterSeconds(res.headers.get("Retry-After")));
  }
  return text || "{}";
}
/** True for a refusal that clears on its own: rate limiting, a superseded read or a transient outage. */
export function isTransientReadFailure(cause: unknown): boolean {
  return cause instanceof StaleRepositoryReadError || cause instanceof ApiError && [429, 502, 503, 504].includes(cause.status);
}
/** How long to wait before reading again after a transient failure; honours the server's Retry-After. */
export function transientRetryDelayMs(cause: unknown, fallbackMs: number): number {
  return cause instanceof ApiError && cause.retryAfter !== null ? Math.max(fallbackMs, cause.retryAfter * 1000) : fallbackMs;
}
/** One read, retried once after a transient failure (with backoff) instead of surfacing it to the person. */
export async function apiJsonWithRetry<T>(path: string, signal: AbortSignal, backoffMs = 1500): Promise<T> {
  try { return await apiJson<T>(path, { signal }); }
  catch (cause) {
    if (!isTransientReadFailure(cause) || signal.aborted) throw cause;
    const delay = Math.min(60_000, transientRetryDelayMs(cause, backoffMs));
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delay);
      signal.addEventListener("abort", abort, { once: true });
    });
    return apiJson<T>(path, { signal });
  }
}
import { clearSessionConversationDrafts } from "./conversation-recovery";

import {clearSessionReviewDrafts,clearVerifiedSessionRecovery,clearOtherSessionRecovery} from "./review-draft-recovery";

/** Owner-only recorded runtime metadata; never an implicit provider inspection or recovery write. */
export async function apiCandidateRuntimeInspection(projectId:string,candidateId:string,workflowId:string,signal?:AbortSignal){const raw=await apiJson<unknown>(`/p/${encodeURIComponent(projectId)}/candidates/${encodeURIComponent(candidateId)}/runtime`,{signal});return checkedCandidateRuntimeInspection(raw,candidateId,workflowId);}

/** Reconciles the existing exact verification locally; no provider or history operation. */
export async function apiRecoverCandidateVerificationClosure(projectId:string,candidateId:string,input:{workflowId:string;commit:string;evidenceId:string},signal?:AbortSignal){const raw=await apiJson<unknown>(`/p/${encodeURIComponent(projectId)}/candidates/${encodeURIComponent(candidateId)}/verification-closure`,{method:'POST',body:JSON.stringify(input),signal});return checkedCandidateRuntimeInspection(raw,candidateId,input.workflowId);}

/** Publishes only the previously approved exact journal; it never records a new review. */
export async function apiRequestPreparedPublication(projectId:string,candidateId:string,input:PreparedPublicationRequest,signal?:AbortSignal){const raw=await apiJson<unknown>(`/p/${encodeURIComponent(projectId)}/candidates/${encodeURIComponent(candidateId)}/prepared-publication`,{method:'POST',json:input,signal});return checkedPreparedPublicationReceipt(raw,candidateId,input);}
