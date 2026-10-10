import { ChangeStepper } from "../components/ChangeStepper";
import { changeProgress } from "../change-progress";
import { toast } from "@/components/ui/sonner";
import { NeedsAttention } from "../components/NeedsAttention";
import {changeInspectionStatus} from '../change-inspection-status';
import {acceptedCommitLabel} from "../accepted-commit-display";
import {PendingTaskCreations} from "../components/PendingTaskCreations";
import {RequirementsEditor} from "../components/RequirementsEditor";
import {draftsFromRows,rowsFromDrafts,type RequirementRow} from "../requirement-form";
import {readTaskCreationRecovery,restoreTaskCreationRequest,type TaskCreationRecoveryRow,type PendingTaskCreation} from "../task-creation-recovery";
import {ContributionTargetChoices} from "../components/ContributionTargetChoices";
import {parseContributionTargets,contributionExpectation,contributionCreationIntent,type ContributionTarget,type ContributionCreationIntent} from "../contribution-target-selection";
import {effectiveTaskAcceptedTarget} from "@/core/accepted-target";
import {hasOlderAcceptedBase} from "../change-base-state";
import {GitCredential} from "../components/GitCredential";
import {separateGitCommands} from "../git-command-display";
import {taskGitCommands} from "@/server/git-command-metadata";
import {z} from "zod";
import React, { useCallback,useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select,SelectTrigger,SelectValue,SelectContent,SelectItem } from "@/components/ui/select";
import { changeCreationFollowup, type ChangeCreationResponse } from "../change-creation-followup";
import { Bot, Check, Copy, GitPullRequestArrow, Layers, Plus, User, X, GitBranch, AlertTriangle, ShieldCheck, Pause, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AgentRecoveryPanel } from "../components/AgentRecoveryPanel";
import { AgentChangeSummary } from "../components/AgentChangeSummary";
import {readIntegrationIntents,saveIntegrationIntent,acknowledgeIntegrationIntent,type IntegrationIntent} from "../integration-intent-recovery";
import {combinableSelection,combineSelectionBlocker,integrationIntentFor,MAX_COMBINED_CHANGES} from "../integration-selection";
import { apiFetch, apiJson, apiSessionIdentity } from "../api";
import { navigate, timeAgo } from "../router";
import type { FlareGitProjectState, Task, TaskStatus } from "@/core/types";
import { QUEUE_STATUS, useCoordination } from "../coordination";
import { ChangeUpdateStatus } from "../components/MergeQueue";

const STATUS: Record<TaskStatus, { label: string; variant: "secondary" | "info" | "warning" | "success" | "purple" | "destructive" | "outline" }> = {
  working: { label: "Working", variant: "secondary" },
  checkpointed: { label: "Working · pushed", variant: "secondary" },
  ready: { label: "Ready", variant: "info" },
  integrating: { label: "Combining", variant: "warning" },
  verifying: { label: "Verifying", variant: "warning" },
  accepted: { label: "Merged", variant: "success" },
  needs_decision: { label: "Needs decision", variant: "purple" },
  blocked: { label: "Blocked", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

const slug = (goal: string) => goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "change";

interface WorkflowObservation { instanceId: string; kind: string; status: string; action: string; changed: boolean }
const WORKFLOW_LABELS: Record<string, string> = { paused: "Paused", waitingForPause: "Pause pending", running: "Running", waiting: "Waiting", queued: "Queued", complete: "Completed", errored: "Failed", terminated: "Terminated", unknown: "Unknown" };

function AgentRunControls({ projectId, instanceId, canRetry, retrying, onRetry, onChange }: { projectId: string; instanceId: string; canRetry: boolean; retrying: boolean; onRetry: () => void; onChange: () => void }) {
  const [observation, setObservation] = useState<{ run: WorkflowObservation; at: string } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const request = async (action: "status" | "pause" | "resume") => {
    setLoading(action);
    setError(null);
    setActionMessage(null);
    try {
      const response = await apiFetch(`/api/p/${projectId}/workflows/${instanceId}${action === "status" ? "" : `/${action}`}`, { method: action === "status" ? "GET" : "POST" });
      if (!response.ok) {
        setUnavailable(response.status === 404);
        throw new Error(await response.text() || "Could not read the agent run");
      }
      const run = await response.json() as WorkflowObservation;
      setObservation({ run, at: new Date().toISOString() });
      setUnavailable(false);
      if (action !== "status") {
        setActionMessage(run.changed ? `${action === "pause" ? "Pause" : "Resume"} requested. Observed state: ${WORKFLOW_LABELS[run.status] ?? run.status}.` : `No new transition requested. Observed state: ${WORKFLOW_LABELS[run.status] ?? run.status}.`);
        onChange();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the agent run");
    } finally { setLoading(null); }
  };
  const status = observation?.run.status;
  return <div className="mt-3 border-t border-border pt-2 space-y-2">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-xs text-muted-foreground">Agent run{status ? ` · ${WORKFLOW_LABELS[status] ?? status}` : " · status not checked"}{observation ? ` · checked ${timeAgo(observation.at)}` : ""}</span>
      <Button type="button" size="sm" variant="ghost" disabled={loading !== null} onClick={() => void request("status")}><RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />{loading === "status" ? "Checking…" : "Check run"}</Button>
      {!error && status && ["running", "waiting", "queued"].includes(status) && <Button type="button" size="sm" variant="outline" disabled={loading !== null} onClick={() => void request("pause")}><Pause className="mr-1 h-3 w-3" aria-hidden="true" />{loading === "pause" ? "Requesting…" : "Pause agent"}</Button>}
      {!error && status === "paused" && <Button type="button" size="sm" variant="outline" disabled={loading !== null} onClick={() => void request("resume")}><Play className="mr-1 h-3 w-3" aria-hidden="true" />{loading === "resume" ? "Requesting…" : "Resume agent"}</Button>}
      {canRetry && (status === "errored" || unavailable) && <Button type="button" size="sm" variant="outline" disabled={loading !== null || retrying} onClick={onRetry}>{retrying ? "Starting…" : "Start new agent run"}</Button>}
    </div>
    {status === "waitingForPause" && <p className="text-xs text-amber-200">Pause is pending. The provider has not confirmed a paused state; check the run again.</p>}
    {status === "paused" && <p className="text-xs text-muted-foreground">Resume continues this durable run. Saved checkpoints remain available above.</p>}
    {actionMessage && <p role="status" className="text-xs text-sky-200">{actionMessage}</p>}
    {error && <p role="alert" className="text-xs text-destructive">Run status unavailable: {error}. Saved checkpoints remain available.</p>}
    {canRetry && (status === "errored" || unavailable) && <p className="text-xs text-muted-foreground">Starting a new run retries this change; it does not resume the previous run.</p>}
  </div>;
}

const originalRetargetRequestSchema=z.object({requestId:z.uuid(),expectedGeneration:z.number().int().nonnegative().safe(),expectedHead:z.string().regex(/^[a-f0-9]{40}$/),target:z.object({ref:z.string(),acceptedCommit:z.string().regex(/^[a-f0-9]{40}$/),acceptedVersion:z.number().int().nonnegative().safe(),policyVersion:z.number().int().positive().safe()})});
const retargetOperationSchema=z.object({requestId:z.uuid(),phase:z.enum(['prepared','requires_rebase','verified','activated']),target:z.object({ref:z.string(),acceptedCommit:z.string().regex(/^[a-f0-9]{40}$/)}),reason:z.string().optional(),cleanupRequired:z.boolean().optional(),originalRequest:originalRetargetRequestSchema.optional()}).refine(value=>!value.originalRequest||value.originalRequest.requestId===value.requestId);
function RetargetDialog({projectId,task,targets,allowed,onClose,reload,requestIds}:{projectId:string;task:Task;targets:ContributionTarget[];allowed:boolean;onClose:()=>void;reload:()=>void;requestIds:Map<string,string>}) {
  const {userId}=useAuth();
  const identity=apiSessionIdentity();
  const [ref,setRef]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[operation,setOperation]=useState<z.infer<typeof retargetOperationSchema>|null>(null);
  const [operations,setOperations]=useState<z.infer<typeof retargetOperationSchema>[]>([]),[discovered,setDiscovered]=useState(false);
  const requestId=useRef<string|null>(null),lock=useRef(false),alive=useRef(false),sequence=useRef(0);
  const target=targets.find(item=>item.ref===ref&&item.acceptedCommit!==null);
  const readOperations=async(signal?:AbortSignal)=>z.object({operations:z.array(retargetOperationSchema).max(200)}).parse(await apiJson<unknown>(`/p/${projectId}/tasks/${task.id}/retargets`,{signal})).operations;
  const current=(generation:number)=>alive.current&&generation===sequence.current&&identity!==null&&apiSessionIdentity()===identity;
  useEffect(()=>{
    alive.current=true;const generation=++sequence.current,controller=new AbortController();
    setDiscovered(false);setBusy(true);setError(null);setOperation(null);setOperations([]);requestId.current=null;
    void readOperations(controller.signal).then(records=>{if(current(generation)){setOperations(records);setDiscovered(true);}}).catch(cause=>{if(current(generation))setError(cause instanceof Error?cause.message:'Original retarget requests could not be loaded.');}).finally(()=>{if(current(generation))setBusy(false);});
    return()=>{alive.current=false;sequence.current++;controller.abort();};
  },[projectId,task.id,identity,userId]);
  const findOperation=(records:z.infer<typeof retargetOperationSchema>[],id:string)=>{const found=records.find(item=>item.requestId===id);if(!found)throw new Error('The original retarget request is not confirmed. Check the same request again.');return found;};
  const submit=async()=>{
    if(lock.current||busy||!discovered||!allowed||!target||!task.currentCommit||operation||inspectionHeld)return;
    const generation=++sequence.current;
    lock.current=true;setBusy(true);setError(null);
    try{
      const expectedGeneration=task.targetGeneration?.generation??0,expectedHead=task.currentCommit,expectation=contributionExpectation(target);
      const signature=JSON.stringify({projectId,userId,identity,taskId:task.id,expectedGeneration,expectedHead,target:expectation});
      const id=requestIds.get(signature)??crypto.randomUUID();requestIds.set(signature,id);requestId.current=id;
      await apiJson<unknown>(`/p/${projectId}/tasks/${task.id}/retarget`,{method:'POST',json:{requestId:id,expectedGeneration,expectedHead,target:expectation}});
      if(!current(generation))return;
      const records=await readOperations(),found=findOperation(records,id);
      if(current(generation)){setOperations(records);setOperation(found);}
    }catch(cause){if(current(generation))setError(cause instanceof Error?cause.message:'Retarget outcome could not be confirmed. Check the original request.');}
    finally{lock.current=false;if(current(generation)){setBusy(false);reload();}}
  };
  const check=async()=>{
    if(lock.current||busy)return;
    const generation=++sequence.current,id=requestId.current;
    lock.current=true;setBusy(true);setError(null);
    try{const records=await readOperations(),found=id?findOperation(records,id):null;if(current(generation)){setOperations(records);setDiscovered(true);if(found)setOperation(found);}}
    catch(cause){if(current(generation))setError(cause instanceof Error?cause.message:'Retarget state could not be read.');}
    finally{lock.current=false;if(current(generation)){setBusy(false);reload();}}
  };
  const releaseInspection=async()=>{
    if(lock.current||busy||!operation?.cleanupRequired)return;
    const originalId=operation.requestId,generation=++sequence.current;
    lock.current=true;setBusy(true);setError(null);
    try{
      const recovered=retargetOperationSchema.parse(await apiJson<unknown>(`/p/${projectId}/tasks/${task.id}/retargets/${originalId}/recover`,{method:'POST'}));
      if(recovered.requestId!==originalId||recovered.cleanupRequired!==false)throw new Error('Inspection release is not confirmed. Check the original request again.');
      if(current(generation)){setOperation(recovered);setOperations(records=>records.map(item=>item.requestId===originalId?recovered:item));}
    }catch(cause){if(current(generation))setError(cause instanceof Error?cause.message:'Inspection release could not be confirmed.');}
    finally{lock.current=false;if(current(generation)){setBusy(false);reload();}}
  };
  const originalIsStale=(item:z.infer<typeof retargetOperationSchema>)=>{
    const original=item.originalRequest;
    if(!original)return true;
    const recordedTarget=targets.find(candidate=>candidate.ref===original.target.ref);
    return original.expectedHead!==task.currentCommit||original.expectedGeneration!==(task.targetGeneration?.generation??0)||!recordedTarget||recordedTarget.acceptedCommit!==original.target.acceptedCommit||recordedTarget.acceptedVersion!==original.target.acceptedVersion||recordedTarget.policyVersion!==original.target.policyVersion;
  };
  const resumeOriginal=async()=>{
    if(lock.current||busy||!allowed||!operation?.originalRequest||operation.cleanupRequired||originalIsStale(operation)||!['prepared','verified'].includes(operation.phase))return;
    const original=operation.originalRequest,generation=++sequence.current;
    lock.current=true;setBusy(true);setError(null);requestId.current=original.requestId;
    try{
      await apiJson<unknown>(`/p/${projectId}/tasks/${task.id}/retarget`,{method:'POST',json:original});
      if(!current(generation))return;
      const records=await readOperations(),found=findOperation(records,original.requestId);
      if(current(generation)){setOperations(records);setOperation(found);}
    }catch(cause){if(current(generation))setError(cause instanceof Error?cause.message:'The original request could not be resumed. Check its recorded state.');}
    finally{lock.current=false;if(current(generation)){setBusy(false);reload();}}
  };
  const originals=operations;
  const inspectionHeld=operations.some(item=>item.cleanupRequired)||operation?.cleanupRequired===true;
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogHeader><DialogTitle>Retarget change</DialogTitle><DialogDescription>Choose the accepted branch this change should build on. The current fork must contain its accepted base.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      {originals.length>0&&<div className="space-y-2"><h3 className="text-sm font-medium">Original requests</h3>{originals.map(item=><Button type="button" key={item.requestId} variant="outline" className="w-full h-auto whitespace-normal text-left justify-start" disabled={busy} onClick={()=>{sequence.current++;requestId.current=item.requestId;setOperation(item);setRef('');setError(null);}}>{item.target.ref} · {item.phase}{item.cleanupRequired?' · inspection held':''}<span className="sr-only"> · {item.requestId}</span></Button>)}</div>}
      {!operation&&<Select value={ref} onValueChange={value=>{sequence.current++;setRef(value);setOperation(null);requestId.current=null;}} disabled={busy||!allowed||!discovered||inspectionHeld}><SelectTrigger aria-label="New accepted base branch"><SelectValue placeholder="Choose accepted branch"/></SelectTrigger><SelectContent>{targets.filter(item=>item.acceptedCommit!==null).map(item=><SelectItem key={item.ref} value={item.ref}>{item.ref}</SelectItem>)}</SelectContent></Select>}
      {target&&<p className="text-xs text-muted-foreground break-all">Accepted base {target.acceptedCommit} · version {target.acceptedVersion} · policy {target.policyVersion}</p>}
      {!allowed&&<p role="status" className="text-sm text-muted-foreground">Current fork write authority is unavailable.</p>}
      {operation&&<div role="status" className="space-y-2 text-sm"><p className="break-all">Original request {operation.requestId} · {operation.target.ref}</p><p>{operation.phase==='activated'?'Base branch changed. Mark this change ready again to verify the new target.':operation.phase==='requires_rebase'?'Rebase your fork onto the selected accepted base and push it. Original history remains unchanged.':operation.phase==='verified'?'Fork ancestry was verified. Activation is not yet confirmed. Check this original request again.':'Retarget request recorded. Native ancestry verification is not yet confirmed.'}</p>{operation.reason&&<p className="text-muted-foreground">{operation.reason}</p>}{['prepared','verified'].includes(operation.phase)&&originalIsStale(operation)&&!operation.cleanupRequired&&<p className="text-muted-foreground">This request's source or accepted target changed. Choose a new target using the current fork head.</p>}{operation.cleanupRequired&&<div className="space-y-2"><p>Release the recorded inspection to restore fork writes.</p><Button type="button" variant="outline" disabled={busy} onClick={()=>void releaseInspection()}>Release inspection</Button></div>}</div>}
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">{operation&&!inspectionHeld&&<Button type="button" variant="outline" disabled={busy} onClick={()=>{sequence.current++;setOperation(null);setRef('');requestId.current=null;setError(null);}}>New target</Button>}{operation?.originalRequest&&!operation.cleanupRequired&&['prepared','verified'].includes(operation.phase)&&<Button type="button" variant="outline" disabled={busy||!allowed||originalIsStale(operation)} onClick={()=>void resumeOriginal()}>Resume original</Button>}<Button type="button" variant="outline" disabled={busy} onClick={()=>void check()}>{requestId.current?'Check original request':'Refresh requests'}</Button>{!operation&&<Button type="button" disabled={busy||!discovered||inspectionHeld||!allowed||!target||!task.currentCommit} onClick={()=>void submit()}>{busy?'Checking…':'Retarget change'}</Button>}</div>
    </div>
  </Dialog>;
}
type ChangesProps = { projectId: string; state: FlareGitProjectState; reload: () => void; taskId?:string|null; canContribute?: boolean; managedActions?: boolean; isOwner?: boolean; writableTaskIds?: string[]; cancellableTaskIds?: string[]; forkPermissions?: Record<string,{enabled:boolean;revision:number;canConfigure:boolean}> };
export function ChangesTab(props: ChangesProps) {
  const { userId } = useAuth();
  return <ChangesPanel key={`${props.projectId}:${userId ?? "signed-out"}`} {...props} />;
}
function ChangesPanel({ projectId, state, reload,taskId,canContribute=true,managedActions=true,isOwner=false,writableTaskIds,cancellableTaskIds,forkPermissions }: ChangesProps) {
  const { userId } = useAuth();
  const coordination = useCoordination(projectId);
  const queueByTask = new Map((coordination.view?.queue ?? []).filter(entry => entry.status !== "removed").map(entry => [entry.taskId, entry]));
  const updateByTask = new Map((coordination.view?.updates ?? []).map(update => [update.taskId, update]));
  const canChangeTask = (task: Task) => canContribute && (writableTaskIds !== undefined ? writableTaskIds.includes(task.id) : managedActions || task.contributor.id === userId || task.initiatedBy?.id === userId);
  const canCancelTask = (task: Task) => canContribute && (cancellableTaskIds !== undefined ? cancellableTaskIds.includes(task.id) : managedActions || task.contributor.id === userId || task.initiatedBy?.id === userId);
  const retargetRequestIds=useRef(new Map<string,string>());
  const [retargetTaskId,setRetargetTaskId]=useState<string|null>(null);
  const linkedTask=taskId?Object.values(state.tasks).find(task=>task.id===taskId):undefined;
  const linkedTaskElement=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{if(!linkedTask)return;linkedTaskElement.current?.focus({preventScroll:true});linkedTaskElement.current?.scrollIntoView({block:"center",behavior:"instant"});},[projectId,linkedTask?.id]);
  const [goal, setGoal] = useState("");
  const creationIntent = useRef<ContributionCreationIntent | null>(null);
  const [relationships, setRelationships] = useState(false);
  const [requirementRows, setRequirementRows] = useState<RequirementRow[]>([]);
  const [dependsOn, setDependsOn] = useState<string | null>(null);
  const [issue, setIssue] = useState<{ number: number; title: string } | null>(null);
  const [picker, setPicker] = useState<"change" | "issue" | "target" | null>(null);
  const [search, setSearch] = useState("");
  const [issues, setIssues] = useState<Array<{ number: number; title: string }> | null>(null);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const lifetime = useRef(0);
  const issueRequest = useRef(0);
  useEffect(() => () => { lifetime.current++; issueRequest.current++; }, []);
  const loadIssues = async () => {
    const request = ++issueRequest.current;
    setIssuesLoading(true); setIssuesError(null);
    try {
      const result = await apiJson<Array<{ number: number; title: string }>>(`/p/${projectId}/issues?state=open`);
      if (request === issueRequest.current) setIssues(result);
    } catch (cause) {
      if (request === issueRequest.current) setIssuesError(cause instanceof Error ? cause.message : "Could not load issues");
    } finally { if (request === issueRequest.current) setIssuesLoading(false); }
  };
  const [targets,setTargets]=useState<ContributionTarget[]|null>(null),[selectedTarget,setSelectedTarget]=useState<ContributionTarget|null>(null),[targetError,setTargetError]=useState<string|null>(null),[targetsTruncated,setTargetsTruncated]=useState(false);
  const targetRequest=useRef(0);
  const loadTargets=useCallback(async()=>{const current=++targetRequest.current;try{const result=parseContributionTargets(await apiJson<unknown>(`/p/${projectId}/contribution-targets`,{signal:AbortSignal.timeout(15000)}));if(current===targetRequest.current){setTargets(result.targets);setTargetsTruncated(result.truncated);setTargetError(null);}}catch{if(current===targetRequest.current)setTargetError("Accepted branch choices are unavailable. Refresh the recorded choices before selecting another branch.");}},[projectId]);
  useEffect(()=>{void loadTargets();return()=>{targetRequest.current++;};},[loadTargets]);
  const [creations,setCreations]=useState<TaskCreationRecoveryRow[]>([]),[creationError,setCreationError]=useState<string|null>(null),[creationReading,setCreationReading]=useState(false),[creationCursor,setCreationCursor]=useState<string|null>(null);
  const creationRead=useRef(0);
  const loadCreations=useCallback(async(cursor?:string)=>{const current=++creationRead.current;setCreationReading(true);try{const report=await readTaskCreationRecovery(projectId,AbortSignal.timeout(15000),cursor);if(current===creationRead.current){setCreations(report.creations);setCreationCursor(report.nextCursor);setCreationError(null);}}catch{if(current===creationRead.current)setCreationError("Saved creation status is unavailable. No allocation is assumed stopped or safe to retry.");}finally{if(current===creationRead.current)setCreationReading(false);}},[projectId]);
  useEffect(()=>{void loadCreations();return()=>{creationRead.current++;};},[loadCreations]);
  const [useAgent, setUseAgent] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [savedIntegrations,setSavedIntegrations]=useState<IntegrationIntent[]>([]),[integrationRecoveryError,setIntegrationRecoveryError]=useState<string|null>(null);
  const integrationLock=useRef(false);
  const [integrationDetails,setIntegrationDetails]=useState<IntegrationIntent|null>(null);
  useEffect(()=>{const identity=apiSessionIdentity();if(!identity)return;try{const records=readIntegrationIntents(sessionStorage,{identity,projectId});setSavedIntegrations(records);setIntegrationRecoveryError(null);}catch{setIntegrationRecoveryError("Saved integration requests could not be restored. No new request will be sent until recovery storage is available.");}},[projectId]);
  const [instructions, setInstructions] = useState<{ commands: string[]; task: string; token:string|null } | null>(null);
  const [copied, setCopied] = useState(false);

  const tasks = Object.values(state.tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = tasks.filter((task) => task.status !== "accepted" && task.status !== "cancelled");
  const integrationSelection = combinableSelection(state, selected);
  const combineBlocker = combineSelectionBlocker(integrationSelection);
  const paths = new Map<string, Task[]>();
  for (const task of active) {
    for (const file of new Set(task.checkpoints.flatMap((checkpoint) => checkpoint.filesChanged))) {
      paths.set(file, [...(paths.get(file) ?? []), task]);
    }
  }
  const overlaps = [...paths.entries()].filter(([, contributors]) => contributors.length > 1);
  const inspection=changeInspectionStatus(active,overlaps.length);
  const stale = active.filter((task) => hasOlderAcceptedBase(task,state.acceptedState.currentCommit,state.tasks));


  const run = async (label: string, fn: () => Promise<void>) => {
    const generation = lifetime.current;
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (generation === lifetime.current) { const failure = e instanceof Error ? e.message : "Something went wrong"; setError(failure); toast.error(failure); }
    } finally {
      if (generation === lifetime.current) { setBusy(null); reload(); }
    }
  };

  const restoreCreation=(record:PendingTaskCreation)=>{if(!canContribute)return;const authoritative=creations.find(item=>item.taskId===record.taskId);if(!authoritative?.canRestore||!authoritative.canRetryOriginal)return;const restored=restoreTaskCreationRequest(authoritative.taskId,authoritative.input);creationIntent.current=restored.intent;setGoal(restored.goal);setDependsOn(restored.dependsOn);setIssue(restored.issue===null?null:{number:restored.issue,title:""});setSelectedTarget(restored.target);setRequirementRows(rowsFromDrafts(restored.requirements));setUseAgent(false);setRelationships(restored.dependsOn!==null||restored.issue!==null);setError(null);toast.success("Original creation request restored. Submit unchanged fields to retry the same identity; no replacement fork is requested.");};
  const create = () =>
    run("create", async () => {
      if (!canContribute) throw new Error("Write permission is required to create a change.");
      const generation = lifetime.current;
      const requirements=draftsFromRows(requirementRows);
      const formSignature=JSON.stringify({goal,dependsOn,issue:issue?.number??null,target:selectedTarget,...(requirements?{requirements}:{})});
      const replay=creationIntent.current?.signature===formSignature;
      if (!replay&&dependsOn && (!state.tasks[dependsOn] || state.tasks[dependsOn]?.status === "cancelled")) throw new Error("The selected base change is no longer available. Choose another change or clear it.");
      let target=selectedTarget;
      if(!replay&&dependsOn){const parent=state.tasks[dependsOn]!;const bound=effectiveTaskAcceptedTarget(parent);if(bound){const current=targets?.find(item=>item.ref===bound.ref);if(!current)throw new Error("The selected parent accepted branch is unavailable. Refresh its recorded target before creating this change.");if(parent.status!=="accepted"&&(current.acceptedCommit!==bound.acceptedCommit||current.acceptedVersion!==bound.acceptedVersion||current.policyVersion!==bound.policyVersion))throw new Error("The unaccepted parent target changed. Preserve its context and refresh before continuing.");target=current;}}
      if(!replay)creationIntent.current=contributionCreationIntent(null,{goal,dependsOn,issue:issue?.number??null,target,...(requirements?{requirements}:{}),signatureOverride:formSignature},()=>`${slug(goal)}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`);
      const intent=creationIntent.current;if(!intent)throw new Error("Saved creation intent is unavailable");
      const taskId=intent.taskId;
      const created = await apiJson<ChangeCreationResponse>(`/p/${projectId}/tasks`, { method: "POST", json:intent.payload });
      if (generation !== lifetime.current) return;
      const followup = changeCreationFollowup(created, managedActions && useAgent);
      creationIntent.current = null;
      setInstructions(null);
      if (followup === "terminal") {
        toast.success(`Change already ${created.status === "accepted" ? "accepted" : "cancelled"}. Its saved history is preserved; no new agent run was started.`);
      } else if (followup === "existing-agent") {
        toast.success("Change saved. Its existing agent run and checkpoints are available below; no new run was started.");
      } else if (followup === "start-agent") {
        try {
          await apiJson(`/p/${projectId}/tasks/${taskId}/agent`, { method: "POST" });
          if (generation !== lifetime.current) return;
          toast.success("Agent run started. Its checkpoints and progress will appear on the change.");
        } catch (cause) {
          if (generation !== lifetime.current) return;
          setInstructions({ ...separateGitCommands(created.commands,created.token), task: taskId });
          setError(`Change saved, but the agent could not start: ${cause instanceof Error ? cause.message : "Unknown error"}. Resume from the change below or use its Git commands.`);
        }
      } else {
        setInstructions({ ...separateGitCommands(created.commands,created.token), task: taskId });
      }
      void loadCreations();setGoal("");setRequirementRows([]);setSelectedTarget(null); setDependsOn(null); setIssue(null); setRelationships(false);
    });

  const act = (task: Task, action: "ready" | "cancel" | "agent") =>
    run(`${action}-${task.id}`, async () => {
      if (!(action === "cancel" ? canCancelTask(task) : canChangeTask(task)) || action === "agent" && !managedActions) throw new Error("This change action is unavailable with your current repository permission.");
      await apiJson(`/p/${projectId}/tasks/${task.id}/${action}`, { method: "POST" });
      if (action === "agent") toast.success("Agent run requested. Check its durable run status below.");
    });

  const requestGitAccess = (task: Task) => run(`token-${task.id}`, async () => {
    if (!canChangeTask(task)) throw new Error("Write permission for this change is required.");
    const generation=lifetime.current;
    const receipt=z.object({remote:z.string(),branch:z.string(),token:z.string(),expiresInSeconds:z.literal(3600)}).parse(await apiJson<unknown>(`/p/${projectId}/tasks/${task.id}/token`,{method:"POST"}));
    if(receipt.branch!==task.workspace.branch)throw new Error("The change branch changed. Refresh before requesting Git access again.");
    const commands=taskGitCommands({remote:receipt.remote,taskId:task.id,branch:receipt.branch,commit:task.currentCommit??task.baseCommit,stacked:!!task.dependsOn,replayed:true});
    const instructions=separateGitCommands(commands,receipt.token);
    if(generation===lifetime.current)setInstructions({...instructions,task:task.id});
  });

  const configureForkPermission = (task: Task, enabled: boolean) => run(`fork-permission-${task.id}`, async () => {
    const permission=forkPermissions?.[task.id];
    if(!canContribute||!permission?.canConfigure)throw new Error("Only this change's creator can configure maintainer edits.");
    const receipt=z.object({enabled:z.boolean(),revision:z.number().int().nonnegative(),canConfigure:z.boolean(),creatorId:z.string().nullable()}).parse(await apiJson<unknown>(`/p/${projectId}/tasks/${task.id}/fork-permission`,{method:"PUT",json:{enabled,expectedRevision:permission.revision}}));
    if(receipt.enabled!==enabled||receipt.revision<permission.revision)throw new Error("Maintainer edit permission could not be confirmed. Refresh this change before trying again.");
    toast.success(enabled?"Maintainer edits enabled for this change.":"Maintainer edits disabled for this change.");
  });

  const integrate = (saved?:IntegrationIntent, only?:string[]) => {
    if(integrationLock.current)return;
    integrationLock.current=true;
    const generation=lifetime.current;
    void run("integrate",async()=>{
      const identity=apiSessionIdentity();if(!identity)throw Error("Your verified session is unavailable. Sign in before preparing an integration request.");
      const scope={identity,projectId};
      const fromSelection=!saved&&!only;
      const chosen=only??integrationSelection;
      const blocker=fromSelection?combineSelectionBlocker(chosen):null;if(blocker)throw Error(blocker);
      const intent=saved ?? integrationIntentFor(state,chosen,savedIntegrations);
      try{setSavedIntegrations(saveIntegrationIntent(sessionStorage,scope,intent));setIntegrationRecoveryError(null);}catch{setIntegrationRecoveryError("The original integration request could not be saved for recovery. No request was sent.");throw Error("Integration recovery storage is unavailable. Your selection is unchanged; no integration was sent.");}
      try{
        const response=await apiJson<{queued:string;replayed:boolean;dispatch:'unknown'|'observed'}>(`/p/${projectId}/integrations`,{method:"POST",json:intent.request});
        if(generation!==lifetime.current||apiSessionIdentity()!==identity)return;
        if(typeof response.queued!=="string"||!response.queued||typeof response.replayed!=="boolean"||!["unknown","observed"].includes(response.dispatch))throw Error("The integration acknowledgement could not be verified.");
        if(response.dispatch==="unknown"){const retained={...intent,phase:'unknown' as const};setSavedIntegrations(saveIntegrationIntent(sessionStorage,scope,retained));toast.warning(`Request ${response.queued} is recorded, but delivery is unconfirmed. Retrying its saved request keeps the same identity and revisions.`);}
        else{try{setSavedIntegrations(acknowledgeIntegrationIntent(sessionStorage,scope,intent.request.idempotencyKey));}catch{setIntegrationRecoveryError("Delivery was confirmed, but the browser could not clear its recovery copy. Retrying that copy remains idempotent.");}if(fromSelection)setSelected([]);toast.success(`Integration delivery confirmed: ${response.queued}. Review its combined preview and checks in Review before merging repository history.`);}
      }catch(cause){if(generation!==lifetime.current||apiSessionIdentity()!==identity)return;try{setSavedIntegrations(saveIntegrationIntent(sessionStorage,scope,{...intent,phase:'unknown'}));}catch{setIntegrationRecoveryError("The original request was saved before dispatch, but its browser recovery status could not be updated.");}throw Error(`${cause instanceof Error?cause.message:"Integration result is unknown"} The original request and revisions are retained; retrying it does not create a replacement integration.`);}
    }).finally(()=>{integrationLock.current=false;});
  };

  const toggle = (id: string) => setSelected((current) => { const valid = combinableSelection(state, current); return valid.includes(id) ? valid.filter((value) => value !== id) : valid.length >= MAX_COMBINED_CHANGES ? valid : [...valid, id]; });

  return (
    <div className="space-y-5">
      <section aria-labelledby="coordination-heading" className="rounded-xl border border-border bg-gradient-to-br from-orange-500/10 via-card to-card p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-primary font-semibold">Concurrent work</p>
            <h2 id="coordination-heading" className="mt-1 text-xl font-semibold tracking-tight">One repository. Independent contributions.</h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-2xl">Follow each purpose and saved checkpoint, then review how the work comes together.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" /><span>{state.acceptedState.currentCommit?<>Accepted <code>{acceptedCommitLabel(state.acceptedState.currentCommit,8)}</code></>:"No accepted commit yet"}</span></div>
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">
          {[["Active changes", active.length], ["Shared files", inspection.sharedFilesLabel], ["Older bases", stale.length]].map(([label, count]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{count}</dd>{label==="Shared files"&&inspection.sharedFilesNote&&<p className="mt-1 text-xs text-muted-foreground">{overlaps.length>0?"Saved checkpoints · ":""}{inspection.sharedFilesNote}</p>}</div>)}
        </dl>
        {overlaps.length > 0 && <div className="mt-4 border-t border-border pt-4">
          <h3 className="text-sm font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden="true" />Overlapping saved changes</h3>
          <p className="mt-1 text-xs text-muted-foreground">Shared files need attention; an overlap alone does not establish a Git conflict.</p>
          <ul className="mt-3 space-y-2">{overlaps.slice(0, 6).map(([file, contributors]) => <li key={file} className="text-xs"><code className="break-all text-amber-200">{file}</code><span className="block mt-0.5 text-muted-foreground">{contributors.map((task) => task.goal).join(" · ")}</span></li>)}</ul>
          {overlaps.length > 6 && <p className="mt-2 text-xs text-muted-foreground">{overlaps.length - 6} more shared files in saved checkpoints.</p>}
        </div>}
      </section>
      <Card>
        <CardContent className="py-4 space-y-3">
          <PendingTaskCreations records={creations.map(record=>({...record,canRetry:canContribute&&record.canRetryOriginal}))} busy={creationReading||busy!==null} error={creationError} onRefresh={()=>void loadCreations()} onRestore={restoreCreation} hasMore={creationCursor!==null} onNext={()=>{if(creationCursor)void loadCreations(creationCursor);}}/>
          <h2 className="text-sm font-semibold"><label htmlFor="new-change-goal">Start a change</label></h2>{!canContribute&&<p className="text-sm text-muted-foreground">Write permission is required to contribute changes.</p>}
          <textarea
            id="new-change-goal"
            disabled={!canContribute || busy !== null}
            value={goal}
            onChange={(e) => { creationIntent.current = null; setGoal(e.target.value); }}
            rows={2}
            maxLength={300}
            placeholder="Describe what should change, e.g. “Add input validation to the signup form”"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {!dependsOn&&((targets?.length??0)>1||targets?.some(item=>!state.defaultBranch||item.branch!==state.defaultBranch)||selectedTarget!==null)&&<div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant="outline" disabled={busy!==null} onClick={()=>{setSearch("");setPicker("target");}}>{selectedTarget?selectedTarget.ref:"Default accepted branch"}</Button>{selectedTarget&&<span className="break-all font-mono text-xs text-muted-foreground">{selectedTarget.acceptedCommit} · accepted {selectedTarget.acceptedVersion} · policy {selectedTarget.policyVersion}</span>}</div>}
          {selectedTarget&&targets&&!targets.some(item=>JSON.stringify(item)===JSON.stringify(selectedTarget))&&<p role="status" className="text-xs text-muted-foreground">The saved branch selection changed or is unavailable. Retry preserves its original request; choose a current recorded target to start different work.</p>}
          <Button type="button" size="sm" variant="ghost" aria-expanded={relationships} aria-controls="change-relationships" disabled={busy !== null} onClick={() => setRelationships(value => !value)}>{relationships ? "Hide relationships" : dependsOn || issue ? "Edit relationships" : "Add relationships"}</Button>
          {relationships && <div id="change-relationships" className="space-y-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">Build on an existing change or link an issue this change will resolve.</p>
            <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => { setSearch(""); setPicker("change"); }}>{dependsOn ? `Builds on: ${state.tasks[dependsOn]?.goal ?? dependsOn}` : "Choose base change"}</Button>{dependsOn && <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => { creationIntent.current = null; setDependsOn(null); }}>Clear base</Button>}</div>
            <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => { setSearch(""); setPicker("issue"); void loadIssues(); }}>{issue ? `Resolves #${issue.number}${issue.title?`: ${issue.title}`:""}` : "Choose issue"}</Button>{issue && <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => { creationIntent.current = null; setIssue(null); }}>Clear issue</Button>}</div>
          </div>}
          <RequirementsEditor idPrefix="new-change" rows={requirementRows} disabled={!canContribute || busy !== null} onChange={(rows) => { creationIntent.current = null; setRequirementRows(rows); }} />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {managedActions&&<label className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={busy !== null} checked={useAgent} onChange={(e) => setUseAgent(e.target.checked)} />
              <Bot className="h-4 w-4" aria-hidden="true" /> Let an AI agent do the work
            </label>}
            <Button type="button" variant="orange" disabled={!canContribute || !goal.trim() || busy !== null} onClick={create}>
              <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" /> {busy === "create" ? "Creating…" : managedActions && useAgent ? "Start with an agent" : "Create and get git commands"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Each change gets its own isolated copy of the repository. Contributors can push with plain Git; saved commits stay separate until a combined preview passes checks and receives human acceptance.</p>
        </CardContent>
      </Card>

      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">Changes ({tasks.length})</h2>
          <p className="text-xs text-muted-foreground">Select up to 8 ready or blocked changes to prepare a review combined preview.</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={combineBlocker !== null || busy !== null} title={combineBlocker ?? undefined} aria-describedby="combine-selected-reason" onClick={()=>integrate()}>
          <GitPullRequestArrow className="h-4 w-4 mr-1.5" aria-hidden="true" /> {busy === "integrate" ? "Starting…" : savedIntegrations.some(record=>JSON.stringify(record.request.taskIds)===JSON.stringify(integrationSelection)) ? "Retry original integration" : `Combine selected (${integrationSelection.length})`}
        </Button>
        <p id="combine-selected-reason" className="w-full text-xs text-muted-foreground">{combineBlocker ?? (savedIntegrations.length>0&&!savedIntegrations.some(record=>JSON.stringify(record.request.taskIds)===JSON.stringify(integrationSelection)) ? "Starts a separate integration from the saved requests below." : `Combines exactly the ${integrationSelection.length} selected ${integrationSelection.length===1?"change":"changes"}.`)}</p>
      </div>

      {taskId&&!linkedTask&&<p role="status" className="text-sm text-muted-foreground">The linked change is unavailable in this repository. Current changes remain below.</p>}
      {integrationRecoveryError&&<p role="alert" className="text-sm text-destructive">{integrationRecoveryError}</p>}
      {savedIntegrations.length>0&&<section aria-label="Saved integration requests" className="space-y-3 border-y border-border py-4"><h2 className="text-sm font-semibold">Saved integration requests</h2><p className="text-xs text-muted-foreground">Retries keep the original contributions and revisions. A changed selection starts a separate request.</p>{savedIntegrations.map(record=><div key={record.request.idempotencyKey} className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs">Request <code title={record.request.idempotencyKey}>{record.request.idempotencyKey.slice(0,8)}</code> · {record.request.taskIds.length} {record.request.taskIds.length===1?"contribution":"contributions"} · {record.phase==='unknown'?'Outcome unconfirmed':'Prepared'}</p><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="ghost" onClick={()=>setIntegrationDetails(record)}>Inspect original request</Button><Button type="button" size="sm" variant="outline" disabled={busy!==null} onClick={()=>integrate(record)}>Retry original request</Button></div></div>)}</section>}
      <Dialog open={integrationDetails!==null} onOpenChange={open=>{if(!open)setIntegrationDetails(null);}} className="max-h-[calc(100dvh-2rem)] overflow-y-auto"><DialogHeader><DialogTitle>Original integration request</DialogTitle><DialogDescription>These saved revisions are sent unchanged when you retry.</DialogDescription></DialogHeader>{integrationDetails&&<div className="space-y-3 text-xs min-w-0"><p className="break-all">Request <code>{integrationDetails.request.idempotencyKey}</code></p><p>Prepared {new Date(integrationDetails.createdAt).toLocaleString()}</p><p className="break-all">Accepted commit <code>{integrationDetails.request.expected.acceptedCommit??"unborn"}</code> · policy {integrationDetails.request.expected.policyVersion}</p><ul className="space-y-4">{integrationDetails.request.expected.contributions.map(input=><li key={input.taskId}><h3 className="font-medium break-all">{input.taskId}</h3><p className="mt-1 break-all">Saved head <code>{input.commit??"unborn"}</code></p><p className="mt-1 break-all">Base <code>{input.base??"unborn"}</code></p>{input.acceptedTarget&&<p className="mt-1 break-all">Target <code>{input.acceptedTarget.ref}</code> · accepted version {input.acceptedTarget.acceptedVersion}</p>}{input.targetGeneration&&<p className="mt-1">Target generation {input.targetGeneration.generation}</p>}</li>)}</ul><Button type="button" size="sm" variant="outline" onClick={()=>setIntegrationDetails(null)}>Close</Button></div>}</Dialog>
      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {tasks.length === 0 && <p className="p-4 text-sm text-muted-foreground">No changes yet. Start one above.</p>}
          {tasks.map((t) => {
            const st = STATUS[t.status];
            const latestCheckpoint = t.checkpoints.at(-1);
            const canSelect = t.status === "ready" || t.status === "blocked";
            const progress = changeProgress(t, state.candidates);
            const reviewHref = `/p/${projectId}/review${progress.previewId ? `?candidate=${encodeURIComponent(progress.previewId)}` : ""}`;
            const primaryAction = progress.step === "contribution" && canChangeTask(t) && (t.status === "working" || t.status === "checkpointed")
              ? <Button type="button" size="sm" disabled={busy !== null} title="Verify the pushed Git branch and mark this change ready" onClick={() => act(t, "ready")}><Check className="h-3.5 w-3.5 mr-1" aria-hidden="true" />{busy === `ready-${t.id}` ? "Verifying…" : "Mark ready"}</Button>
              : progress.step === "ready" && t.status === "ready" && canContribute
                ? <Button type="button" size="sm" disabled={busy !== null} title="Combine this change with the latest merged version and run checks" onClick={() => integrate(undefined, [t.id])}><GitPullRequestArrow className="h-3.5 w-3.5 mr-1" aria-hidden="true" />{busy === "integrate" ? "Combining…" : "Combine this change"}</Button>
                : progress.step === "verifying"
                  ? <Button type="button" size="sm" variant="secondary" onClick={() => navigate(reviewHref)}>Watch checks</Button>
                  : progress.step === "review"
                    ? <Button type="button" size="sm" onClick={() => navigate(reviewHref)}>{t.status === "needs_decision" ? "Decide" : "Review"}</Button>
                    : progress.step === "merged" && t.checkpoints.length > 0
                      ? <Button type="button" size="sm" variant="secondary" onClick={() => navigate(`/p/${projectId}/review?task=${t.id}`)}>View merged diff</Button>
                      : undefined;
            return (
              <div key={t.id} ref={t.id===linkedTask?.id?linkedTaskElement:undefined} tabIndex={t.id===linkedTask?.id?-1:undefined} role={t.id===linkedTask?.id?"group":undefined} aria-label={t.id===linkedTask?.id?`Linked change: ${t.goal}`:undefined} className={`px-4 py-4 flex items-start gap-3 flex-wrap sm:flex-nowrap ${t.id===linkedTask?.id?"bg-primary/5 ring-2 ring-inset ring-primary outline-none scroll-mt-24":""}`}>
                <Checkbox className="mt-1.5" disabled={!canSelect||busy!==null} checked={integrationSelection.includes(t.id)} onCheckedChange={() => toggle(t.id)} aria-label={canSelect ? `Select “${t.goal}” for integration` : `“${t.goal}” is not ready to integrate`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-medium break-words min-w-0">{t.goal}</h3>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {t.contributor.type === "agent" ? (
                      <Badge variant="purple" className="gap-1"><Bot className="h-3 w-3" aria-hidden="true" />{t.contributor.name} · AI</Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1"><User className="h-3 w-3" aria-hidden="true" />{t.contributor.name}</Badge>
                    )}
                    {t.externalTool&&t.contributor.type==="human"&&<span title={`External session ${t.externalTool.sessionId}; creator-attested, not vendor verified`}>External agent · {t.externalTool.tool} · reported by {t.initiatedBy?.name??t.contributor.name}</span>}
                    {t.initiatedBy?.type === "human" && t.initiatedBy.id !== t.contributor.id && <span>Requested by {t.initiatedBy.name}</span>}
                    {t.dependsOn && (
                      <span className="inline-flex items-center gap-1 min-w-0">
                        <Layers className="h-3 w-3 shrink-0" aria-hidden="true" />Stacked on <span className="break-all">{state.tasks[t.dependsOn]?.goal ?? t.dependsOn}</span>
                        {state.tasks[t.dependsOn] && state.tasks[t.dependsOn]!.status !== "accepted" ? ` (${STATUS[state.tasks[t.dependsOn]!.status].label.toLowerCase()})` : ""}
                      </span>
                    )}
                    {t.issue !== undefined && (
                      <a className="underline hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/p/${projectId}/issues?n=${t.issue}`} onClick={(e) => { e.preventDefault(); navigate(`/p/${projectId}/issues?n=${t.issue}`); }}>Resolves #{t.issue}</a>
                    )}
                    <code className="break-all">{t.id}</code>
                    <span>{timeAgo(t.createdAt)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" aria-hidden="true" />Base <code>{t.baseCommit?acceptedCommitLabel(t.baseCommit,8):"Empty accepted history"}</code></span>
                    {t.currentCommit&&t.checkpoints.some(checkpoint=>checkpoint.commitHash===t.currentCommit) ? <span>Saved <code>{t.currentCommit?.slice(0, 8)}</code> · {t.checkpoints.length} checkpoint{t.checkpoints.length === 1 ? "" : "s"}</span> : <span>Checkpoint not verified yet</span>}
                    {stale.some((task) => task.id === t.id) && <span className="text-amber-200">Accepted history advanced · combined preview must use the latest base</span>}
                  </div>
                  <ChangeStepper className="mt-3" step={progress.step} halted={progress.halted} action={primaryAction} />
                  {latestCheckpoint && <p className="mt-1 text-xs text-muted-foreground break-words">Latest checkpoint: {latestCheckpoint.message} · {timeAgo(latestCheckpoint.timestamp)}</p>}
                  {forkPermissions?.[t.id]?.canConfigure && t.status !== "accepted" && t.status !== "cancelled" && <div className="mt-3 flex items-center gap-2"><Checkbox id={`maintainer-edits-${t.id}`} checked={forkPermissions[t.id]?.enabled??false} disabled={!canContribute||busy!==null} onCheckedChange={checked=>{if(typeof checked==="boolean")void configureForkPermission(t,checked);}}/><label htmlFor={`maintainer-edits-${t.id}`} className="text-sm">Allow maintainer edits</label></div>}
                  {t.checkpoints.some((checkpoint) => checkpoint.filesChanged.length > 0) && <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer rounded w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Files touched in saved checkpoints</summary>
                    <ul className="mt-2 space-y-1">{[...new Set(t.checkpoints.flatMap((checkpoint) => checkpoint.filesChanged))].map((file) => <li key={file}><code className="break-all">{file}</code>{(paths.get(file)?.length ?? 0) > 1 && <span className="ml-2 text-amber-200">shared with another active change</span>}</li>)}</ul>
                  </details>}
                  {t.agentRunId && <AgentChangeSummary key={`summary:${projectId}:${t.id}:${t.agentRunId}`} projectId={projectId} taskId={t.id} runId={t.agentRunId} revision={t.updatedAt} />}
                  {managedActions && t.agentRunId && <NeedsAttention className="mt-3" label="Agent run needs attention" description="The agent stopped before finishing. Its saved work is kept so you can resume or copy it." attention={t.status === "blocked" || t.status === "needs_decision"}><AgentRecoveryPanel key={`${projectId}:${t.id}:${t.agentRunId}`} projectId={projectId} taskId={t.id} runId={t.agentRunId} canResume={["working", "checkpointed", "blocked", "needs_decision"].includes(t.status)} busy={busy !== null} onStarted={reload} /></NeedsAttention>}
                  {managedActions && t.agentWorkflowInstanceId && <AgentRunControls key={t.agentWorkflowInstanceId} projectId={projectId} instanceId={t.agentWorkflowInstanceId} canRetry={["working", "checkpointed", "blocked", "needs_decision"].includes(t.status)} retrying={busy !== null} onRetry={() => void act(t, "agent")} onChange={reload} />}
                  {t.status === "blocked" && (
                    <p className="mt-1.5 text-xs text-destructive">Blocked: {t.blockedReason ?? "no reason was recorded"}</p>
                  )}
                  {queueByTask.get(t.id) && t.status !== "accepted" && <p className="mt-1.5 text-xs text-muted-foreground break-words">Merge queue: <Badge variant={QUEUE_STATUS[queueByTask.get(t.id)!.status].variant}>{QUEUE_STATUS[queueByTask.get(t.id)!.status].label}</Badge> {queueByTask.get(t.id)!.reason ?? ""}</p>}
                  {t.status !== "accepted" && <ChangeUpdateStatus update={updateByTask.get(t.id)} task={t} projectId={projectId} isOwner={isOwner} onChange={() => { void coordination.refresh(); reload(); }} />}
                </div>
                <div className="flex gap-1.5 shrink-0 flex-wrap justify-end ml-auto">
                  {isOwner&&canChangeTask(t)&&t.contributor.type==="human"&&t.currentCommit&&!["accepted","cancelled","integrating","verifying"].includes(t.status)&&<Button type="button" size="sm" variant="outline" disabled={busy!==null} onClick={()=>setRetargetTaskId(t.id)}>Retarget</Button>}
                  {canChangeTask(t) && t.status !== "accepted" && t.status !== "cancelled" && <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={()=>void requestGitAccess(t)}>{busy===`token-${t.id}`?"Requesting…":"Git commands"}</Button>}
                  {t.checkpoints.length > 0 && progress.step !== "merged" && (
                    <Button type="button" size="sm" variant="outline" onClick={() => navigate(`/p/${projectId}/review?task=${t.id}`)} aria-label={`View diff of “${t.goal}”`}>Diff</Button>
                  )}
                  {canChangeTask(t) && managedActions && !t.agentWorkflowInstanceId && (t.status === "working" || t.status === "checkpointed") && <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(t, "agent")}><Bot className="h-3.5 w-3.5 mr-1" aria-hidden="true" />{busy === `agent-${t.id}` ? "Starting…" : "Hand to agent"}</Button>}
                  {canCancelTask(t) && t.status !== "accepted" && t.status !== "cancelled" && t.status !== "integrating" && t.status !== "verifying" && (
                    <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(t, "cancel")} aria-label={`Cancel “${t.goal}”`} title="Cancel change"><X className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={picker !== null} onOpenChange={open => { if (!open) setPicker(null); }}>
        <DialogHeader><DialogTitle>{picker==="target"?"Choose accepted branch":picker === "change" ? "Build on a change" : "Link an issue"}</DialogTitle><DialogDescription>{picker==="target"?"Select a recorded accepted root. This change stays bound to its exact commit and policy.":picker === "change" ? "The new workspace starts from this change’s saved Git state." : "The issue closes when this change is accepted."}</DialogDescription></DialogHeader>
        <Input aria-label={picker==="target"?"Find accepted branch":picker === "change" ? "Find a base change" : "Find an issue"} placeholder="Search" value={search} onChange={event => setSearch(event.target.value)} />
        <div className="mt-3 max-h-72 overflow-auto space-y-1">
          {picker==="target"&&<ContributionTargetChoices targets={targets} search={search} error={targetError} truncated={targetsTruncated} disabled={busy!==null} onRefresh={()=>void loadTargets()} onDefault={()=>{creationIntent.current=null;setSelectedTarget(null);setPicker(null);}} onSelect={item=>{creationIntent.current=null;setSelectedTarget(item);setPicker(null);}}/>}
          {picker === "change" && tasks.filter(task => task.status !== "cancelled" && `${task.goal} ${task.id}`.toLowerCase().includes(search.toLowerCase())).map(task => <Button type="button" key={task.id} variant="ghost" className="w-full h-auto justify-start whitespace-normal text-left" onClick={() => { if (dependsOn !== task.id) creationIntent.current = null; setDependsOn(task.id);setSelectedTarget(null); setPicker(null); }}>{task.goal} · {STATUS[task.status].label}</Button>)}
          {picker === "change" && !tasks.some(task => task.status !== "cancelled" && `${task.goal} ${task.id}`.toLowerCase().includes(search.toLowerCase())) && <p className="text-sm text-muted-foreground">No matching changes.</p>}
          {picker === "issue" && issuesLoading && <p role="status" className="text-sm text-muted-foreground">Loading open issues…</p>}
          {picker === "issue" && issuesError && <div role="alert" className="text-sm text-destructive"><p>{issuesError}</p><Button type="button" variant="outline" size="sm" onClick={() => void loadIssues()}>Retry</Button></div>}
          {picker === "issue" && issues?.filter(item => `${item.number} ${item.title}`.toLowerCase().includes(search.toLowerCase())).map(item => <Button type="button" key={item.number} variant="ghost" className="w-full h-auto justify-start whitespace-normal text-left" onClick={() => { if (issue?.number !== item.number) creationIntent.current = null; setIssue(item); setPicker(null); }}>#{item.number} {item.title}</Button>)}
          {picker === "issue" && !issuesLoading && !issuesError && issues && !issues.some(item => `${item.number} ${item.title}`.toLowerCase().includes(search.toLowerCase())) && <p className="text-sm text-muted-foreground">No matching open issues.</p>}
        </div>
      </Dialog>

      {isOwner&&retargetTaskId&&state.tasks[retargetTaskId]&&<RetargetDialog key={retargetTaskId} projectId={projectId} task={state.tasks[retargetTaskId]!} targets={targets??[]} requestIds={retargetRequestIds.current} allowed={canChangeTask(state.tasks[retargetTaskId]!)} onClose={()=>setRetargetTaskId(null)} reload={reload}/> }

      <Dialog open={instructions !== null} onOpenChange={() => setInstructions(null)}>
        <DialogHeader>
          <DialogTitle>Work on it with Git</DialogTitle>
          <DialogDescription>Your credential works only for this change and expires in one hour. Push your commits, then press “Ready”.</DialogDescription>
        </DialogHeader>
        <pre aria-label="Git commands" className="text-xs bg-muted/40 rounded-md p-3 overflow-auto whitespace-pre-wrap break-all">{instructions?.commands.join("\n")}</pre>
        {instructions?.token&&<GitCredential key={instructions.token} token={instructions.token}/>}
        <div className="flex justify-end gap-2 mt-3">
          <Button type="button"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(instructions?.commands.join("\n") ?? "");
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Copy className="h-4 w-4 mr-1.5" aria-hidden="true" /> <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
          </Button>
          <Button type="button" variant="orange" onClick={() => setInstructions(null)}>Done</Button>
        </div>
      </Dialog>
    </div>
  );
}
