import { z } from "zod";

/** Operator-only collector. Never imported by the Worker or browser bundle. */
const ACCOUNT = "9888fed381861dcc35a37b026ff176e9";
const CONTAINERS = ["a0388b17-59b3-4a6a-98cd-54f1fa766423", "a03f6b21-d265-4b78-a117-07e98cf74684"] as const;
const LIMIT = 100;
const MAX_BYTES = 1_048_576;
const WINDOW_LIMIT = 86_400_000;
const number = z.number().finite().nonnegative();
const count = number.int();
const artifacts = z.array(z.object({ count, dimensions: z.object({ eventType: z.string().max(64), eventKind: z.string().max(64) }) })).max(LIMIT);
const workers = z.array(z.object({ sum: z.object({ requests: count, errors: count, subrequests: count, cpuTimeUs: number }) })).max(LIMIT);
const containers = z.array(z.object({ sum: z.object({ cpuTimeSec: number, allocatedMemory: number, allocatedDisk: number, txBytes: number }) })).max(LIMIT);
const r2 = z.array(z.object({ sum: z.object({ requests: count }) })).max(LIMIT);
const workflows = z.array(z.object({ sum: z.object({ cpuTime: number, wallTime: number, storageRate: number }) })).max(LIMIT);
const WORKFLOWS = ["integration", "scenario", "agent", "import-history", "rebase-resume", "private-recovery"].map(kind => `flaregit-${kind}-workflow`);
const envelope = z.object({ data: z.object({ viewer: z.object({ accounts: z.array(z.record(z.string(), z.unknown())).max(1).nullable() }).nullable() }).nullable().optional(), errors: z.array(z.object({ message: z.string().max(4096) })).nullable().optional() });
const definitions = [
  { resource: "artifacts:flaregit-default", dataset: "artifactsEventsAdaptiveGroups", filter: 'repositoryNamespace:"flaregit-default"', fields: "count dimensions {eventType eventKind}", schema: artifacts },
  { resource: "worker:flaregit", dataset: "workersInvocationsAdaptive", filter: 'scriptName:"flaregit"', fields: "sum {requests errors subrequests cpuTimeUs}", schema: workers },
  { resource: "r2:flaregit-evidence", dataset: "r2OperationsAdaptiveGroups", filter: 'bucketName:"flaregit-evidence"', fields: "sum {requests}", schema: r2 },
  ...WORKFLOWS.map(name => ({ resource: `workflow:${name}`, dataset: "workflowsAdaptiveGroups", filter: `workflowName:"${name}"`, fields: "sum {cpuTime wallTime storageRate}", schema: workflows, hourly: true })),
  ...CONTAINERS.map(id => ({ resource: `container:${id}`, dataset: "containersUsageAdaptiveGroups", filter: `applicationId:"${id}"`, fields: "sum {cpuTimeSec allocatedMemory allocatedDisk txBytes}", schema: containers })),
];
export type UsageFetcher = (url: string, init: RequestInit) => Promise<Response>;
export type Observation = {
  resource: string; start: string; end: string;
  status: "observed" | "zero" | "incomplete" | "unavailable";
  reason?: "access_denied" | "schema_unavailable" | "provider_unavailable" | "invalid_response" | "row_limit" | "response_limit" | "unsupported_granularity";
  units?: Record<string, number>;
};
export function sanitizeUsage(resource: string, raw: unknown, start: string, end: string, httpStatus = 200): Observation {
  const base = { resource, start, end };
  const definition = definitions.find(item => item.resource === resource);
  if (!definition) throw new Error("Resource outside collector scope");
  const parsed = envelope.safeParse(raw);
  if (httpStatus === 401 || httpStatus === 403) return { ...base, status: "unavailable", reason: "access_denied" };
  if (httpStatus !== 200 || !parsed.success) return { ...base, status: "unavailable", reason: "invalid_response" };
  if (parsed.data.errors?.length) {
    const message = parsed.data.errors.map(error => error.message).join(" ");
    const reason = /permission|authoriz|authentic|not allowed|access/i.test(message) ? "access_denied" : /unknown field|cannot query|unknown argument/i.test(message) ? "schema_unavailable" : "provider_unavailable";
    return { ...base, status: "unavailable", reason };
  }
  const accounts = parsed.data.data?.viewer?.accounts;
  if (accounts?.length !== 1) return { ...base, status: "unavailable", reason: "invalid_response" };
  const rows = definition.schema.safeParse(accounts[0]?.[definition.dataset]);
  if (!rows.success) return { ...base, status: "unavailable", reason: "invalid_response" };
  if (rows.data.length === LIMIT) return { ...base, status: "incomplete", reason: "row_limit" };
  const units: Record<string, number> = {};
  for (const row of rows.data) {
    if ("count" in row) units.events = (units.events ?? 0) + row.count;
    else for (const [key, value] of Object.entries(row.sum)) units[key] = (units[key] ?? 0) + value;
  }
  if (Object.values(units).some(value => !Number.isFinite(value))) return { ...base, status: "unavailable", reason: "invalid_response" };
  // An explicitly present empty dataset is zero; missing account/data is never zero.
  return { ...base, status: Object.values(units).every(value => value === 0) ? "zero" : "observed", units };
}
async function readBounded(response: Response): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("response_limit");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("invalid_response");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_BYTES) throw new Error("response_limit");
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(length); let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function collectProviderUsage(options: { token: string; start: string; end: string; fetcher?: UsageFetcher }) {
  const start = Date.parse(options.start), end = Date.parse(options.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 86_400_000) throw new Error("Usage window must be positive and at most 24 hours");
  if (!options.token || /\s/.test(options.token)) throw new Error("Operator token unavailable");
  const fetcher = options.fetcher ?? fetch;
  const observations: Observation[] = [];
  for (let cursor = start; cursor < end; cursor += WINDOW_LIMIT) {
    const from = new Date(cursor).toISOString(), until = new Date(Math.min(cursor + WINDOW_LIMIT, end)).toISOString();
    for (const definition of definitions) {
      if ("hourly" in definition && (cursor % 3_600_000 !== 0 || Math.min(cursor + WINDOW_LIMIT, end) % 3_600_000 !== 0)) {
        observations.push({ resource: definition.resource, start: from, end: until, status: "unavailable", reason: "unsupported_granularity" }); continue;
      }
      // One bounded window uses only previously confirmed filter fields. Row-limit results remain incomplete.
      const timeField = "hourly" in definition ? "datetimeHour" : "datetime";
      const query = `query { viewer { accounts(filter:{accountTag:"${ACCOUNT}"}) { ${definition.dataset}(limit:${LIMIT},filter:{${timeField}_geq:"${from}",${timeField}_lt:"${until}",${definition.filter}}) { ${definition.fields} } } } }`;
      try {
        const response = await fetcher("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(15_000) });
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel(); observations.push(sanitizeUsage(definition.resource, null, from, until, response.status)); continue;
        }
        observations.push(sanitizeUsage(definition.resource, await readBounded(response), from, until, response.status));
      } catch (error) {
        observations.push({ resource: definition.resource, start: from, end: until, status: "unavailable", reason: error instanceof Error && error.message === "response_limit" ? "response_limit" : "provider_unavailable" });
      }
    }
  }
  const receipt = { version: 1, capturedAt: new Date().toISOString(), window: { start: new Date(start).toISOString(), end: new Date(end).toISOString() }, observations,
    completeness: observations.every(row => row.status === "observed" || row.status === "zero") ? "complete_for_selected_metrics" : "incomplete",
    measurement: "provider_adaptive_analytics_may_be_sampled", reservations: "not_measured_by_this_collector", invoice: "unverified", billingZero: "never_inferred_from_empty_metrics",
    units: { events: "operational_events_not_verified_billable_operations", requests: "requests", errors: "errors", subrequests: "subrequests", cpuTimeSec: "CPU_seconds", allocatedMemory: "memory_byte_seconds", allocatedDisk: "disk_byte_seconds", txBytes: "transmitted_bytes", cpuTimeUs: "CPU_microseconds", cpuTime: "CPU_milliseconds", wallTime: "provider_native_wall_time_unit_unverified", storageRate: "provider_native_storage_growth_rate_unit_unverified" },
    gaps: ["Artifacts stored bytes and GB-months", "DO namespaces and metrics", "Workflow billed storage/duration and wall-time units", "R2 stored bytes and GB-months", "R2 operation billing classification (Class A/B)", "AI model billing", "invoice authorization and shared allowances", "per-workflow attribution"] };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(receipt)));
  return { ...receipt, receiptHash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") };
}
if (import.meta.main) {
  try {
    const end = new Date().toISOString();
    const start = new Date(Date.now() - 86_400_000).toISOString();
    console.log(JSON.stringify(await collectProviderUsage({ token: process.env.CLOUDFLARE_API_TOKEN ?? "", start: process.argv[2] ?? start, end: process.argv[3] ?? end }), null, 2));
  } catch { console.error("Scoped usage collector unavailable; no provider details emitted"); process.exitCode = 1; }
}
