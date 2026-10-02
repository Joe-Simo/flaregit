import { integrationCallbackSchema, signIntegrationCallback } from "../server/integration-auth.js";
import { z } from "zod";
import { signServiceRead } from "../server/service-read-auth.js";

const responseSchema = z.object({ kind: z.enum(["applied", "duplicate", "rejected"]), commentId: z.number().int().positive().optional() });

/** Service authentication sends no human bearer token and grants no review approval. */
export async function sendServiceReport(input: {
  origin: string; repositoryId: string; serviceId: string; eventId: string; report: unknown; secret: string;
  timestamp?: number; fetcher?: (url: RequestInfo | URL, options?: RequestInit) => Promise<Response>;
}) {
  const origin = new URL(input.origin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Service reports require a credential-free HTTPS origin");
  const callback = integrationCallbackSchema.parse({ repositoryId: input.repositoryId, serviceId: input.serviceId, eventId: input.eventId, timestamp: input.timestamp ?? Math.floor(Date.now() / 1000), report: input.report });
  const raw = JSON.stringify(callback);
  if (new TextEncoder().encode(raw).length > 65_536) throw new Error("Report exceeds callback size limit");
  const signature = await signIntegrationCallback(input.secret, raw);
  const url = new URL(`/api/p/${encodeURIComponent(callback.repositoryId)}/connections/${encodeURIComponent(callback.serviceId)}/events`, origin);
  const response = await (input.fetcher ?? fetch)(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Flaregit-Signature": signature }, body: raw, redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Report delivery answered ${response.status}; retry unchanged contents with the same event ID`);
  const receipt = responseSchema.parse(await response.json());
  return { eventId: callback.eventId, ...receipt };
}

const snapshotSchema = z.object({
  repositoryId: z.string(), candidateId: z.string(), commit: z.string().regex(/^[0-9a-f]{40}$/), tree: z.string().regex(/^[0-9a-f]{40}$/), policyVersion: z.number().int().positive(),
  checks: z.array(z.object({ id: z.string(), required: z.boolean(), run: z.object({ id: z.string(), checkId: z.string(), sequence: z.number().int(), status: z.enum(["queued", "running", "passed", "failed", "cancelled"]) }).nullable() })),
});

export async function readServiceCandidate(input: {
  origin: string; repositoryId: string; serviceId: string; candidateId: string; commit: string; secret: string;
  timestamp?: number; nonce?: string; fetcher?: (url: RequestInfo | URL, options?: RequestInit) => Promise<Response>;
}) {
  const origin = new URL(input.origin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Service reads require a credential-free HTTPS origin");
  if (!/^[a-z0-9]{12,16}$/.test(input.repositoryId) || !/^svc_[a-f0-9-]{36}$/.test(input.serviceId) || !/^[a-z0-9_-]+$/.test(input.candidateId) || !/^[a-f0-9]{40}$/.test(input.commit)) throw new Error("Exact repository, connection, candidate and commit IDs are required");
  const url = new URL(`/api/p/${input.repositoryId}/connections/${input.serviceId}/candidates/${input.candidateId}`, origin);
  url.searchParams.set("commit", input.commit);
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000), nonce = input.nonce ?? crypto.randomUUID();
  const signature = await signServiceRead(input.secret, { method: "GET", path: url.pathname + url.search, timestamp, nonce });
  const response = await (input.fetcher ?? fetch)(url, { method: "GET", headers: { "X-Flaregit-Timestamp": String(timestamp), "X-Flaregit-Nonce": nonce, "X-Flaregit-Signature": signature }, redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Service candidate read answered ${response.status}; retry with a fresh nonce`);
  const snapshot = snapshotSchema.parse(await response.json());
  if (snapshot.repositoryId !== input.repositoryId || snapshot.candidateId !== input.candidateId || snapshot.commit !== input.commit) throw new Error("Service snapshot identity differs from the exact requested candidate");
  return snapshot;
}
