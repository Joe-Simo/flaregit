import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { importSuccessorIntent, type ImportSuccessorIntent } from "../import-successor-intent";
import { apiJson } from "../api";
import type { ImportHistoryResult } from "@/server/import-history";
import type { MigrationReceipt } from "@/server/migration-receipt";

interface Inspection {
  instanceId: string; head: string; status: string; reason?: string | null;
  progress?: { source: { revision?: number; count: number; pending: number }; destination: { revision?: number; count: number; pending: number } };
  attemptGeneration?: number | null; workflowStatus?: string | null; canResume?: boolean;
  scopeChanged?: boolean; canStartSuccessor?: boolean; predecessorId?: string | null; successorId?: string | null;
  authority?: "durable-sql" | "legacy-r2" | "unavailable";
  receipt?: { head: string; inspectedAt: string; result: ImportHistoryResult | MigrationReceipt } | null; detail?: string;
}
const pauseReasons: Record<string,string> = {
  funding_unavailable: "Inspection paused because its spending allowance is unavailable. Saved progress is retained.",
  git_budget: "Inspection paused because its spending allowance is unavailable. Saved progress is retained.",
  history_metadata_capacity: "Inspection reached its ancestry storage limit. Saved progress is retained; the comparison is incomplete.",
  unsupported_source: "This source host is not supported by native inspection.",
  inspection_capacity: "Inspection reached its stored ancestry capacity. Saved progress is retained; complete history remains unverified.",
  source_shallow: "The captured source history is shallow. Complete ancestry remains unverified.",
  legacy_attempt_untracked: "This older inspection has no durable attempt and shutdown record. A replacement will not start.",
  attempt_identity_unavailable: "The saved attempt identity is unavailable. A replacement will not start.",
};
const operationPattern = /^import-history-[a-f0-9-]{36}$/;
const storageKey = (projectId: string) => `flaregit.import-history.${projectId}`;
const successorKey = (projectId: string) => `${storageKey(projectId)}.successor`;
const readSuccessor = (projectId: string) => { try { const value=localStorage.getItem(successorKey(projectId)); return value ? importSuccessorIntent(JSON.parse(value)) : null; } catch { return null; } };
const readSaved = (projectId: string) => { try { const value = localStorage.getItem(storageKey(projectId)); return value && operationPattern.test(value) ? value : null; } catch { return null; } };

/** Owner-only receipts are independent of imported browsing readiness. */
export function ImportHistoryCard({ projectId }: { projectId: string }) {
  const [instanceId, setInstanceId] = useState<string | null>(() => readSaved(projectId));
  const [successorIntent, setSuccessorIntent] = useState<ImportSuccessorIntent | null>(() => readSuccessor(projectId));
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const epoch = useRef(0), requestLock = useRef(false);
  const identity = useRef(projectId);
  identity.current = projectId;
  const load = useCallback(async (id: string) => {
    const request = ++epoch.current;
    setBusy(true); setError(null);
    try {
      const result = await apiJson<Inspection>(`/p/${projectId}/import-history/${id}`,{signal:AbortSignal.timeout(15_000)});
      if (request !== epoch.current || identity.current !== projectId) return;
      if (result.instanceId !== id) throw new Error("Inspection identity does not match the saved operation");
      setInstanceId(id); setInspection(result);
    } catch (failure) { if (request === epoch.current && identity.current === projectId) setError(failure instanceof Error ? failure.message : "Inspection status is unavailable"); }
    finally { if (request === epoch.current && identity.current === projectId) setBusy(false); }
  }, [projectId]);
  useEffect(() => {
    const saved = readSaved(projectId);
    setSuccessorIntent(readSuccessor(projectId));
    setInstanceId(saved); setInspection(null); setError(null); setNotice(null); setBusy(false);
    if (saved) void load(saved);
    return () => { epoch.current++; };
  }, [projectId, load]);
  const requestInspection = async (retryId?: string) => {
    if(requestLock.current)return;
    if(retryId && (!inspection?.canResume || !Number.isSafeInteger(inspection.attemptGeneration)))return;
    const expectedGeneration=inspection?.attemptGeneration;requestLock.current=true;
    const request = ++epoch.current;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await apiJson<Inspection>(`/p/${projectId}/import-history`, { method: "POST", json: retryId ? { instanceId: retryId, expectedGeneration } : {} });
      if (request !== epoch.current || identity.current !== projectId) return;
      if (!operationPattern.test(result.instanceId) || (retryId && result.instanceId !== retryId)) throw new Error("The returned inspection identity does not match; refresh status before retrying");
      setInstanceId(result.instanceId); setInspection(result);
      try { localStorage.setItem(storageKey(projectId), result.instanceId); }
      catch { setNotice("Inspection is saved on the server. This browser could not retain its ID for reopening; open Inspection details to copy its operation ID."); }
      if (result.status === "dispatch-unknown") setNotice(result.detail ?? "Inspection is saved; dispatch is uncertain. Check status or retry this same inspection.");
    } catch (failure) {
      if (request === epoch.current && identity.current === projectId) setError(`${failure instanceof Error ? failure.message : "Inspection request failed"}. The request outcome is not confirmed; repository browsing remains available.`);
    } finally { requestLock.current=false;if (request === epoch.current && identity.current === projectId) setBusy(false); }
  };
  const startSuccessor = async () => {
    if(requestLock.current)return;
    const intent=successorIntent ?? (inspection?.scopeChanged && inspection.canStartSuccessor ? importSuccessorIntent({predecessorId:inspection.instanceId,expectedGeneration:inspection.attemptGeneration}) : null);
    if(!intent)return;
    // Persist the exact predecessor intent before dispatch so a lost reply never creates a new request.
    try { localStorage.setItem(successorKey(projectId),JSON.stringify(intent)); }
    catch { setError("This browser could not save the recovery identity. No corrected inspection was requested."); return; }
    setSuccessorIntent(intent); requestLock.current=true;
    const request=++epoch.current; setBusy(true); setError(null); setNotice(null);
    try {
      const next=await apiJson<Inspection>(`/p/${projectId}/import-history`,{method:"POST",json:intent,signal:AbortSignal.timeout(30_000)});
      if(request!==epoch.current || identity.current!==projectId)return;
      if(!operationPattern.test(next.instanceId) || next.instanceId===intent.predecessorId || next.predecessorId!==intent.predecessorId)throw Error("Corrected inspection identity was not confirmed. Check the preserved inspection before retrying.");
      localStorage.setItem(storageKey(projectId),next.instanceId);
      localStorage.removeItem(successorKey(projectId));
      setSuccessorIntent(null); setInstanceId(next.instanceId); setInspection(next);
      setNotice("Corrected branch inspection saved. Its predecessor and recorded progress remain available.");
    } catch(failure) { if(request===epoch.current && identity.current===projectId)setError(`${failure instanceof Error ? failure.message : "Corrected inspection could not be confirmed"}. Retry uses this same preserved predecessor and generation.`); }
    finally {requestLock.current=false;if(request===epoch.current && identity.current===projectId)setBusy(false);}
  };
  const result = inspection?.receipt?.result;
  const receipt = result ? "receipt" in result ? result.receipt : "refs" in result ? result : null : null;
  const mismatchExamples=receipt ? [{label:"Different refs",values:receipt.differentRefs},{label:"Missing commits",values:receipt.missingCommits},{label:"Different commits",values:receipt.differentCommits}] : [];
  const canResume=inspection?.canResume === true && Number.isSafeInteger(inspection.attemptGeneration);
  const ancestryRemains=Boolean(inspection?.progress && (inspection.progress.source.pending>0 || inspection.progress.destination.pending>0));
  const statusLabel=result?.status === "verified" ? "Selected branch verified" : result?.status === "mismatch" ? "History mismatch" : inspection?.status === "paused" ? "Paused" : inspection?.status === "running" ? "Inspecting" : inspection ? "Unverified" : null;
  return <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex flex-wrap items-center gap-2">Import history{statusLabel && <Badge variant={result?.status === "verified" ? "success" : result?.status === "mismatch" ? "destructive" : "warning"}>{statusLabel}</Badge>}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm min-w-0">
    <p className="text-muted-foreground">Check the selected branch’s history against its source. Repository browsing remains available.</p>
    {inspection?.progress && <dl className="grid grid-cols-2 gap-4"><div><dt className="text-xs text-muted-foreground">Source commits saved</dt><dd className="mt-1 font-medium tabular-nums">{inspection.progress.source.count.toLocaleString()}</dd></div><div><dt className="text-xs text-muted-foreground">Imported commits saved</dt><dd className="mt-1 font-medium tabular-nums">{inspection.progress.destination.count.toLocaleString()}</dd></div></dl>}
    {ancestryRemains && <p className="text-xs text-muted-foreground">More ancestry remains. The comparison is incomplete.</p>}
    {inspection?.reason && <p className="text-xs leading-5 text-muted-foreground">{pauseReasons[inspection.reason] ?? "Inspection is paused. Saved progress is retained; refresh to check its status."}</p>}
    {inspection?.scopeChanged && <p className="text-xs leading-5 text-muted-foreground">The selected branch changed. This inspection retains its original head and saved progress. A corrected inspection uses the current branch and preserves this record.</p>}
    {inspection?.predecessorId && inspection.predecessorId !== inspection.instanceId && <p className="text-xs break-all">Continues from <button type="button" className="underline underline-offset-4" disabled={busy} onClick={()=>void load(inspection.predecessorId!)}>{inspection.predecessorId}</button></p>}
    {inspection?.successorId && <Button size="sm" variant="outline" disabled={busy} onClick={()=>void load(inspection.successorId!)}>Open corrected inspection</Button>}
    {(successorIntent || (inspection?.scopeChanged && inspection.canStartSuccessor)) && <Button size="sm" variant="outline" disabled={busy} onClick={()=>void startSuccessor()}>{successorIntent ? "Recover corrected inspection" : "Inspect corrected branch"}</Button>}
    {error && <p role="alert" className="text-sm text-destructive">{error}{inspection && " Showing the last loaded inspection."}</p>}
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    <div className="flex flex-wrap gap-2">{!instanceId && <Button size="sm" disabled={busy} onClick={() => void requestInspection()}>{busy ? "Requesting…" : error ? "Recover saved inspection" : "Inspect imported history"}</Button>}{instanceId && <><Button size="sm" variant="outline" disabled={busy} onClick={() => void load(instanceId)}>{busy ? "Checking…" : "Refresh status"}</Button>{canResume && <Button size="sm" variant="outline" disabled={busy} onClick={() => void requestInspection(instanceId)}>Resume saved inspection</Button>}</>}<Button size="sm" variant="ghost" onClick={()=>setDetailsOpen(true)}>Inspection details</Button></div>
    <p className="text-xs text-muted-foreground">Selected-branch ancestry only. Source capture supports public github.com repositories.</p>
    <Dialog open={detailsOpen} onOpenChange={setDetailsOpen} className="max-h-[calc(100dvh-2rem)] overflow-y-auto"><DialogClose onClick={()=>setDetailsOpen(false)} /><DialogHeader><DialogTitle>Import inspection details</DialogTitle><DialogDescription>Saved scope, progress and verification checks.</DialogDescription></DialogHeader><div className="space-y-4 text-sm min-w-0">
      <p className="text-xs text-muted-foreground leading-5">Inspection compares commit ancestry, tree IDs and parent order at the saved head. It does not prove blob recovery, tags or every repository ref. Source capture supports public github.com repositories without redirects; other source hosts remain unverified. New inspections save bounded chunks. Stored capacity limits can leave the comparison incomplete.</p>
      {instanceId && <p className="text-xs break-all">Saved operation <code>{instanceId}</code></p>}
      {inspection && <><p className="text-xs break-all">Imported head pinned for inspection <code>{inspection.head}</code></p><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs"><dt>Inspection</dt><dd>{inspection.status}</dd>{inspection.workflowStatus && <><dt>Workflow observation</dt><dd>{inspection.workflowStatus}</dd></>}{inspection.attemptGeneration!==null && inspection.attemptGeneration!==undefined && <><dt>Attempt</dt><dd>{inspection.attemptGeneration}</dd></>}{inspection.progress && <><dt>Source ancestry</dt><dd>{inspection.progress.source.pending>0 ? "More ancestry remains" : "No open ancestry paths recorded"}</dd><dt>Imported ancestry</dt><dd>{inspection.progress.destination.pending>0 ? "More ancestry remains" : "No open ancestry paths recorded"}</dd></>}</dl></>}
      {inspection?.status === "paused" && !canResume && <p className="text-xs text-muted-foreground">Resume is unavailable until the saved attempt is confirmed stopped and its authority and capacity are rechecked. Refresh status to check again.</p>}
      {inspection?.authority === "legacy-r2" && <p className="text-xs text-muted-foreground">Older stored receipt. It does not authorize a replacement attempt.</p>}
      {inspection?.receipt && <p className="text-xs">Inspected {new Date(inspection.receipt.inspectedAt).toLocaleString()}</p>}
      {receipt && <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs"><dt>Compared commits</dt><dd>{receipt.commitsCompared}</dd><dt>Selected refs</dt><dd className="break-all font-mono">{receipt.refs.join(", ")}</dd><dt>Source snapshot</dt><dd>{new Date(receipt.sourceCapturedAt).toLocaleString()}</dd><dt>Imported snapshot</dt><dd>{new Date(receipt.destinationCapturedAt).toLocaleString()}</dd></dl>}
      {receipt?.status === "mismatch" && <section className="space-y-3"><h3 className="text-sm font-medium">Recorded mismatch examples</h3>{mismatchExamples.map(({label,values})=><div key={label}><h4 className="text-xs font-medium">{label} · {values.length} examples</h4><ul className="mt-1 space-y-1 text-xs">{values.map(value=><li key={value}><code className="break-all">{value}</code></li>)}</ul></div>)}<p className="text-xs text-muted-foreground">Examples are bounded; the result below gives the inspection’s conclusion.</p></section>}
      {result ? <p className="text-xs leading-5">{result.detail}</p> : <p className="text-xs text-muted-foreground">No completed receipt has been loaded. Saved counts and workflow status alone do not prove that history matches.</p>}
    </div></Dialog>
  </CardContent></Card>;
}
