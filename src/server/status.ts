import { computeStatus, type ServiceStatus } from "../core/service-status.js";
import { HEALTH_EMBEDDING_MODEL } from "./health-probe-budget.js";
import type { ComponentStatus, WorkflowCount } from "./durable-object.js";
import type { Env } from "./env.js";
import { globalOf } from "./projects.js";

const LABELS: Record<string, string> = {
  api: "Web asset availability",
  ledger: "State and ledger (Durable Objects)",
  git: "Git hosting (Artifacts)",
  storage: "Build and evidence storage (R2)",
  queue: "Event queue and webhook delivery",
  workflows: "Workflows (agents and integration)",
  auth: "Sign-in (Clerk)",
  ai: "AI models (Workers AI)",
};
const SCOPES: Record<string, string> = {
  api: "Web entry response only; authenticated API flows are not measured",
  ledger: "Controller storage read only",
  git: "Repository listing only; clone and push are not measured",
  storage: "Unique object write, read and deletion",
  queue: "Probe message arrival only; webhook receiver success is not measured",
  workflows: "Workflow service lookup only; agent completion and accepted integration are not measured",
  auth: "Signing-key endpoint only; successful sign-in is not measured",
  ai: "Embedding response only; coding-agent completion is not measured",
};

async function timed(fn: () => Promise<unknown>): Promise<{ ok: boolean; ms: number; detail?: string }> {
  const t0 = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([fn(), new Promise((_, rej) => { timeout = setTimeout(() => rej(new Error("timed out after 8s")), 8000); })]);
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message : String(e) };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/** Runs on a schedule: each subsystem is checked on its own, so one failure never hides behind the others. */
export async function runProbes(env: Env): Promise<void> {
  const g = globalOf(env);
  const checks: Record<string, () => Promise<unknown>> = {
    api: async () => {
      const response = await env.ASSETS.fetch(new Request("https://availability.invalid/"));
      if (!response.ok) throw new Error(`Web entry answered ${response.status}`);
      if (!(await response.text()).trim()) throw new Error("Web entry returned an empty response");
    },
    ledger: () => g.usageToday(),
    git: () => env.ARTIFACTS.list({ limit: 1 }),
    storage: async () => {
      const key = `availability/${crypto.randomUUID()}`;
      const value = crypto.randomUUID();
      try {
        await env.EVIDENCE_BUCKET.put(key, value);
        const object = await env.EVIDENCE_BUCKET.get(key);
        if (!object || await object.text() !== value) throw new Error("Probe object could not be recovered");
      } finally {
        await env.EVIDENCE_BUCKET.delete(key);
      }
    },
    workflows: async () => {
      try {
        await env.INTEGRATION_WORKFLOW.get("health-probe");
      } catch (e) {
        if (!/not.?found|unknown|does not exist/i.test(String(e))) throw e; // "no such instance" proves the service answered
      }
    },
    // Fixed operator-funded embedding probe; response availability is not workflow health.
    ai: async () => {
      const out = (await env.AI.run(HEALTH_EMBEDDING_MODEL, { text: ["ok"] })) as { data?: unknown[] };
      if (!out?.data?.length) throw new Error("model returned no embedding");
    },
    auth: async () => {
      if (!env.CLERK_ISSUER) throw new Error("not configured");
      const res = await fetch(`${env.CLERK_ISSUER}/.well-known/jwks.json`);
      if (!res.ok) throw new Error(`JWKS answered ${res.status}`);
    },
  };
  for (const [component, fn] of Object.entries(checks)) {
    if (component === "ai") {
      let admission;
      try { admission = await g.reserveHealthProbe(); }
      catch { await g.recordProbe("ai",false,0,"AI probe admission unavailable; response unverified"); continue; }
      if (admission.kind === "duplicate") continue; // Original attempt owns its eventual observation.
      if (admission.kind === "exhausted") { await g.recordProbe("ai",false,0,"AI availability probe budget exhausted; response unverified"); continue; }
    }
    const r = await timed(fn);
    await g.recordProbe(component, r.ok, r.ms, r.detail);
  }
  // The queue is checked end to end: the consumer records its own success when it receives this message.
  const sent = await timed(() => env.INTEGRATION_QUEUE.send({ type: "probe", sentAt: Date.now() }));
  if (!sent.ok) await g.recordProbe("queue", false, sent.ms, `send failed: ${sent.detail}`);
}

export type PublicComponentStatus = ComponentStatus & { label: string; scope: string; status: ServiceStatus };

/** Normalize persisted probes once against an injected clock; future timestamps are unverified. */
export function summarizeComponentStatus(rows: readonly ComponentStatus[], now: number): PublicComponentStatus[] {
  const by = new Map(rows.map((row) => [row.component, row]));
  return Object.keys(LABELS).map((component) => {
    const r = by.get(component) ?? { component, degradedNow: true, lastCheckAt: null, checks24h: 0, failed24h: 0, lastFailureAt: null, lastFailureDetail: null, degradedMinutes24h: 0 };
    const status = computeStatus(r.lastCheckAt === null ? [] : [{name: component, ok: !r.degradedNow, checkedAt: r.lastCheckAt}], now, 15 * 60_000);
    return { ...r, status, degradedNow: status !== "operational", label: LABELS[component] ?? component, scope: SCOPES[component] ?? "Availability only" };
  });
}

export async function currentStatus(env: Env): Promise<PublicComponentStatus[]> {
  return summarizeComponentStatus(await globalOf(env).statusSummary(), Date.now());
}

export type ProbeRow = { component: string; at: number; ok: number; latency_ms: number | null; detail: string | null };

export interface Incident {
  component: string;
  label: string;
  /** Time of the first failed probe (or, for silence, of the last report). */
  startedAt: number;
  /** First subsequent successful probe; null while ongoing or when no success has been observed since. */
  endedAt: number | null;
  failedChecks: number;
  lastDetail: string | null;
  ongoing: boolean;
}

export const INCIDENT_WINDOW_MS = 7 * 86_400_000;
const MERGE_GAP_MS = 15 * 60_000;
const SILENCE_MS = 15 * 60_000;

/**
 * Groups consecutive failed probes per component into incidents. A success ends an incident; failures more than
 * 15 minutes apart start a new one. A component silent for 15 minutes is reported as an ongoing incident.
 */
export function deriveIncidents(rows: readonly ProbeRow[], now: number): Incident[] {
  const since = now - INCIDENT_WINDOW_MS;
  const by = new Map<string, ProbeRow[]>();
  for (const r of rows) if (r.at >= since && r.at <= now) by.set(r.component, [...(by.get(r.component) ?? []), r]);
  const out: Incident[] = [];
  for (const [component, list] of by) {
    list.sort((a, b) => a.at - b.at);
    const label = LABELS[component] ?? component;
    let cur: (Incident & { lastFailAt: number }) | null = null;
    const close = (endedAt: number | null) => {
      if (!cur) return;
      const { lastFailAt: _, ...inc } = cur;
      out.push({ ...inc, endedAt, ongoing: false });
      cur = null;
    };
    for (const r of list) {
      if (r.ok) {
        close(r.at);
        continue;
      }
      if (cur && r.at - cur.lastFailAt >= MERGE_GAP_MS) close(null);
      if (!cur) cur = { component, label, startedAt: r.at, endedAt: null, failedChecks: 0, lastDetail: null, ongoing: true, lastFailAt: r.at };
      cur.failedChecks++;
      cur.lastFailAt = r.at;
      if (r.detail) cur.lastDetail = r.detail;
    }
    const last = list[list.length - 1]!;
    const silent = now - last.at > SILENCE_MS;
    const silenceNote = `no check reported for ${Math.round((now - last.at) / 60_000)} min`;
    const open = cur as (Incident & { lastFailAt: number }) | null;
    if (open) {
      const { lastFailAt: _, ...inc } = open;
      out.push({ ...inc, ongoing: true, lastDetail: silent ? `${inc.lastDetail ?? "check failed"}; ${silenceNote}` : inc.lastDetail });
    } else if (silent) {
      out.push({ component, label, startedAt: last.at, endedAt: null, failedChecks: 0, lastDetail: silenceNote, ongoing: true });
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt || a.component.localeCompare(b.component));
}

/** Incidents for the last 7 days, derived from raw probe rows. */
export async function statusIncidents(env: Env, now = Date.now()): Promise<Incident[]> {
  return deriveIncidents(await globalOf(env).listProbes(now - INCIDENT_WINDOW_MS), now);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const ago = (t: number | null) => (t === null ? "never" : `${Math.max(0, Math.round((Date.now() - t) / 60_000))} min ago`);

const when = (t: number) => new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC";
export interface WorkflowHealth { verified: boolean; completedRuns24h: number; outstandingRuns: number; awaitingReviewRuns: number; counts: WorkflowCount[] }
export function summarizeWorkflowCounts(counts: WorkflowCount[]): WorkflowHealth {
  return { verified: counts.some((r) => r.status !== "started" && r.status !== "awaiting_review"), completedRuns24h: counts.filter((r) => r.status !== "started" && r.status !== "awaiting_review").reduce((sum, r) => sum + r.count, 0), outstandingRuns: counts.filter((r) => r.status === "started" || r.status === "awaiting_review").reduce((sum, r) => sum + r.count, 0), awaitingReviewRuns: counts.filter((r) => r.status === "awaiting_review").reduce((sum, r) => sum + r.count, 0), counts };
}
export async function workflowHealth(env: Env): Promise<WorkflowHealth> {
  try { return summarizeWorkflowCounts(await globalOf(env).workflowCounts(Date.now() - 86_400_000)); }
  catch { return { verified: false, completedRuns24h: 0, outstandingRuns: 0, awaitingReviewRuns: 0, counts: [] }; }
}

export function statusPage(rows: Awaited<ReturnType<typeof currentStatus>>, incidents: readonly Incident[] = [], now = Date.now(), reports?: { open: number; oldestOpenHours: number | null }, workflows?: WorkflowHealth): string {
  const degraded = rows.filter((r) => r.degradedNow);
  const incBody = incidents
    .map(
      (i) => `<tr><td>${esc(i.label)}</td><td><time datetime="${new Date(i.startedAt).toISOString()}">${when(i.startedAt)}</time></td><td${i.ongoing ? ' class="bad"' : ""}>${i.ongoing ? "ongoing" : i.endedAt !== null ? `<time datetime="${new Date(i.endedAt).toISOString()}">${when(i.endedAt)}</time>` : "no recovery check recorded"}</td>
<td>${i.endedAt !== null || i.ongoing ? `${Math.max(0, Math.round(((i.endedAt ?? now) - i.startedAt) / 60_000))} min${i.ongoing ? " so far" : ""}` : "unknown"}</td><td>${i.failedChecks}</td><td>${i.lastDetail ? esc(i.lastDetail) : "—"}</td></tr>`
    )
    .join("");
  const body = rows
    .map(
      (r) => `<tr><td>${esc(r.label)}<br><small>${esc(r.scope)}</small></td><td class="${r.degradedNow ? "bad" : "ok"}">${r.status === "unknown" ? "Unverified" : r.degradedNow ? "Degraded" : "Probe passed"}</td>
<td>${r.failed24h} of ${r.checks24h}</td><td>${r.degradedMinutes24h} min</td><td>${r.lastFailureAt ? `${ago(r.lastFailureAt)}${r.lastFailureDetail ? ` — ${esc(r.lastFailureDetail)}` : ""}` : "none in 24 h"}</td></tr>`
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Status · FlareGit</title>
<style>:root{color-scheme:light dark}body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:0 auto;padding:2rem 1rem}table{width:100%;border-collapse:collapse}td,th{padding:.5rem;border-bottom:1px solid #8884;text-align:left;vertical-align:top}.ok{color:#16a34a}.bad{color:#dc2626;font-weight:700}small{opacity:.7}.scroll{overflow-x:auto}caption{text-align:left;font-size:13px;opacity:.7}@media(max-width:40rem){td,th{padding:.35rem;font-size:14px}}footer{display:flex;justify-content:flex-end;margin-top:3rem;padding-top:1rem;border-top:1px solid #8884}footer img{display:block;width:190px;max-width:100%;height:auto}</style></head><body>
<p><a href="/">&larr; FlareGit</a></p><h1>${rows.length === 0 ? "Availability unverified" : degraded.length ? "Availability needs attention" : "Availability probes passing"}</h1>
<p>${rows.length === 0 ? "No availability evidence has been recorded." : degraded.length ? `Failed, missing or stale checks: ${degraded.map((r) => esc(r.label)).join(", ")}.` : "The latest availability checks passed within their stated scope."}</p>
<p><small>Scheduled availability probes report service responses, not successful customer workflows. They do not establish agent completion, accepted-history durability, CI success, or delivery to webhook receivers. Counts below cover recorded checks; silence beyond 15 minutes is degraded. These measurements are not an uptime percentage.</small></p>
<h2>Subsystems now</h2><div class="scroll"><table><thead><tr><th scope="col">Subsystem</th><th scope="col">Now</th><th scope="col">Failed checks (24 h)</th><th scope="col">Degraded for (24 h)</th><th scope="col">Last failure</th></tr></thead><tbody>${body || "<tr><td colspan=5>No checks recorded yet</td></tr>"}</tbody></table></div>
${workflows ? `<h2>Recorded workflow outcomes</h2><p>${workflows.verified ? `${workflows.completedRuns24h} terminal runs recorded in the last 24 hours; ${workflows.outstandingRuns} recorded starts without a terminal outcome.` : "Unverified: no terminal outcome evidence is available for the last 24 hours."}</p><p>${workflows.awaitingReviewRuns} recorded runs are awaiting human review. These remain outstanding and are not completed runs.</p><p><small>The denominator is recorded terminal runs, including refusals, conflicts, stale reviews and failures. Agent completion means a saved branch checkpoint, not an accepted merge. Outstanding starts may be running, waiting for review, interrupted, or missing telemetry. These counts do not establish all launched runs were recorded.</small></p><table><thead><tr><th scope="col">Workflow</th><th scope="col">Outcome</th><th scope="col">Count</th></tr></thead><tbody>${workflows.counts.map((r) => `<tr><td>${esc(r.kind)}</td><td>${esc(r.status)}</td><td>${r.count}</td></tr>`).join("") || '<tr><td colspan="3">No recorded outcomes</td></tr>'}</tbody></table>` : ""}
${reports ? `<h2>Abuse and impersonation reports</h2><p>${reports.open} open${reports.oldestOpenHours !== null ? `; the oldest has waited ${reports.oldestOpenHours} h` : ""}. Reports awaiting operator review remain visible in this count. Use "Report abuse" in the app footer.</p>` : ""}
<h2>Incidents (last 7 days)</h2>${
    incBody
      ? `<p><small>An incident is a run of failed checks for one subsystem; it ends at the first successful check. A subsystem silent for 15 minutes counts as an ongoing incident.</small></p><div class="scroll"><table><caption>Incidents, newest first</caption><thead><tr><th scope="col">Subsystem</th><th scope="col">Started</th><th scope="col">Ended</th><th scope="col">Duration</th><th scope="col">Failed checks</th><th scope="col">Last error</th></tr></thead><tbody>${incBody}</tbody></table></div>`
      : "<p>No incidents derived from the available probe records. Missing evidence does not establish incident-free operation.</p>"
  }<footer><a href="https://www.cloudflare.com/" target="_blank" rel="noopener noreferrer"><img src="/cloudflare-protected-badge.png" alt="Protected by Cloudflare" width="190" height="66" loading="lazy"></a></footer></body></html>`;
}
