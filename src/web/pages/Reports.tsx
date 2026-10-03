import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { apiJson } from "../api";
import { safeReportTarget } from "../report-target";
import { timeAgo } from "../router";

interface Report { id: string; at: string; kind: string; target: string; details: string; status: "open" | "resolved"; resolution: string | null; resolved_by: string | null; resolved_at: string | null }
const KINDS: Array<[string, string]> = [["impersonation", "Impersonation"], ["namespace_squatting", "Name or domain squatting"], ["malware", "Malware or extortion"], ["harassment", "Harassment"], ["security", "Security vulnerability"], ["other", "Other"]];
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

function ReportList({ reports, actions }: { reports: Report[]; actions?: (report: Report) => React.ReactNode }) {
  if (reports.length === 0) return <p className="text-sm text-muted-foreground">No reports.</p>;
  return (
    <ul className="space-y-2">
      {reports.map((r) => (
        <li key={r.id} className="rounded-md border border-border p-3 text-sm space-y-1">
          <div className="flex flex-wrap items-center gap-2"><Badge variant={r.status === "open" ? "warning" : "success"}>{r.status}</Badge><span className="font-medium">{KINDS.find((k) => k[0] === r.kind)?.[1] ?? r.kind}</span><span className="text-muted-foreground break-all">{r.target}</span><span className="text-xs text-muted-foreground">{r.id} · {timeAgo(r.at)}</span></div>
          <p className="whitespace-pre-wrap break-words">{r.details}</p>
          {r.resolution && <p className="text-muted-foreground">Resolution by {r.resolved_by}{r.resolved_at ? ` ${timeAgo(r.resolved_at)}` : ""}: {r.resolution}</p>}
          {actions?.(r)}
        </li>
      ))}
    </ul>
  );
}

/** Anyone signed in can report; reports enter the operator queue, and its status stays visible to the reporter. */
const reportDrafts = new Map<string, {kind:string;target:string;details:string}>();
let draftActor: string | null = null;
export function ReportPage({ initialTarget = null, initialKind = null }: { initialTarget?: string | null; initialKind?: string | null }) {
  const { userId } = useAuth();
  // Identity changes invalidate module-held private complaint details before hydration.
  if (draftActor !== (userId ?? null)) { reportDrafts.clear(); draftActor = userId ?? null; }
  if (!userId) return null;
  return <ReportForm key={`${userId}:${safeReportTarget(initialTarget) ?? ""}`} actor={userId} initialTarget={initialTarget} initialKind={initialKind} />;
}
function ReportForm({ actor, initialTarget, initialKind }: { actor: string; initialTarget: string | null; initialKind: string | null }) {
  const context = safeReportTarget(initialTarget) ?? "";
  const cacheKey = JSON.stringify([actor, context]);
  const savedDraft = reportDrafts.get(cacheKey);
  const [kind, setKind] = useState(savedDraft?.kind ?? (KINDS.some(item => item[0] === initialKind) ? initialKind! : "impersonation"));
  const [target, setTarget] = useState(savedDraft?.target ?? context);
  const [details, setDetails] = useState(savedDraft?.details ?? "");
  useEffect(() => { if (draftActor !== actor) return; if (reportDrafts.size >= 10 && !reportDrafts.has(cacheKey)) reportDrafts.delete(reportDrafts.keys().next().value ?? ""); reportDrafts.set(cacheKey, {kind,target:target.slice(0,300),details:details.slice(0,5000)}); }, [actor,cacheKey,kind,target,details]);
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
      reportDrafts.delete(cacheKey); setTarget(""); setDetails("");
      void load();
    } catch (err) { setError(err instanceof Error ? err.message : "Report not filed"); } finally { setSaving(false); }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold">Report abuse or impersonation</h1>
        <p className="text-sm text-muted-foreground">Someone using your name, a squatted repository or domain, malware, extortion or a security problem. Reports are saved for operator review, and a written resolution is required when closed. The open count and age of the oldest are public on <a className="underline" href="/status">/status</a>.</p>
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
  const [queues, setQueues] = useState<Partial<Record<"open" | "resolved", Report[]>>>({});
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<Partial<Record<"open" | "resolved", string | null>>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const pendingIds = useRef(new Set<string>());
  const sequence = useRef(0);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const request = ++sequence.current;
    setLoading(true);
    setLoadErrors(previous => ({ ...previous, [status]: null }));
    void apiJson<Report[]>(`/operator/reports?status=${status}`, { signal: controller.signal }).then(reports => {
      if (controller.signal.aborted || request !== sequence.current) return;
      setQueues(previous => ({ ...previous, [status]: reports }));
    }).catch(error => {
      if (controller.signal.aborted || request !== sequence.current) return;
      setLoadErrors(previous => ({ ...previous, [status]: error instanceof Error ? error.message : "Reports could not be loaded" }));
    }).finally(() => {
      if (!controller.signal.aborted && request === sequence.current) setLoading(false);
    });
    return () => controller.abort();
  }, [status, refresh]);
  const resolve = async (id: string) => {
    if (pendingIds.current.has(id)) return;
    const resolution = (drafts[id] ?? "").trim();
    if (!resolution) return;
    pendingIds.current.add(id);
    setPending(previous => ({ ...previous, [id]: true }));
    setErrors(previous => ({ ...previous, [id]: null }));
    try {
      await apiJson(`/operator/reports/${id}/resolve`, { method: "POST", json: { resolution, expectedStatus: "open" } });
      setQueues(previous => ({ ...previous, open: previous.open?.filter(report => report.id !== id) }));
      setDrafts(previous => { const next = { ...previous }; delete next[id]; return next; });
      setRefresh(previous => previous + 1);
    } catch (error) {
      setErrors(previous => ({ ...previous, [id]: error instanceof Error ? error.message : "Resolution not saved" }));
    } finally {
      pendingIds.current.delete(id);
      setPending(previous => ({ ...previous, [id]: false }));
    }
  };
  const reports = queues[status];
  const loadError = loadErrors[status];
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-4">
      <h1 className="text-xl font-bold">Report queue</h1>
      <Tabs value={status} onValueChange={value => { if (value !== status && (value === "open" || value === "resolved")) { sequence.current++; setLoading(true); setStatus(value); } }}>
        <TabsList><TabsTrigger value="open">Open</TabsTrigger><TabsTrigger value="resolved">Resolved</TabsTrigger></TabsList>
      </Tabs>
      {loadError && <div className="flex flex-wrap items-center gap-2"><p role="alert" className="text-sm text-destructive">{loadError}</p><Button variant="outline" size="sm" disabled={loading} onClick={() => setRefresh(previous => previous + 1)}>Retry</Button></div>}
      {loading && <p role="status" className="text-sm text-muted-foreground">Loading reports…</p>}
      {reports && <ReportList reports={reports} actions={status === "open" ? report => (
        <form className="space-y-2 pt-2" onSubmit={event => { event.preventDefault(); void resolve(report.id); }}>
          <label className="block"><span className="font-medium">Resolution</span><textarea className={field} rows={2} maxLength={2000} placeholder="What was done about this report" value={drafts[report.id] ?? ""} disabled={pending[report.id]} onChange={event => setDrafts(previous => ({ ...previous, [report.id]: event.target.value }))} required /></label>
          {errors[report.id] && <p role="alert" className="text-destructive">{errors[report.id]}</p>}
          <Button type="submit" size="sm" disabled={pending[report.id] || !(drafts[report.id] ?? "").trim()}>{pending[report.id] ? "Saving…" : "Resolve report"}</Button>
        </form>
      ) : undefined} />}
    </div>
  );
}
