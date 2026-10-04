import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { apiJson } from "../api";
import { safeReportTarget } from "../report-target";
import {OperatorReservations} from "./OperatorReservations";
import { timeAgo } from "../router";

interface Report { id: string; at: string; kind: string; target: string; details: string; status: "open" | "resolved"; resolution: string | null; resolved_by: string | null; resolved_at: string | null }
interface ReportPageResult { reports: Report[]; nextCursor: string | null }
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
  const [mineCursor, setMineCursor] = useState<string | null>(null);
  const [mineLoadingMore, setMineLoadingMore] = useState(false);
  const load = useCallback(() => apiJson<ReportPageResult>("/reports").then(page => { setMine(page.reports); setMineCursor(page.nextCursor); }).catch((e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  const loadMineMore = async () => {
    if (!mineCursor || mineLoadingMore) return;
    setMineLoadingMore(true);
    try {
      const page = await apiJson<ReportPageResult>(`/reports?cursor=${encodeURIComponent(mineCursor)}`);
      setMine(previous => { const existing = previous ?? []; const ids = new Set(existing.map(report => report.id)); return [...existing, ...page.reports.filter(report => !ids.has(report.id))]; });
      setMineCursor(page.nextCursor);
    } catch (error) { setError(error instanceof Error ? error.message : "More reports could not be loaded"); }
    finally { setMineLoadingMore(false); }
  };
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
      <section aria-labelledby="mine-h"><h2 id="mine-h" className="text-base font-semibold mb-2">Your reports</h2>{mine ? <ReportList reports={mine} /> : <p role="status" className="text-sm text-muted-foreground">Loading reports…</p>}{mineCursor && <Button className="mt-3" variant="outline" disabled={mineLoadingMore} onClick={() => void loadMineMore()}>{mineLoadingMore ? "Loading more…" : "Load more reports"}</Button>}</section>
    </div>
  );
}

interface PublicationTarget { kind: string; targetId: string }
interface PublicationControlState { target: PublicationTarget; state: { suppressed: boolean; version: number; reason: string | null; reportId: string | null }; history: Array<{ id: string; action: string; reason: string; decidedAt: string }> }
const publicationDrafts = new Map<string,string>();
let publicationDraftActor: string | null = null;
function PublicationControl({ report }: { report: Report }) {
  const {userId}=useAuth();
  if (publicationDraftActor !== (userId ?? null)) { publicationDrafts.clear(); publicationDraftActor=userId??null; }
  return userId ? <PublicationControlForm key={`${userId}:${report.id}`} report={report} userId={userId} /> : null;
}
function PublicationControlForm({report,userId}:{report:Report;userId:string}) {
  const draftKey=JSON.stringify([userId,report.id]);
  const [expanded,setExpanded]=useState(false);
  const [control, setControl] = useState<PublicationControlState | null>(null);
  const [reason, setReason] = useState(publicationDrafts.get(draftKey)??"");
  useEffect(()=>{if(publicationDraftActor!==userId)return;if(publicationDrafts.size>=100&&!publicationDrafts.has(draftKey))publicationDrafts.delete(publicationDrafts.keys().next().value??"");publicationDrafts.set(draftKey,reason);},[draftKey,reason,userId]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    try { const result = await apiJson<PublicationControlState>(`/operator/reports/${report.id}/publication`); if (request === sequence.current) { setControl(result); setConfirmed(false); setError(null); } }
    catch (error) { if (request === sequence.current) setError(error instanceof Error ? error.message : "Publication control unavailable"); }
  }, [report.id]);
  useEffect(() => { if(expanded)void load(); return () => { sequence.current++; }; }, [expanded,load]);
  const change = async () => {
    if (!control || busy || !confirmed || !reason.trim()) return;
    const action = control.state.suppressed ? "lift" : "suppress";
    const payload = JSON.stringify({ action, expectedVersion: control.state.version, reason: reason.trim() });
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
    setBusy(true); setError(null);
    try {
      await apiJson(`/operator/reports/${report.id}/publication`, { method: "POST", json: { action, confirmed: true, confirmedTarget: `${control.target.kind}:${control.target.targetId}`, reason: reason.trim(), reportId: report.id, expectedVersion: control.state.version, idempotencyKey: attempt.current.key } });
      setReason(""); setConfirmed(false); attempt.current = null; await load();
    } catch (error) { const message = error instanceof Error ? error.message : "Publication decision not saved"; await load(); setError(message); }
    finally { setBusy(false); }
  };
  if(!expanded)return <Button variant="outline" size="sm" onClick={()=>setExpanded(true)}>Review public visibility</Button>;
  return <section className="space-y-2 border-t border-border pt-3 mt-3" aria-label="Publication control">
    {error && <p role="alert" className="text-destructive break-words">{error}</p>}
    {!control && <Button variant="outline" size="sm" onClick={() => void load()}>Reload publication control</Button>}
    {control && <>
      <p className="font-medium">Public visibility: {control.state.suppressed ? "Suppressed" : "Available"}</p>
      <p className="text-muted-foreground break-all">{control.target.kind}: {control.target.targetId}</p>
      {control.state.reason && <p className="whitespace-pre-wrap break-words">Current decision: {control.state.reason}</p>}
      <label className="block">Decision reason<textarea className={field} rows={2} maxLength={2000} value={reason} disabled={busy} onChange={event => { setReason(event.target.value); setConfirmed(false); }} /></label>
      <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /><span>I confirm {control.state.suppressed ? "restoring" : "suppressing"} public visibility for this exact target.</span></label>
      <Button variant="outline" size="sm" disabled={busy || !confirmed || !reason.trim()} onClick={() => void change()}>{busy ? "Saving decision…" : control.state.suppressed ? "Restore public visibility" : "Suppress public visibility"}</Button>
      {control.history.length > 0 && <details><summary>Decision history</summary><ul className="space-y-1 mt-2">{control.history.map((decision,index) => <li key={decision.id??index} className="break-words">{decision.action} · {timeAgo(decision.decidedAt)} · {decision.reason}</li>)}</ul></details>}
    </>}
  </section>;
}

/** The operator queue: open reports oldest first, each closed only with a written resolution. */
export function OperatorPage() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [queues, setQueues] = useState<Partial<Record<"open" | "resolved", Report[]>>>({});
  const [loading, setLoading] = useState(true);
  const [cursors, setCursors] = useState<Partial<Record<"open" | "resolved", string | null>>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const pagePending = useRef(false);
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
    void apiJson<ReportPageResult>(`/operator/reports?status=${status}`, { signal: controller.signal }).then(page => {
      if (controller.signal.aborted || request !== sequence.current) return;
      setQueues(previous => ({ ...previous, [status]: page.reports }));
      setCursors(previous => ({ ...previous, [status]: page.nextCursor }));
    }).catch(error => {
      if (controller.signal.aborted || request !== sequence.current) return;
      setLoadErrors(previous => ({ ...previous, [status]: error instanceof Error ? error.message : "Reports could not be loaded" }));
    }).finally(() => {
      if (!controller.signal.aborted && request === sequence.current) setLoading(false);
    });
    return () => controller.abort();
  }, [status, refresh]);
  const loadMore = async () => {
    const cursor = cursors[status];
    if (!cursor || loading || pagePending.current) return;
    pagePending.current = true;
    setLoadingMore(true);
    const request = sequence.current;
    const requestedStatus = status;
    setLoadErrors(previous => ({ ...previous, [requestedStatus]: null }));
    try {
      const page = await apiJson<ReportPageResult>(`/operator/reports?status=${requestedStatus}&cursor=${encodeURIComponent(cursor)}`);
      if (request !== sequence.current) return;
      setQueues(previous => {
        const existing = previous[requestedStatus] ?? [];
        const ids = new Set(existing.map(report => report.id));
        return { ...previous, [requestedStatus]: [...existing, ...page.reports.filter(report => !ids.has(report.id))] };
      });
      setCursors(previous => ({ ...previous, [requestedStatus]: page.nextCursor }));
    } catch (error) {
      if (request === sequence.current) setLoadErrors(previous => ({ ...previous, [requestedStatus]: error instanceof Error ? error.message : "More reports could not be loaded" }));
    } finally {
      pagePending.current = false;
      setLoadingMore(false);
    }
  };
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
        <TabsList aria-label="Report status"><TabsTrigger value="open">Open</TabsTrigger><TabsTrigger value="resolved">Resolved</TabsTrigger></TabsList>
      </Tabs>
      {loadError && <div className="flex flex-wrap items-center gap-2"><p role="alert" className="text-sm text-destructive">{loadError}</p><Button variant="outline" size="sm" disabled={loading} onClick={() => setRefresh(previous => previous + 1)}>Retry</Button></div>}
      {loading && <p role="status" className="text-sm text-muted-foreground">Loading reports…</p>}
      {reports && <ReportList reports={reports} actions={report => (
        <div><PublicationControl key={report.id} report={report} />{status === "open" && <form className="space-y-2 pt-2" onSubmit={event => { event.preventDefault(); void resolve(report.id); }}>
          <label className="block"><span className="font-medium">Resolution</span><textarea className={field} rows={2} maxLength={2000} placeholder="What was done about this report" value={drafts[report.id] ?? ""} disabled={pending[report.id]} onChange={event => setDrafts(previous => ({ ...previous, [report.id]: event.target.value }))} required /></label>
          {errors[report.id] && <p role="alert" className="text-destructive">{errors[report.id]}</p>}
          <Button type="submit" size="sm" disabled={pending[report.id] || !(drafts[report.id] ?? "").trim()}>{pending[report.id] ? "Saving…" : "Resolve report"}</Button>
        </form>}</div>
      )} />}
      {cursors[status] && <Button variant="outline" disabled={loading || loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading more…" : "Load more reports"}</Button>}
      <OperatorReservations />
    </div>
  );
}
