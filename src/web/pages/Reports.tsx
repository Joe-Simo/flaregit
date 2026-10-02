import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiJson } from "../api";
import { timeAgo } from "../router";

interface Report { id: string; at: string; kind: string; target: string; details: string; status: "open" | "resolved"; resolution: string | null; resolved_by: string | null; resolved_at: string | null }
const KINDS: Array<[string, string]> = [["impersonation", "Impersonation"], ["namespace_squatting", "Name or domain squatting"], ["malware", "Malware or extortion"], ["harassment", "Harassment"], ["security", "Security vulnerability"], ["other", "Other"]];
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

function ReportList({ reports }: { reports: Report[] }) {
  if (reports.length === 0) return <p className="text-sm text-muted-foreground">No reports.</p>;
  return (
    <ul className="space-y-2">
      {reports.map((r) => (
        <li key={r.id} className="rounded-md border border-border p-3 text-sm space-y-1">
          <div className="flex flex-wrap items-center gap-2"><Badge variant={r.status === "open" ? "warning" : "success"}>{r.status}</Badge><span className="font-medium">{KINDS.find((k) => k[0] === r.kind)?.[1] ?? r.kind}</span><span className="text-muted-foreground break-all">{r.target}</span><span className="text-xs text-muted-foreground">{r.id} · {timeAgo(r.at)}</span></div>
          <p className="whitespace-pre-wrap break-words">{r.details}</p>
          {r.resolution && <p className="text-muted-foreground">Resolution by {r.resolved_by}{r.resolved_at ? ` ${timeAgo(r.resolved_at)}` : ""}: {r.resolution}</p>}
        </li>
      ))}
    </ul>
  );
}

/** Anyone signed in can report; every report reaches a person, and its status stays visible to the reporter. */
export function ReportPage() {
  const [kind, setKind] = useState("impersonation");
  const [target, setTarget] = useState("");
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<Report[] | null>(null);
  const load = useCallback(() => apiJson<Report[]>("/reports").then(setMine).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(null); setNotice(null);
    try {
      const r = await apiJson<{ id: string; note: string }>("/reports", { method: "POST", json: { kind, target, details } });
      setNotice(`Report ${r.id} filed. ${r.note}`);
      setTarget(""); setDetails("");
      void load();
    } catch (err) { setError(err instanceof Error ? err.message : "Report not filed"); } finally { setSaving(false); }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold">Report abuse or impersonation</h1>
        <p className="text-sm text-muted-foreground">Someone using your name, a squatted repository or domain, malware, extortion or a security problem. A person reads every report; the open count and the age of the oldest are public on <a className="underline" href="/status">/status</a>.</p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm"><span className="font-medium">What kind of problem</span>
          <select className={field} value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label className="block text-sm"><span className="font-medium">What you are reporting</span><input className={field} value={target} maxLength={300} onChange={(e) => setTarget(e.target.value)} placeholder="Repository link, @handle or domain" required /></label>
        <label className="block text-sm"><span className="font-medium">What happened</span><textarea className={field} rows={6} value={details} maxLength={5000} onChange={(e) => setDetails(e.target.value)} placeholder="Include links and dates. Do not include passwords or tokens." required /></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        <Button type="submit" variant="orange" disabled={saving}>{saving ? "Filing…" : "File report"}</Button>
      </form>
      <section aria-labelledby="mine-h"><h2 id="mine-h" className="text-base font-semibold mb-2">Your reports</h2>{mine ? <ReportList reports={mine} /> : <p role="status" className="text-sm text-muted-foreground">Loading reports…</p>}</section>
    </div>
  );
}

/** The operator queue: open reports oldest first, each closed only with a written resolution. */
export function OperatorPage() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const load = useCallback(() => { setReports(null); apiJson<Report[]>(`/operator/reports?status=${status}`).then((r) => setReports(status === "open" ? [...r].reverse() : r)).catch((e: Error) => setError(e.message)); }, [status]);
  useEffect(load, [load]);
  const resolve = async (id: string) => {
    setError(null);
    try { await apiJson(`/operator/reports/${id}/resolve`, { method: "POST", json: { resolution: drafts[id] ?? "" } }); load(); } catch (e) { setError(e instanceof Error ? e.message : "Not saved"); }
  };
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-4">
      <h1 className="text-xl font-bold">Report queue</h1>
      <div className="flex gap-1 text-sm" role="tablist">{(["open", "resolved"] as const).map((s) => <button key={s} role="tab" aria-selected={status === s} className={`px-3 py-1 rounded-md capitalize ${status === s ? "bg-muted font-medium" : "text-muted-foreground"}`} onClick={() => setStatus(s)}>{s}</button>)}</div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!reports ? <p role="status" className="text-sm text-muted-foreground">Loading…</p> : (
        <>
          <ReportList reports={reports} />
          {status === "open" && reports.map((r) => (
            <form key={r.id} className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void resolve(r.id); }}>
              <input className={field} aria-label={`Resolution for ${r.id}`} placeholder={`What was done about ${r.id}`} value={drafts[r.id] ?? ""} onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })} />
              <Button type="submit" size="sm" disabled={!(drafts[r.id] ?? "").trim()}>Resolve</Button>
            </form>
          ))}
        </>
      )}
    </div>
  );
}
