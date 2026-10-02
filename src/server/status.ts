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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const ago = (t: number | null) => (t === null ? "never" : `${Math.max(0, Math.round((Date.now() - t) / 60_000))} min ago`);

export function statusPage(rows: Awaited<ReturnType<typeof currentStatus>>): string {
  const degraded = rows.filter((r) => r.degradedNow);
  const body = rows
    .map(
      (r) => `<tr><td>${esc(r.label)}</td><td class="${r.degradedNow ? "bad" : "ok"}">${r.degradedNow ? "Degraded" : "Operational"}</td>
<td>${r.failed24h} of ${r.checks24h}</td><td>${r.degradedMinutes24h} min</td><td>${r.lastFailureAt ? `${ago(r.lastFailureAt)}${r.lastFailureDetail ? ` — ${esc(r.lastFailureDetail)}` : ""}` : "none in 24 h"}</td></tr>`
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Status · FlareGit</title>
<style>:root{color-scheme:light dark}body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:0 auto;padding:2rem 1rem}table{width:100%;border-collapse:collapse}td,th{padding:.5rem;border-bottom:1px solid #8884;text-align:left;vertical-align:top}.ok{color:#16a34a}.bad{color:#dc2626;font-weight:700}small{opacity:.7}</style></head><body>
<p><a href="/">&larr; FlareGit</a></p><h1>${degraded.length ? `${degraded.length} subsystem${degraded.length === 1 ? "" : "s"} degraded` : "All subsystems operational"}</h1>
<p><small>Each subsystem is checked on its own every 5 minutes. We report raw counts: a subsystem is “degraded” if its latest check failed, and the table shows how many checks failed in the last 24 hours and for how long. We do not average these into a single uptime percentage.</small></p>
<table><thead><tr><th>Subsystem</th><th>Now</th><th>Failed checks (24 h)</th><th>Degraded for (24 h)</th><th>Last failure</th></tr></thead><tbody>${body || "<tr><td colspan=5>No checks recorded yet</td></tr>"}</tbody></table></body></html>`;
}
