import {useAuth} from "@clerk/clerk-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import {MirrorOperationRecovery} from "./MirrorOperationRecovery";
import {readMirrorOperations,parseMirrorOperation,type MirrorOperation} from "../mirror-operation-recovery";
import {mirrorRunIntent,readMirrorIntent,saveMirrorIntent,clearMirrorIntent,type MirrorRunIntent} from "../mirror-run-intent";
import {Input} from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiJson,apiSessionIdentity } from "../api";
import { timeAgo } from "../router";
import { useVisiblePolling } from "../use-visible-polling";
import { mirrorStatus } from "../mirror-status";

interface MirrorRun { id: string; commit: string; status: string; detail: string; at: string }
interface MirrorInfo { target: string | null; enabled: boolean; hasToken: boolean; runs: MirrorRun[] }
type Busy = null | "save" | "toggle" | "remove" | "retry";

const alertCls = "rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive";
const okCls = "rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200";
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function MirrorCard({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const {userId}=useAuth();
  const [info, setInfo] = useState<MirrorInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const requestIntent=useRef<MirrorRunIntent|null>(null);
  const [operations,setOperations]=useState<MirrorOperation[]>([]),[operationsError,setOperationsError]=useState<string|null>(null),[operationsLoaded,setOperationsLoaded]=useState(false),[operationsComplete,setOperationsComplete]=useState(false),[operationCursor,setOperationCursor]=useState<string|null>(null);
  const operationRead=useRef(0);
  const generation = useRef(0);
  const mutationInFlight = useRef(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  useEffect(() => {
    generation.current++;
    mutationInFlight.current = false;
    requestIntent.current=null;const identity=apiSessionIdentity();if(identity&&isOwner){try{requestIntent.current=readMirrorIntent(sessionStorage,identity,projectId);}catch{/* Storage failure will prevent a new export. */}}operationRead.current++;setOperations([]);setOperationsError(null);setOperationsLoaded(false);setOperationsComplete(false);setOperationCursor(null);
    setInfo(null); setLoadError(null); setLastLoadedAt(null); setTarget(""); setToken(""); setError(null); setNotice(null); setBusy(null);
    return () => { generation.current++; };
  }, [projectId,isOwner,userId]);
  const read = useCallback((signal: AbortSignal) => apiJson<MirrorInfo>(`/p/${projectId}/mirror`, { signal }), [projectId]);
  const refresh = useVisiblePolling({
    scope: projectId, intervalMs: 10000, read,
    onValue: (value) => { setInfo(value); setLoadError(null); setLastLoadedAt(new Date().toISOString()); },
    onError: (e) => setLoadError(errText(e, "Could not load mirror status")),
  });

  const loadOperations=useCallback(async(cursor?:string)=>{if(!isOwner)return;const sequence=++operationRead.current,current=generation.current;try{const report=await readMirrorOperations(projectId,AbortSignal.timeout(15000),cursor);if(current!==generation.current||sequence!==operationRead.current)return;setOperations(previous=>cursor?[...previous,...report.operations.filter(item=>!previous.some(old=>old.operationId===item.operationId))]:report.operations);setOperationCursor(report.nextCursor);setOperationsComplete(report.complete);setOperationsLoaded(true);setOperationsError(null);const original=requestIntent.current;if(original&&report.operations.some(item=>item.requestId===original.requestId&&item.completed)){const identity=apiSessionIdentity();if(identity){try{clearMirrorIntent(sessionStorage,identity,projectId);}catch{/* Server receipt remains authoritative. */}}requestIntent.current=null;}}catch{if(current===generation.current&&sequence===operationRead.current)setOperationsError("Recorded mirror operations are unavailable. No unknown export is treated as safe to replace.");}},[projectId,isOwner]);
  useEffect(()=>{void loadOperations();},[loadOperations]);

  const guard = async (label: Exclude<Busy, null>, done: string, fn: (current: number) => Promise<void>) => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    const current = generation.current;
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn(current);
      if (current !== generation.current) return;
      setNotice(done);
      await refresh();await loadOperations();
    } catch (e) {
      if (current === generation.current) {setError(errText(e, "Something went wrong"));void loadOperations();}
    } finally {
      if (current === generation.current) { mutationInFlight.current = false; setBusy(null); }
    }
  };

  const save = () => guard("save", "Mirror settings saved.", async (current) => {
    await apiJson(`/p/${projectId}/mirror`, { method: "PUT", json: { target: target || info?.target, token: token || undefined, enabled: info?.target ? info.enabled : true } });
    if (current !== generation.current) return;
    setToken("");
    setTarget("");
  });
  const toggle = () => guard("toggle", info?.enabled ? "Mirror paused." : "Mirror resumed.", async () => { await apiJson(`/p/${projectId}/mirror`, { method: "PUT", json: { enabled: !info?.enabled } }); });
  const remove = () => guard("remove", "Mirror removed.", async (current) => { await apiJson(`/p/${projectId}/mirror`, { method: "DELETE" }); if (current !== generation.current) return; setToken(""); setTarget(""); });
  const pendingOperation=operations.find(item=>!item.completed);
  const retry=()=>guard("retry","Original mirror request recorded. Inspect its saved operation for delivery and cleanup.",async()=>{
    if(!info?.target)throw Error("Configure an approved mirror first");
    const identity=apiSessionIdentity();if(!identity)throw Error("Sign in again before exporting accepted repository state");
    requestIntent.current=mirrorRunIntent(requestIntent.current,info.target,()=>crypto.randomUUID());
    if(!saveMirrorIntent(sessionStorage,identity,projectId,requestIntent.current))throw Error("The original mirror request could not be saved on this device. No export was dispatched");
    const existing=operations.find(item=>item.requestId===requestIntent.current?.requestId);
    if(existing){if(!existing.canReconcile&&!existing.canResumeOriginal&&!existing.completed)throw Error("Original mirror operation is held. Refresh its recorded state instead of starting another push");const result=await apiJson<{status:string;operation:unknown}>(`/p/${projectId}/mirror/run`,{method:"POST",json:{operationId:existing.operationId}});const recorded=parseMirrorOperation(result.operation);if(recorded.operationId!==existing.operationId||recorded.target!==existing.target||recorded.ref!==existing.ref||recorded.commit!==existing.commit||recorded.tree!==existing.tree)throw Error("Mirror operation acknowledgement differs");if(recorded.completed){clearMirrorIntent(sessionStorage,identity,projectId);requestIntent.current=null;}}
    else {const original=requestIntent.current;const result=await apiJson<{status:string;operation:unknown}>(`/p/${projectId}/mirror/run`,{method:"POST",json:{requestId:original.requestId,expectedTarget:original.target}});const recorded=parseMirrorOperation(result.operation);if(recorded.requestId!==original.requestId||recorded.target!==original.target)throw Error("Mirror request acknowledgement differs");if(recorded.completed){clearMirrorIntent(sessionStorage,identity,projectId);requestIntent.current=null;}}
    await loadOperations();
  });
  const continueOperation=(operation:MirrorOperation)=>guard("retry","Original mirror operation inspected. Check its recorded delivery and cleanup state.",async()=>{if(!operation.canReconcile&&!operation.canResumeOriginal)return;const result=await apiJson<{status:string;operation:unknown}>(`/p/${projectId}/mirror/run`,{method:"POST",json:{operationId:operation.operationId}});const recorded=parseMirrorOperation(result.operation);if(recorded.operationId!==operation.operationId||recorded.target!==operation.target||recorded.ref!==operation.ref||recorded.commit!==operation.commit||recorded.tree!==operation.tree)throw Error("Original mirror acknowledgement differs");if(recorded.completed&&requestIntent.current?.requestId===recorded.requestId){const identity=apiSessionIdentity();if(identity)clearMirrorIntent(sessionStorage,identity,projectId);requestIntent.current=null;}});

  const last = info?.runs[0];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2">
          Mirror to GitHub
          {info?.target && <Badge variant={info.enabled ? "secondary" : "outline"}>{info.enabled ? "On" : "Paused"}</Badge>}
          {last && last.status !== "ok" && <Badge variant={mirrorStatus(last.status).variant}>{mirrorStatus(last.status).label}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm min-w-0">
        <p className="text-muted-foreground">
          FlareGit stays the source of truth; GitHub is a copy. If GitHub is unavailable or has diverged, repository browsing and review remain independent of the mirror. Accepted work is pushed after it lands, never forced.
        </p>
        {loadError && (
          <div role="alert" className={`${alertCls} flex flex-wrap items-center justify-between gap-2`}>
            <span>{loadError}{info ? ". Showing the last loaded mirror state." : ""}</span>
          </div>
        )}
        {lastLoadedAt && <p className="text-xs text-muted-foreground">Last loaded {timeAgo(lastLoadedAt)}</p>}
        <Button size="sm" variant="ghost" onClick={() => {void refresh();void loadOperations();}}>{loadError ? "Retry refresh" : "Refresh status"}</Button>
        {!info && !loadError && <p role="status" className="text-muted-foreground">Loading mirror status…</p>}
        {info && !info.target && <p className="text-muted-foreground">No mirror configured.</p>}
        {info?.target && (
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-xs break-all">{info.target}</code>
            {isOwner && (
              <>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={toggle}>{busy === "toggle" ? (info.enabled ? "Pausing…" : "Resuming…") : info.enabled ? "Pause" : "Resume"}</Button>
                <Button size="sm" variant="outline" disabled={busy !== null || !info.enabled || !operationsLoaded || !!operationsError || !operationsComplete || !!pendingOperation&&pendingOperation.requestId!==requestIntent.current?.requestId} onClick={retry}><RotateCw className="h-3.5 w-3.5 mr-1" />{busy === "retry" ? "Inspecting…" : requestIntent.current?"Recover original request":"Mirror accepted version"}</Button>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={remove}>{busy === "remove" ? "Removing…" : "Remove"}</Button>
              </>
            )}
          </div>
        )}
        {isOwner && info && (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <label className="block">
              <span className="font-medium">GitHub repository URL</span>
              <Input type="url" disabled={busy === "save"} placeholder={info.target ?? "https://github.com/owner/repo"} value={target} onChange={(e) => setTarget(e.target.value)} />
            </label>
            <label className="block">
              <span className="font-medium">GitHub token</span>
              <Input type="password" disabled={busy === "save"} autoComplete="off" placeholder={info.hasToken ? "Token saved — enter a new one to replace it" : "Fine-grained token (Contents: read and write)"} value={token} onChange={(e) => setToken(e.target.value)} />
            </label>
            <Button size="sm" type="submit" disabled={busy !== null || (!target && !info.target) || (!token && !info.hasToken)}>{busy === "save" ? "Saving…" : "Save"}</Button>
          </form>
        )}
        {isOwner&&<MirrorOperationRecovery operations={operations} error={operationsError} busy={busy!==null} onRefresh={()=>void loadOperations()} onContinue={continueOperation} hasMore={operationCursor!==null} onNext={()=>{if(operationCursor)void loadOperations(operationCursor);}}/>}
        {error && <div role="alert" className={alertCls}>{error}</div>}
        {notice && <div role="status" className={okCls}>{notice}</div>}
        {info && info.runs.length > 0 && (
          <ul className="divide-y divide-border">
            {info.runs.slice(0, 10).map((r) => (
              <li key={r.id} className="py-2 flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={mirrorStatus(r.status).variant}>{mirrorStatus(r.status).label}</Badge>
                  <code className="text-xs break-all" title={r.commit}>{r.commit.slice(0, 12)}</code>
                  <span className="text-xs text-muted-foreground ml-auto">{timeAgo(r.at)}</span>
                </div>
                <span className="text-xs text-muted-foreground break-all">Run <code>{r.id}</code></span>
                {r.status !== "ok" && r.detail && <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all">{r.detail}</pre>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
