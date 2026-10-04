import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch, apiJson, ApiError } from "../api";
import type { RebaseRecoveryReceipt, RebaseRecoveryReport } from "@/server/rebase-recovery";
import { useVisiblePolling } from "../use-visible-polling";
import type { RebaseResumeAttempt } from "@/server/rebase-resume-attempts";
import type { Task } from "@/core/types";
type SafeRecoveryReceipt=Omit<RebaseRecoveryReceipt,"actor"> & {actor:Pick<RebaseRecoveryReceipt["actor"],"displayName"|"viaToken">};
type ResumeSummary=Pick<RebaseResumeAttempt,"id"|"applicationId"|"generation"|"dispatch"|"nativeState"|"terminal"|"pauseReason">;
type RecoveryReport=RebaseRecoveryReport & {resumeAvailable?:boolean;resume?:Omit<ResumeSummary,"applicationId">};
interface SavedUpdates { applications: RecoveryReport[]; truncated: boolean }
const blockedStatus = new Set(["newer_work", "metadata_changed", "remote_old_resume_required"]);
const explanation = (report: RecoveryReport) => {
  const attempt=report.resume;
  if(attempt){
    if(attempt.dispatch==="unknown")return report.savedStatus==="applied"?"The saved update was recorded; execution confirmation remains incomplete.":"Dispatch is unconfirmed. The branch may have changed; no replacement will start while its outcome is unknown.";
    if(attempt.terminal==="completed"&&attempt.nativeState==="stopped")return "Saved branch update completed. This operation did not accept repository history.";
    if(attempt.terminal==="failed")return report.savedStatus==="applied"?"The saved update was recorded. Execution cleanup needs inspection.":"The attempt paused. Saved revisions are retained.";
    return "The saved update is being checked and applied. Completion is not yet confirmed.";
  }
  return report.status === "remote_old_resume_required"
    ? report.resumeAvailable ? "The last branch check found the original checkpoint. Apply the protected saved update after inspecting its revisions." : "The restored result is saved; branch updates are unavailable in this environment."
    : report.status === "newer_work" ? "Newer work is present. Recovery is blocked to preserve it."
    : report.status === "metadata_changed" ? "The saved scope changed. Refresh and inspect the current revisions before continuing."
    : report.status === "already_applied" || report.status === "reconciled" ? "The saved update is recorded on the change."
    : report.detail;
};
export function RebaseRecovery({ projectId, isOwner, tasks, onRecovered }: { projectId: string; isOwner: boolean; tasks?: Record<string,Task>; onRecovered:()=>void }) {
  return isOwner ? <OwnerRecovery key={projectId} projectId={projectId} tasks={tasks} onRecovered={onRecovered} /> : null;
}
function OwnerRecovery({ projectId, tasks, onRecovered }: { projectId:string; tasks?:Record<string,Task>; onRecovered:()=>void }) {
  const [loaded,setLoaded]=useState<SavedUpdates|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState<string|null>(null);
  const [selected,setSelected]=useState<RecoveryReport|null>(null),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false);
  const [receipt,setReceipt]=useState<SafeRecoveryReceipt|null>(null),[actionError,setActionError]=useState<string|null>(null);
  const [resumeError,setResumeError]=useState(false);
  const epoch=useRef(0),sequence=useRef(0),controller=useRef<AbortController|null>(null),mutationLock=useRef(false);
  const intent=useRef<{applicationId:string;version:number;key:string}|null>(null);
  const resumeIntent=useRef<{applicationId:string;version:number;previousGeneration:number;key:string}|null>(null);
  const refreshedAttempts=useRef(new Set<string>()), completedAttempts=useRef(new Set<string>());
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
      const value=await response.json() as SafeRecoveryReceipt & {error?:string;report?:RecoveryReport};
      if(generation!==epoch.current)return;
      if(!response.ok){
        if(value.report?.id===selected.id){const report=value.report;setSelected(previous=>({...report,...(previous?.resume&&!report.resume?{resume:previous.resume}:{})}));setConfirmed(false);setLoaded(previous=>previous?{...previous,applications:previous.applications.map(row=>row.id===report.id?report:row)}:previous);}
        if([401,403,404].includes(response.status)){setLoaded(null);setSelected(null);setConfirmed(false);}
        setActionError(value.report?.status==="remote_old_resume_required"&&value.report.resumeAvailable ? null : `${value.error ?? "Recovery could not be confirmed"}${!value.report ? ". Retrying this saved request reuses its recovery key." : ""}`);return;
      }
      if(value.applicationId!==request.applicationId||value.version!==request.version+Number(value.status==="reconciled")||!["reconciled","already_applied"].includes(value.status))throw new Error("Recovery receipt does not match this saved request");
      setReceipt(value);setConfirmed(false);intent.current=null;onRecovered();await load();
    }catch(cause){if(generation===epoch.current)setActionError(`The recovery result is unknown. The saved update is retained; retrying unchanged revisions reuses the same request. ${cause instanceof Error?cause.message:""}`);}
    finally{mutationLock.current=false;if(generation===epoch.current)setBusy(false);}
  };
  const selectedResume=selected?.resume;
  const pending=(attempt:Omit<ResumeSummary,"applicationId">|undefined)=>Boolean(attempt && (!attempt.terminal || attempt.nativeState !== "stopped" || attempt.dispatch === "unknown"));
  const pollApplication=selected?.id ?? loaded?.applications.find(report=>pending(report.resume))?.id;
  const pollReport=selected?.id===pollApplication?selected:loaded?.applications.find(report=>report.id===pollApplication);
  const publishExecution=({attempt}:{attempt:ResumeSummary|null})=>{
      if(!attempt){setActionError("Saved execution status is unavailable. The last loaded attempt is retained; no replacement was started.");return;}
      if(attempt.applicationId!==pollApplication)return;
      setActionError(null);
      setLoaded(previous=>previous?{...previous,applications:previous.applications.map(report=>report.id===attempt.applicationId?{...report,resume:attempt}:report)}:previous);
      setSelected(previous=>previous?.id===attempt.applicationId?{...previous,resume:attempt}:previous);
      const identity=attempt.id+":"+attempt.generation;
      if(attempt.terminal){
        const observation=identity+":"+attempt.terminal+":"+attempt.nativeState+":"+(attempt.pauseReason??"");
        if(!refreshedAttempts.current.has(observation)){refreshedAttempts.current.add(observation);void load();}
        if(attempt.terminal==="completed"&&attempt.nativeState==="stopped"&&!completedAttempts.current.has(identity)){completedAttempts.current.add(identity);onRecovered();}
      }
  };
  const refreshExecution=useVisiblePolling<{attempt:ResumeSummary|null}>({scope:projectId+":"+(pollApplication??"none"),intervalMs:8000,enabled:Boolean(pollApplication&&pending(pollReport?.resume)),
    read:signal=>apiJson(`/p/${projectId}/rebase-applications/${pollApplication}/resume`,{signal}),
    onValue:publishExecution,onError:cause=>setActionError(cause instanceof Error?cause.message:"Execution status could not be confirmed. Saved revisions remain available."),
  });
  const refreshSavedExecution=async()=>{
    if(!pollApplication)return;
    if(pending(pollReport?.resume)){await refreshExecution();return;}
    const generation=epoch.current;
    try{const value=await apiJson<{attempt:ResumeSummary|null}>(`/p/${projectId}/rebase-applications/${pollApplication}/resume`);if(generation===epoch.current)publishExecution(value);}
    catch(cause){if(generation===epoch.current)setActionError(cause instanceof Error?cause.message:"Execution status is unavailable");}
  };
  const applySaved=async()=>{
    if(!selected||!confirmed||mutationLock.current||loading||error||!recordCurrent||!canApply)return;
    const generation=epoch.current, previousGeneration=selected.resume?.generation??0;
    if(resumeIntent.current?.applicationId!==selected.id||resumeIntent.current.version!==selected.version||resumeIntent.current.previousGeneration!==previousGeneration)resumeIntent.current={applicationId:selected.id,version:selected.version,previousGeneration,key:crypto.randomUUID()};
    const request=resumeIntent.current;mutationLock.current=true;setBusy(true);setActionError(null);setResumeError(false);
    try{
      const response=await apiFetch(`/api/p/${projectId}/rebase-applications/${selected.id}/resume`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expectedVersion:request.version,idempotencyKey:request.key})});
      const value=await response.json() as ResumeSummary & {error?:string;report?:RecoveryReport};
      if(generation!==epoch.current)return;
      if(!response.ok){if(value.report?.id===selected.id){const report=value.report;setSelected(previous=>({...report,...(previous?.resume&&!report.resume?{resume:previous.resume}:{})}));setConfirmed(false);setLoaded(previous=>previous?{...previous,applications:previous.applications.map(row=>row.id===report.id?{...row,...report}:row)}:previous);}if([401,403,404].includes(response.status)){setLoaded(null);setSelected(null);setConfirmed(false);}setResumeError(true);setActionError(value.error??"The saved update could not be dispatched. Retrying unchanged revisions reuses the same request.");return;}
      if(response.status!==202||value.applicationId!==request.applicationId||!Number.isSafeInteger(value.generation)||value.generation<1||!value.id||!["saved","unknown","observed"].includes(value.dispatch)||!["unallocated","possible","stopped"].includes(value.nativeState))throw new Error("Execution acknowledgement did not match the saved update");
      publishExecution({attempt:value});setConfirmed(false);
    }catch(cause){if(generation===epoch.current){setResumeError(true);setActionError(`Dispatch is unconfirmed. The saved update is retained; retrying unchanged revisions reuses this request. ${cause instanceof Error?cause.message:""}`);}}
    finally{mutationLock.current=false;if(generation===epoch.current)setBusy(false);}
  };
  if(loaded?.applications.length===0&&!error)return null;
  const recordCurrent=Boolean(selected&&loaded?.applications.some(report=>report.id===selected.id&&report.version===selected.version));
  const canApply=Boolean(selected?.resumeAvailable && selected.status==="remote_old_resume_required" && selected.observedHead===selected.originalCommit && (!selectedResume || selectedResume.terminal==="failed" && selectedResume.nativeState==="stopped" && selectedResume.dispatch!=="unknown"));
  const updateRecorded=loaded?.applications.find(report=>report.id===selected?.id)?.savedStatus==="applied";
  const executionComplete=selectedResume?.terminal==="completed"&&selectedResume.nativeState==="stopped";
  const allowed=recordCurrent&&!loading&&!error&&selected?.canReconcile===true&&!blockedStatus.has(selected.status);
  const inspect=(commit:string,base:string)=>`/#/p/${projectId}/review?commit=${commit}&base=${base}&from=recovery`;
  return <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Saved branch updates</CardTitle></CardHeader><CardContent className="space-y-3 min-w-0">
    <p className="text-xs text-muted-foreground">Check saved branch updates after an interruption. Repository history still requires review and acceptance.</p>
    {loading&&!loaded&&<p role="status" className="text-sm text-muted-foreground">Loading saved updates…</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}{loaded&&" Showing the last loaded records."}</p>}
    <Button variant="ghost" size="sm" disabled={loading||busy} onClick={()=>void load()}>{loading?"Refreshing…":"Refresh saved records"}</Button>
    {loaded&&<ul className="divide-y divide-border">{loaded.applications.map(report=><li key={report.id} className="py-3 flex flex-wrap justify-between items-start gap-3"><div className="min-w-0 flex-1"><h3 className="text-sm font-medium break-words">{tasks?.[report.taskId]?.goal ?? report.taskId}</h3><p className="mt-1 text-xs text-muted-foreground break-words">{explanation(report)}</p></div><Button size="sm" variant="outline" disabled={busy} onClick={()=>{setSelected(report);setConfirmed(false);setReceipt(null);setActionError(null);setResumeError(false);}}>Inspect saved update</Button></li>)}</ul>}
    {loaded?.truncated&&<p className="text-xs text-muted-foreground">This is a bounded list of saved updates. Additional records are not shown.</p>}
    <Dialog open={selected!==null} onOpenChange={open=>{if(!open&&!busy){setSelected(null);setConfirmed(false);}}} className="max-h-[calc(100dvh-2rem)] overflow-y-auto"><DialogClose onClick={()=>{if(!busy){setSelected(null);setConfirmed(false);}}}/><DialogHeader><DialogTitle>Recover saved update</DialogTitle><DialogDescription>Inspect the original and saved revisions before checking the branch and restoring its update record.</DialogDescription></DialogHeader>{selected&&<div className="space-y-4 text-sm min-w-0">
      <div className="space-y-3"><div><h3 className="text-xs font-medium">Original revision</h3><p className="mt-1 text-xs break-all"><code>{selected.originalCommit}</code></p><p className="mt-1 text-xs text-muted-foreground break-all"><span className="block">Base</span><code className="block">{selected.originalBase}</code></p>{selected.originalBase===null?<p className="text-xs text-muted-foreground">Original base: empty accepted history. Inspect the preserved contribution review for its complete range.</p>:<a className="text-xs text-primary hover:underline" href={inspect(selected.originalCommit,selected.originalBase)}>Inspect original diff</a>}</div><div><h3 className="text-xs font-medium">Saved revision</h3><p className="mt-1 text-xs break-all"><code>{selected.commit}</code></p><p className="mt-1 text-xs text-muted-foreground break-all"><span className="block">Base</span><code className="block">{selected.base}</code></p><a className="text-xs text-primary hover:underline" href={inspect(selected.commit,selected.base)}>Inspect saved diff</a></div></div>
      <p className="text-xs text-muted-foreground">The branch will be checked before recovery. Your current owner permissions are used; original Git authorship stays unchanged.</p>
      {!selectedResume&&<p className="text-xs leading-5">{explanation(selected)}</p>}
      {!receipt&&!executionComplete&&!updateRecorded&&(error||loading||!recordCurrent)&&<p role="status" className="text-xs text-muted-foreground">{error ? "Recovery is paused until saved records can be refreshed." : loading ? "Checking current saved records…" : "Saved records changed. Close and reopen this update to review the current revisions."}</p>}
      {actionError&&<p role="alert" className="text-sm text-destructive">{actionError}</p>}
      {receipt&&<p role="status" className="text-xs text-emerald-800 dark:text-emerald-200">{receipt.status === "already_applied" ? "This update was already recorded. No new recovery was applied." : <>Update record recovered by {receipt.actor.displayName}{receipt.actor.viaToken?" via API credential":" from a signed-in session"} at {new Date(receipt.recordedAt).toLocaleString()}.</>} No repository history was accepted.</p>}
      {selectedResume&&<div role="status" className="space-y-2 text-xs text-muted-foreground"><p>{executionComplete?"Saved branch update completed. No repository history was accepted.":selectedResume.terminal==="failed"?updateRecorded?"The saved update was recorded. Execution cleanup needs inspection.":"The attempt paused. Saved revisions are retained.":selectedResume.dispatch==="unknown"?"Dispatch is unconfirmed. No replacement attempt will start while its outcome is unknown.":"The saved update is being checked and applied. Completion is not yet confirmed."}</p>{selectedResume.pauseReason&&<p>{({funding_refused:"The execution budget is unavailable.",git_state_changed:"The Git state changed; newer work must be preserved.",cleanup_unconfirmed:"Credential cleanup is unconfirmed; its incident remains recorded.",authority_changed:"Owner authority changed; this attempt cannot continue.",transport_unconfirmed:"The branch update could not be confirmed.",execution_failed:"Execution did not complete."} as Record<string,string>)[selectedResume.pauseReason]??"The attempt needs inspection before continuing."}</p>}{selectedResume.nativeState==="possible"&&<p>The workspace may still be active. Its shutdown has not been confirmed.</p>}<Button size="sm" variant="ghost" onClick={()=>void refreshSavedExecution()}>Refresh execution status</Button></div>}
      {!receipt&&!executionComplete&&canApply&&<><label className="flex items-start gap-2 text-xs leading-5"><Input type="checkbox" checked={confirmed} disabled={busy||loading||Boolean(error)} onChange={event=>setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 p-0"/>I reviewed these revisions and want to apply the saved branch update. Newer contributor work must remain intact.</label><Button size="sm" disabled={busy||!confirmed||loading||Boolean(error)||!recordCurrent} onClick={()=>void applySaved()}>{busy?"Requesting…":resumeError?"Retry saved update":"Apply saved update"}</Button></>}
      {!receipt&&allowed&&<><label className="flex items-start gap-2 text-xs leading-5"><Input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 p-0"/>I reviewed these revisions and want to recover this update record. Newer contributor work must remain intact.</label><Button size="sm" disabled={busy||!confirmed} onClick={()=>void recover()}>{busy?"Recovering…":actionError?"Retry recovery":"Recover update"}</Button></>}
    </div>}</Dialog>
  </CardContent></Card>;
}
