import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch, apiJson, ApiError } from "../api";
import type { RebaseRecoveryReceipt, RebaseRecoveryReport } from "@/server/rebase-recovery";
import type { Task } from "@/core/types";
type SafeRecoveryReceipt=Omit<RebaseRecoveryReceipt,"actor"> & {actor:Pick<RebaseRecoveryReceipt["actor"],"displayName"|"viaToken">};
interface SavedUpdates { applications: RebaseRecoveryReport[]; truncated: boolean }
const blockedStatus = new Set(["newer_work", "metadata_changed", "remote_old_resume_required"]);
const explanation = (report: RebaseRecoveryReport) => report.status === "remote_old_resume_required"
  ? "The restored result is saved; the branch still needs to be updated. Recovery is unavailable for this state."
  : report.status === "newer_work" ? "Newer work is present. Recovery is blocked to preserve it."
  : report.status === "metadata_changed" ? "The saved scope changed. Refresh and inspect the current revisions before continuing."
  : report.status === "already_applied" || report.status === "reconciled" ? "The saved update is recorded on the change."
  : report.detail;
export function RebaseRecovery({ projectId, isOwner, tasks, onRecovered }: { projectId: string; isOwner: boolean; tasks?: Record<string,Task>; onRecovered:()=>void }) {
  return isOwner ? <OwnerRecovery key={projectId} projectId={projectId} tasks={tasks} onRecovered={onRecovered} /> : null;
}
function OwnerRecovery({ projectId, tasks, onRecovered }: { projectId:string; tasks?:Record<string,Task>; onRecovered:()=>void }) {
  const [loaded,setLoaded]=useState<SavedUpdates|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
  const [selected,setSelected]=useState<RebaseRecoveryReport|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false);
  const [receipt,setReceipt]=useState<SafeRecoveryReceipt|null>(null),[actionError,setActionError]=useState<string|null>(null);
  const epoch=useRef(0),sequence=useRef(0),controller=useRef<AbortController|null>(null),mutationLock=useRef(false);
  const intent=useRef<{applicationId:string;version:number;key:string}|null>(null);
  useEffect(()=>{epoch.current++;return()=>{epoch.current++;sequence.current++;controller.current?.abort();};},[projectId]);
  const load=useCallback(async()=>{
    const generation=epoch.current,request=++sequence.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setLoading(true);setError(null);
    try{const value=await apiJson<SavedUpdates>(`/p/${projectId}/rebase-applications`,{signal:abort.signal});if(generation===epoch.current&&request===sequence.current)setLoaded(value);}
    catch(cause){if(generation===epoch.current&&request===sequence.current&&!abort.signal.aborted){setError(cause instanceof Error?cause.message:"Saved updates are unavailable");if(cause instanceof ApiError&&[401,403,404].includes(cause.status))setLoaded(null);}}
    finally{if(generation===epoch.current&&request===sequence.current)setLoading(false);}
  },[projectId]);
  useEffect(()=>{void load();},[load]);
  const recover=async()=>{
    if(!selected||!confirmed||mutationLock.current||loading||error||!selected.canReconcile||blockedStatus.has(selected.status)||!loaded?.applications.some(report=>report.id===selected.id&&report.version===selected.version))return;
    const generation=epoch.current;
    if(intent.current?.applicationId!==selected.id||intent.current.version!==selected.version)intent.current={applicationId:selected.id,version:selected.version,key:crypto.randomUUID()};
    const request=intent.current;mutationLock.current=true;setBusy(true);setActionError(null);setReceipt(null);
    try{
      const response=await apiFetch(`/api/p/${projectId}/rebase-applications/${selected.id}/reconcile`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expectedVersion:request.version,idempotencyKey:request.key})});
      const value=await response.json() as SafeRecoveryReceipt & {error?:string;report?:RebaseRecoveryReport};
      if(generation!==epoch.current)return;
      if(!response.ok){
        if(value.report?.id===selected.id){const report=value.report;setSelected(report);setLoaded(previous=>previous?{...previous,applications:previous.applications.map(row=>row.id===report.id?report:row)}:previous);}
        if([401,403,404].includes(response.status)){setLoaded(null);setSelected(null);setConfirmed(false);}
        setActionError(`${value.error ?? "Recovery could not be confirmed"}${!value.report ? ". Retrying this saved request reuses its recovery key." : ""}`);return;
      }
      if(value.applicationId!==request.applicationId||value.version!==request.version+Number(value.status==="reconciled")||!["reconciled","already_applied"].includes(value.status))throw new Error("Recovery receipt does not match this saved request");
      setReceipt(value);setConfirmed(false);intent.current=null;onRecovered();await load();
    }catch(cause){if(generation===epoch.current)setActionError(`The recovery result is unknown. The saved update is retained; retrying unchanged revisions reuses the same request. ${cause instanceof Error?cause.message:""}`);}
    finally{mutationLock.current=false;if(generation===epoch.current)setBusy(false);}
  };
  if(loaded?.applications.length===0&&!error)return null;
  const recordCurrent=Boolean(selected&&loaded?.applications.some(report=>report.id===selected.id&&report.version===selected.version));
  const allowed=recordCurrent&&!loading&&!error&&selected?.canReconcile===true&&!blockedStatus.has(selected.status);
  const inspect=(commit:string,base:string)=>`/#/p/${projectId}/review?commit=${commit}&base=${base}&from=recovery`;
  return <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Saved branch updates</CardTitle></CardHeader><CardContent className="space-y-3 min-w-0">
    <p className="text-xs text-muted-foreground">Check saved branch updates after an interruption. Repository history still requires review and acceptance.</p>
    {loading&&!loaded&&<p role="status" className="text-sm text-muted-foreground">Loading saved updates…</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}{loaded&&" Showing the last loaded records."}</p>}
    <Button variant="ghost" size="sm" disabled={loading||busy} onClick={()=>void load()}>{loading?"Refreshing…":"Refresh saved records"}</Button>
    {loaded&&<ul className="divide-y divide-border">{loaded.applications.map(report=><li key={report.id} className="py-3 flex flex-wrap justify-between items-start gap-3"><div className="min-w-0 flex-1"><h3 className="text-sm font-medium break-words">{tasks?.[report.taskId]?.goal ?? report.taskId}</h3><p className="mt-1 text-xs text-muted-foreground break-words">{explanation(report)}</p></div><Button size="sm" variant="outline" disabled={busy} onClick={()=>{setSelected(report);setConfirmed(false);setReceipt(null);setActionError(null);}}>Inspect saved update</Button></li>)}</ul>}
    {loaded?.truncated&&<p className="text-xs text-muted-foreground">This is a bounded list of saved updates. Additional records are not shown.</p>}
    <Dialog open={selected!==null} onOpenChange={open=>{if(!open&&!busy){setSelected(null);setConfirmed(false);}}} className="max-h-[calc(100dvh-2rem)] overflow-y-auto"><DialogClose onClick={()=>{if(!busy){setSelected(null);setConfirmed(false);}}}/><DialogHeader><DialogTitle>Recover saved update</DialogTitle><DialogDescription>Inspect the original and saved revisions before checking the branch and restoring its update record.</DialogDescription></DialogHeader>{selected&&<div className="space-y-4 text-sm min-w-0">
      <div className="space-y-3"><div><h3 className="text-xs font-medium">Original revision</h3><p className="mt-1 text-xs break-all"><code>{selected.originalCommit}</code></p><p className="mt-1 text-xs text-muted-foreground break-all"><span className="block">Base</span><code className="block">{selected.originalBase}</code></p><a className="text-xs text-primary hover:underline" href={inspect(selected.originalCommit,selected.originalBase)}>Inspect original diff</a></div><div><h3 className="text-xs font-medium">Saved revision</h3><p className="mt-1 text-xs break-all"><code>{selected.commit}</code></p><p className="mt-1 text-xs text-muted-foreground break-all"><span className="block">Base</span><code className="block">{selected.base}</code></p><a className="text-xs text-primary hover:underline" href={inspect(selected.commit,selected.base)}>Inspect saved diff</a></div></div>
      <p className="text-xs text-muted-foreground">The branch will be checked before recovery. Your current owner permissions are used; original Git authorship stays unchanged.</p>
      <p className="text-xs leading-5">{explanation(selected)}</p>
      {!receipt&&(error||loading||!recordCurrent)&&<p role="status" className="text-xs text-muted-foreground">{error ? "Recovery is paused until saved records can be refreshed." : loading ? "Checking current saved records…" : "Saved records changed. Close and reopen this update to review the current revisions."}</p>}
      {actionError&&<p role="alert" className="text-sm text-destructive">{actionError}</p>}
      {receipt&&<p role="status" className="text-xs text-emerald-800 dark:text-emerald-200">{receipt.status === "already_applied" ? "This update was already recorded. No new recovery was applied." : <>Update record recovered by {receipt.actor.displayName}{receipt.actor.viaToken?" via API credential":" from a signed-in session"} at {new Date(receipt.recordedAt).toLocaleString()}.</>} No repository history was accepted.</p>}
      {!receipt&&allowed&&<><label className="flex items-start gap-2 text-xs leading-5"><Input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 p-0"/>I reviewed these revisions and want to recover this update record. Newer contributor work must remain intact.</label><Button size="sm" disabled={busy||!confirmed} onClick={()=>void recover()}>{busy?"Recovering…":actionError?"Retry recovery":"Recover update"}</Button></>}
    </div>}</Dialog>
  </CardContent></Card>;
}
