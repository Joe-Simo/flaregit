import type { ComponentStatus } from "./durable-object.js";
import type { Env } from "./env.js";
import { globalOf } from "./projects.js";

const LABELS: Record<string, string> = {
  api: "API and web app",
  ledger: "State and ledger (Durable Objects)",
  git: "Git hosting (Artifacts)",
  storage: "Build and evidence storage (R2)",
  queue: "Event queue and webhook delivery",
  workflows: "Workflows (agents and integration)",
  auth: "Sign-in (Clerk)",
  ai: "AI models (Workers AI)",
};

async function timed(fn: () => Promise<unknown>): Promise<{ ok: boolean; ms: number; detail?: string }> {
  const t0 = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("timed out after 8s")), 8000))]);
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs on a schedule: each subsystem is checked on its own, so one failure never hides behind the others. */
export async function runProbes(env: Env): Promise<void> {
  const g = globalOf(env);
  const checks: Record<string, () => Promise<unknown>> = {
    api: async () => undefined,
    ledger: () => g.usageToday(),
    git: () => env.ARTIFACTS.list({ limit: 1 }),
    storage: () => env.EVIDENCE_BUCKET.head("builds/.probe"),
    workflows: async () => {
      try {
        await env.INTEGRATION_WORKFLOW.get("health-probe");
      } catch (e) {
        if (!/not.?found|unknown|does not exist/i.test(String(e))) throw e; // "no such instance" proves the service answered
      }
    },
    // One tiny embedding (a few tokens, a fraction of a neuron): proves the model service answers without spending real budget.
    ai: async () => {
      const out = (await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: ["ok"] })) as { data?: unknown[] };
      if (!out?.data?.length) throw new Error("model returned no embedding");
    },
    auth: async () => {
      if (!env.CLERK_ISSUER) throw new Error("not configured");
      const res = await fetch(`${env.CLERK_ISSUER}/.well-known/jwks.json`);
      if (!res.ok) throw new Error(`JWKS answered ${res.status}`);
    },
  };
  for (const [component, fn] of Object.entries(checks)) {
    const r = await timed(fn);
    await g.recordProbe(component, r.ok, r.ms, r.detail);
  }
  // The queue is checked end to end: the consumer records its own success when it receives this message.
  const sent = await timed(() => env.INTEGRATION_QUEUE.send({ type: "probe", sentAt: Date.now() }));
  if (!sent.ok) await g.recordProbe("queue", false, sent.ms, `send failed: ${sent.detail}`);
}

export async function currentStatus(env: Env): Promise<Array<ComponentStatus & { label: string }>> {
  const rows = await globalOf(env).statusSummary();
  return rows.map((r) => {
    // A component that has not reported for 15 minutes is treated as degraded (a silent consumer is a failure).
    const stale = r.lastCheckAt !== null && Date.now() - r.lastCheckAt > 15 * 60_000;
    return { ...r, degradedNow: r.degradedNow || stale, label: LABELS[r.component] ?? r.component };
  });
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

export function statusPage(rows: Awaited<ReturnType<typeof currentStatus>>, incidents: readonly Incident[] = [], now = Date.now()): string {
  const degraded = rows.filter((r) => r.degradedNow);
  const incBody = incidents
    .map(
      (i) => `<tr><td>${esc(i.label)}</td><td><time datetime="${new Date(i.startedAt).toISOString()}">${when(i.startedAt)}</time></td><td${i.ongoing ? ' class="bad"' : ""}>${i.ongoing ? "ongoing" : i.endedAt !== null ? `<time datetime="${new Date(i.endedAt).toISOString()}">${when(i.endedAt)}</time>` : "no recovery check recorded"}</td>
<td>${i.endedAt !== null || i.ongoing ? `${Math.max(0, Math.round(((i.endedAt ?? now) - i.startedAt) / 60_000))} min${i.ongoing ? " so far" : ""}` : "unknown"}</td><td>${i.failedChecks}</td><td>${i.lastDetail ? esc(i.lastDetail) : "—"}</td></tr>`
    )
    .join("");
  const body = rows
    .map(
      (r) => `<tr><td>${esc(r.label)}</td><td class="${r.degradedNow ? "bad" : "ok"}">${r.degradedNow ? "Degraded" : "Operational"}</td>
<td>${r.failed24h} of ${r.checks24h}</td><td>${r.degradedMinutes24h} min</td><td>${r.lastFailureAt ? `${ago(r.lastFailureAt)}${r.lastFailureDetail ? ` — ${esc(r.lastFailureDetail)}` : ""}` : "none in 24 h"}</td></tr>`
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Status · FlareGit</title>
<style>:root{color-scheme:light dark}body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:0 auto;padding:2rem 1rem}table{width:100%;border-collapse:collapse}td,th{padding:.5rem;border-bottom:1px solid #8884;text-align:left;vertical-align:top}.ok{color:#16a34a}.bad{color:#dc2626;font-weight:700}small{opacity:.7}.scroll{overflow-x:auto}caption{text-align:left;font-size:13px;opacity:.7}@media(max-width:40rem){td,th{padding:.35rem;font-size:14px}}</style></head><body>
<p><a href="/">&larr; FlareGit</a></p><h1>${degraded.length ? "Degraded" : "Operational"}</h1>
<p>${degraded.length ? `Degraded now: ${degraded.map((r) => esc(r.label)).join(", ")}.` : "Every subsystem passed its latest check."}</p>
<p><small>Each subsystem is checked on its own every 5 minutes. We report raw counts: a subsystem is “degraded” if its latest check failed, and the table shows how many checks failed in the last 24 hours and for how long. We do not average these into a single uptime percentage.</small></p>
<h2>Subsystems now</h2><div class="scroll"><table><thead><tr><th scope="col">Subsystem</th><th scope="col">Now</th><th scope="col">Failed checks (24 h)</th><th scope="col">Degraded for (24 h)</th><th scope="col">Last failure</th></tr></thead><tbody>${body || "<tr><td colspan=5>No checks recorded yet</td></tr>"}</tbody></table></div>
<h2>Incidents (last 7 days)</h2>${
    incBody
      ? `<p><small>An incident is a run of failed checks for one subsystem; it ends at the first successful check. A subsystem silent for 15 minutes counts as an ongoing incident.</small></p><div class="scroll"><table><caption>Incidents, newest first</caption><thead><tr><th scope="col">Subsystem</th><th scope="col">Started</th><th scope="col">Ended</th><th scope="col">Duration</th><th scope="col">Failed checks</th><th scope="col">Last error</th></tr></thead><tbody>${incBody}</tbody></table></div>`
      : "<p>No failed checks in the last 7 days.</p>"
  }</body></html>`;
}
