import {preservedCandidateSuccessors} from "../candidate-lineage";
import {checkedScenarioDiscovery,checkedScenarioDispatch,checkedScenarioStatus,scenarioFinished,scenarioPreparationBanner,type SavedScenarioRun} from "../scenario-run-state";
import {WORKFLOW_STATUS_LABELS,type WorkflowStatus} from "../workflow-run-state";
import { summarizeIntegration } from "../integration-summary";
import { savedWorkflowDecision, recordedWorkflowCandidates } from "../workflow-run-state";
import { WorkflowRunControls } from "../components/WorkflowRunControls";
import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "../components/StatusBanner";
import { CandidateJournal } from "../components/CandidateJournal";
import { LivePreview } from "../components/LivePreview";
import { DecisionModal } from "../components/DecisionModal";
import { EvidenceDrawer } from "../components/EvidenceDrawer";
import { CandidateReview, LegacyCandidateRerun } from "../components/CandidateReview";
import { apiJson } from "../api";
import { RebaseRecovery } from "../components/RebaseRecovery";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "../router";
import type { CandidateGeneration, FlareGitProjectState, ProductDecision } from "@/core/types";

const PublicationRecoveryPanel=lazy(async()=>({default:(await import("../components/PublicationRecoveryPanel")).PublicationRecoveryPanel}));

const IN_PROGRESS: Record<string, string> = { composing: "Combining", repairing: "AI repairing conflicts", verifying: "Running checks", verified: "Approval saved; awaiting integration" };


export function IntegrationTab({
  projectId,
  state,
  reload,
  kind,
  isOwner = false,
}: {
  projectId: string;
  state: FlareGitProjectState;
  reload: () => void;
  kind: string;
  isOwner?: boolean;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [reviewDecisionId, setReviewDecisionId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const scenarioScope=projectId;
  const activeScope=useRef(scenarioScope);activeScope.current=scenarioScope;
  const [scenario, setScenario] = useState<SavedScenarioRun | null>(null);
  const [scenarioStatus,setScenarioStatus]=useState<WorkflowStatus|null>(null);
  const [scenarioChecking,setScenarioChecking]=useState(false);
  const [scenarioStarting,setScenarioStarting]=useState(false);
  const [discoveryRevision,setDiscoveryRevision]=useState(0);
  const [scenarioCheck,setScenarioCheck]=useState(0);
  const [scenarioDiscoveryPending,setScenarioDiscoveryPending]=useState(kind==='demo');
  const [scenarioDiscoveryIncomplete,setScenarioDiscoveryIncomplete]=useState(false);
  const [discoveryCursor,setDiscoveryCursor]=useState<string|null>(null);
  const [nextDiscoveryCursor,setNextDiscoveryCursor]=useState<string|null>(null);
  const discoveredRuns=useRef(new Map<string,WorkflowStatus>());
  useEffect(()=>{discoveredRuns.current.clear();setDiscoveryCursor(null);setNextDiscoveryCursor(null);},[projectId]);
  const saveScenario=(value:SavedScenarioRun)=>setScenario(value);
  useEffect(()=>{
    if(kind!=='demo'||!isOwner)return;
    let alive=true;const scope=scenarioScope;const abort=new AbortController();setScenarioDiscoveryPending(true);setScenario(null);setScenarioStatus(null);
    void (async()=>{try{
      const page=await apiJson<unknown>(`/p/${projectId}/scenarios${discoveryCursor?`?cursor=${encodeURIComponent(discoveryCursor)}`:""}`,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15_000)])});
      const runs=checkedScenarioDiscovery(page,discoveryCursor,new Set(discoveredRuns.current.keys()));const observations=new Map<string,WorkflowStatus>();let cursor=0;
      await Promise.all(Array.from({length:Math.min(3,runs.runs.length)},async()=>{for(let index=cursor++;index<runs.runs.length;index=cursor++){const id=runs.runs[index]!.instanceId;let status:WorkflowStatus='unknown';try{status=checkedScenarioStatus(await apiJson<unknown>(`/p/${projectId}/workflows/${id}`,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15_000)])}),id);}catch{/* Unknown remains pending. */}observations.set(id,status);}}));
      if(!alive||activeScope.current!==scope)return;
      setScenarioDiscoveryIncomplete(runs.nextCursor!==null);setNextDiscoveryCursor(runs.nextCursor);
      for(const [id,status] of observations)discoveredRuns.current.set(id,status);
      const selected=[...discoveredRuns.current].find(([,status])=>!scenarioFinished(status))??[...discoveredRuns.current][0];
      if(selected){setScenario({act:'saved',instanceId:selected[0]});setScenarioStatus(selected[1]);}
      setScenarioDiscoveryPending(false);
    }catch{if(alive&&activeScope.current===scope){setScenarioDiscoveryIncomplete(true);setScenarioDiscoveryPending(false);setError('Registered scenario runs could not be checked. Refresh before starting another run.');}}})();
    return()=>{alive=false;abort.abort();};
  },[projectId,kind,isOwner,discoveryCursor,discoveryRevision]);
  useEffect(()=>{
    if(!scenario?.instanceId)return;
    let alive=true;const scope=scenarioScope,id=scenario.instanceId;const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;let checks=0;
    const check=async()=>{setScenarioChecking(true);try{const raw=await apiJson<unknown>(`/p/${projectId}/workflows/${id}`,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15_000)])});if(!alive||activeScope.current!==scope)return;const status=checkedScenarioStatus(raw,id);setScenarioStatus(status);if(!scenarioFinished(status)&&++checks<20)timer=setTimeout(()=>void check(),3000);reload();}catch{if(alive&&activeScope.current===scope)setScenarioStatus('unknown');}finally{if(alive&&activeScope.current===scope)setScenarioChecking(false);}};
    void check();return()=>{alive=false;abort.abort();if(timer)clearTimeout(timer);};
  },[scenario?.instanceId,scenarioScope,projectId,scenarioCheck]);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => summarizeIntegration(state), [state]);
  const preparationBanner=summary.stage==="accepted"?scenarioPreparationBanner(scenario,scenarioStatus):null;
  const describe = (c: CandidateGeneration) => c.participatingTaskIds.map((id) => state.tasks[id]?.goal ?? id).join(" + ");
  const all = Object.values(state.candidates);
  const preserved=useMemo(()=>preservedCandidateSuccessors(state.candidates),[state.candidates]);
  const reviewing = all.filter((c) => c.status === "awaiting_review" || (c.review?.approved && c.status === "verified" && !state.journal.some((j) => j.candidateId === c.id)));
  const running = all.filter((c) => !preserved.has(c.id) && (c.status === "composing" || c.status === "repairing" || c.status === "verifying" || c.status === "verified") && !reviewing.includes(c));
  const savedRuns = useMemo(() => recordedWorkflowCandidates(Object.values(state.candidates).filter(candidate=>!preserved.has(candidate.id))), [state.candidates,preserved]);
  const [runPage, setRunPage] = useState(0);
  useEffect(() => setRunPage(0), [projectId]);
  const currentRunPage = Math.min(runPage, Math.max(0, Math.ceil(savedRuns.length / 10) - 1));
  const visibleRuns = savedRuns.slice(currentRunPage * 10, currentRunPage * 10 + 10);
  const savedRunPages = new Map(savedRuns.map((candidate, index) => [candidate.id, Math.floor(index / 10)]));
  const landed = all.filter((c) => c.status === "accepted").slice(-10).reverse();
  const failed = all.filter((c) => c.status === "failed" || c.status === "stale").slice(-10).reverse();
  const pendingDecisions = Object.values(state.decisions).filter(decision => decision.status === "pending");
  const resolvedDecisions = Object.values(state.decisions).filter(decision => decision.status === "resolved").sort((a, b) => (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt));
  const pending: ProductDecision | undefined = pendingDecisions.find(decision => decision.id === reviewDecisionId && decision.id !== dismissed) ?? pendingDecisions.find(decision => decision.id !== dismissed);

  const resolve = async (decisionId: string, selectedOptionId: string) => {
    setResolving(true);
    try {
      await apiJson(`/p/${projectId}/decisions/resolve`, { method: "POST", json: { decisionId, selectedOptionId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply the decision");
    } finally {
      setResolving(false);
      reload();
    }
  };

  const runScenario = async (act: string) => {
    const scope=scenarioScope;setScenarioStarting(true);
    saveScenario({act,instanceId:null});setScenarioStatus(null);
    setError(null);
    try {
      const response=await apiJson<unknown>(`/p/${projectId}/scenarios/run`, { method: "POST", json: { act },signal:AbortSignal.timeout(30_000) });
      if(activeScope.current!==scope)return;
      saveScenario({act,instanceId:checkedScenarioDispatch(response)});
    } catch (e) {
      if(activeScope.current===scope)setError(`${e instanceof Error ? e.message : "Scenario start was not confirmed"} Do not start another scenario until the saved dispatch is reconciled.`);
    } finally {
      if(activeScope.current===scope){setScenarioStarting(false);reload();}
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg overflow-hidden border border-border">
        <StatusBanner stage={preparationBanner?.stage??summary.stage} message={preparationBanner?.message??summary.message} detail={preparationBanner?.detail??summary.detail} lastAcceptedCommit={state.acceptedState.currentCommit} />
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        {kind === "demo" && (
          <>
            {[["act1", "Text conflict"], ["act2", "Clean merge, broken behavior"], ["act3", "Contradiction"]].map(([act, label]) => (
              <Button key={act} size="sm" variant="outline" disabled={!isOwner||scenarioDiscoveryPending||scenarioDiscoveryIncomplete||Boolean(scenario&&!scenarioFinished(scenarioStatus))||running.length>0||reviewing.length>0||Object.values(state.tasks).some(task=>["working","integrating","verifying"].includes(task.status))} onClick={() => runScenario(act!)}>
                <Play className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> {scenario?.act === act && !scenarioFinished(scenarioStatus) ? scenario?.instanceId?"Run saved":scenarioStarting?"Starting…":"Start unconfirmed" : label}
              </Button>
            ))}
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => setEvidenceOpen(true)}>
          <FileText className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Audit evidence
        </Button>
      </div>
      {kind==='demo'&&(scenarioDiscoveryPending||scenarioDiscoveryIncomplete)&&<p role="status" className="text-sm text-muted-foreground">{scenarioDiscoveryPending?'Checking registered scenario runs…':'Scenario inventory is incomplete. Existing runs must be checked before another start.'}{nextDiscoveryCursor&&!scenarioDiscoveryPending&&<Button size="sm" variant="ghost" onClick={()=>setDiscoveryCursor(nextDiscoveryCursor)}>Check older scenario runs</Button>}</p>}
      {scenario&&<section role="status" className="rounded-lg border border-border p-3 text-sm"><p>{scenario.instanceId?`Saved scenario · ${scenarioStatus?WORKFLOW_STATUS_LABELS[scenarioStatus]:"Status not checked"}`:"Scenario start is unconfirmed"}</p>{scenario.instanceId?<><code className="text-xs break-all">{scenario.instanceId}</code><Button size="sm" variant="ghost" disabled={scenarioChecking} onClick={()=>setScenarioCheck(value=>value+1)}>{scenarioChecking?"Checking…":"Check saved scenario"}</Button></>:<p className="text-xs text-muted-foreground">The request may have been dispatched. Inspect registered runs before starting another scenario.</p>}</section>}
      {kind==='demo'&&isOwner&&<Button size="sm" variant="ghost" disabled={scenarioStarting||scenarioDiscoveryPending} onClick={()=>{discoveredRuns.current.clear();setDiscoveryCursor(null);setNextDiscoveryCursor(null);setError(null);setDiscoveryRevision(value=>value+1);}}>Check registered runs</Button>}
      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {preserved.size>0&&<section aria-label="Preserved attempts" className="space-y-2 text-sm"><h2 className="font-semibold">Preserved attempts</h2>{[...preserved].map(([id,next])=>{const previous=state.candidates[id]!;return <div key={id} className="rounded-lg border border-border p-3"><p>Recorded original status: {previous.status.replaceAll('_',' ')}</p><div className="flex gap-3 text-xs"><a className="text-primary underline" href={`/#/p/${projectId}/review?candidate=${encodeURIComponent(id)}`}>Original review and context</a><a className="text-primary underline" href={`/#/p/${projectId}/review?candidate=${encodeURIComponent(next.id)}`}>Successor review · {next.id.slice(0,12)}</a></div>{isOwner&&previous.workflowInstanceId&&<WorkflowRunControls projectId={projectId} instanceId={previous.workflowInstanceId} isOwner readOnly onChange={reload}/>}</div>;})}</section>}
      {isOwner&&<Suspense fallback={null}><PublicationRecoveryPanel key={`publication-recovery:${projectId}`} projectId={projectId} onChange={reload}/></Suspense>}
      <RebaseRecovery projectId={projectId} isOwner={isOwner} tasks={state.tasks} onRecovered={reload} />
      {isOwner && savedRuns.length > 0 && <section id="int-saved-runs" tabIndex={-1} aria-labelledby="int-saved-runs-title" className="space-y-3"><h2 id="int-saved-runs-title" className="text-sm font-semibold">Saved integration runs</h2><p className="text-xs text-muted-foreground">Check a saved run, pause it, or continue it after interruption. Review stays available.</p><ul className="space-y-3">{visibleRuns.map(candidate => <li key={`${projectId}:${candidate.workflowInstanceId}`} className="rounded-lg border border-border p-3 min-w-0"><a href={`/#/p/${projectId}/review?candidate=${encodeURIComponent(candidate.id)}`} className="text-sm font-medium break-words hover:underline">{describe(candidate)}</a><p className="mt-1 text-xs text-muted-foreground">Candidate {candidate.status.replaceAll("_", " ")} · {candidate.participatingTaskIds.length} {candidate.participatingTaskIds.length === 1 ? "recorded input" : "recorded inputs"} · base <code>{candidate.expectedAcceptedBase.slice(0, 12)}</code></p><WorkflowRunControls projectId={projectId} instanceId={candidate.workflowInstanceId!} savedDecision={savedWorkflowDecision(candidate, state.journal.some(entry => entry.candidateId === candidate.id))} isOwner={isOwner} onChange={reload} /></li>)}</ul><div className="flex flex-wrap gap-3 items-center"><p className="text-[11px] text-muted-foreground">Showing {currentRunPage * 10 + 1}–{currentRunPage * 10 + visibleRuns.length} of {savedRuns.length} saved runs</p>{savedRuns.length > 10 && <><Button size="sm" variant="outline" disabled={currentRunPage === 0} onClick={() => setRunPage(currentRunPage - 1)}>Newer runs</Button><Button size="sm" variant="outline" disabled={(currentRunPage + 1) * 10 >= savedRuns.length} onClick={() => setRunPage(currentRunPage + 1)}>Older runs</Button></>}</div></section>}
      <section aria-labelledby="int-review" className="space-y-2">
        <h2 id="int-review" className="text-sm font-semibold">Review & saved decisions ({reviewing.length})</h2>
        {reviewing.length === 0 ? <p className="text-sm text-muted-foreground">No review or saved approval is awaiting integration.</p> :
          reviewing.map((c) => <CandidateReview key={c.id} projectId={projectId} isOwner={isOwner} savedDecisionRecoveryInPanel={isOwner && savedRunPages.has(c.id) && Boolean(savedWorkflowDecision(c, state.journal.some(entry => entry.candidateId === c.id)))} onRecoverSavedRun={() => { setRunPage(savedRunPages.get(c.id) ?? 0); requestAnimationFrame(() => { const panel = document.getElementById("int-saved-runs"); panel?.scrollIntoView({ block: "start" }); panel?.focus({ preventScroll: true }); }); }} candidate={c} tasks={state.tasks} evidence={c.evidenceId ? state.evidence[c.evidenceId] : undefined} onDone={reload} />)}
      </section>
      <div className="grid gap-4 md:grid-cols-3">
        <section aria-labelledby="int-running" className="rounded-lg border border-border p-3 space-y-2 min-w-0">
          <h2 id="int-running" className="text-sm font-semibold">In progress ({running.length})</h2>
          {running.length === 0 ? <p className="text-xs text-muted-foreground">No integration is running.</p> : (
            <ul className="space-y-2">
              {running.map((c) => (
                <li key={c.id} className="text-sm min-w-0">
                  <div className="break-words">{describe(c)}</div>
                  <Badge variant="warning">{IN_PROGRESS[c.status] ?? c.status}</Badge>
                  {!preserved.has(c.id)&&<LegacyCandidateRerun projectId={projectId} candidate={c} isOwner={isOwner} onDone={reload} />}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="int-landed" className="rounded-lg border border-border p-3 space-y-2 min-w-0">
          <h2 id="int-landed" className="text-sm font-semibold">Landed ({all.filter((c) => c.status === "accepted").length})</h2>
          {landed.length === 0 ? <p className="text-xs text-muted-foreground">Nothing has landed yet.</p> : (
            <ul className="space-y-2">
              {landed.map((c) => {
                const entry = state.journal.find((j) => j.candidateId === c.id);
                return (
                  <li key={c.id} className="text-sm min-w-0">
                    <div className="break-words">{describe(c)}</div>
                    <div className="text-xs text-muted-foreground"><Badge variant="success">Accepted</Badge> <code className="break-all">{c.candidateCommit?.slice(0, 7)}</code>{entry ? ` · ${timeAgo(entry.timestamp)}` : ""}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-labelledby="int-failed" className="rounded-lg border border-border p-3 space-y-2 min-w-0">
          <h2 id="int-failed" className="text-sm font-semibold">Failed ({all.filter((c) => c.status === "failed" || c.status === "stale").length})</h2>
          {failed.length === 0 ? <p className="text-xs text-muted-foreground">No failed candidates are recorded.</p> : (
            <ul className="space-y-2">
              {failed.map((c) => (
                <li key={c.id} className="text-sm min-w-0">
                  <div className="break-words">{describe(c)}</div>
                  <div className="text-xs"><Badge variant={c.status === "stale" ? "outline" : "destructive"}>{c.status === "stale" ? "Outdated" : "Failed"}</Badge> <span className="text-muted-foreground break-words">{c.failureBlocker ?? (c.status === "stale" ? "The accepted version moved on before this finished." : "No reason was recorded.")}</span></div>
                  {!preserved.has(c.id)&&<LegacyCandidateRerun projectId={projectId} candidate={c} isOwner={isOwner} onDone={reload} />}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className={`grid gap-4 ${kind === "demo" ? "lg:grid-cols-2" : ""}`}>
        <div className="min-h-[360px]">
          <CandidateJournal candidates={state.candidates} journal={state.journal} />
        </div>
        {kind === "demo" && (
          <div className="min-h-[560px]">
            <LivePreview key={`${projectId}:${state.acceptedState.currentCommit}`} isOwner={isOwner} projectId={projectId} currentCommit={state.acceptedState.currentCommit} />
          </div>
        )}
      </div>
      {pendingDecisions.length > 0 && <section aria-labelledby="pending-decisions" className="rounded-lg border border-border p-4 space-y-3"><h2 id="pending-decisions" className="text-sm font-semibold">Decisions needed</h2>{pendingDecisions.map(decision => <div key={decision.id} className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm min-w-0 break-words">{decision.question}</p><Button variant="outline" size="sm" onClick={() => { setReviewDecisionId(decision.id); setDismissed(null); }}>Review choices</Button></div>)}</section>}
      {resolvedDecisions.length > 0 && <section aria-labelledby="resolved-decisions" className="space-y-3"><h2 id="resolved-decisions" className="text-sm font-semibold">Decision history</h2>{resolvedDecisions.map(decision => { const selected = decision.options.find(option => option.id === decision.selectedOptionId); return <details key={decision.id} className="rounded-lg border border-border p-4"><summary className="cursor-pointer text-sm font-medium break-words focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{decision.question}</summary><p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap break-words">{decision.explanation}</p><p className="mt-3 text-sm">Chosen: <strong>{selected?.label ?? "The selected option is unavailable"}</strong>{decision.resolvedAt && <span className="ml-2 text-xs text-muted-foreground"><time dateTime={decision.resolvedAt}>{new Date(decision.resolvedAt).toLocaleString()}</time></span>}</p><p className="mt-2 text-xs text-muted-foreground break-words">{decision.resolvedBy ? <>Recorded choice by <span className="text-foreground">{decision.resolvedBy.displayName}</span>{decision.resolvedBy.viaToken ? " · via a full-access API credential" : " · signed-in session"}</> : "Decision actor was not recorded for this older choice."}</p><ul className="mt-3 space-y-3">{decision.options.map(option => <li key={option.id} className="text-sm border-t border-border pt-3"><p className="font-medium break-words">{option.label}{option.id === decision.selectedOptionId ? " · Chosen" : ""}</p><p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap break-words">{option.description}</p><p className="mt-2 text-xs font-mono break-words">{option.concreteExample}</p></li>)}</ul></details>; })}</section>}
      <DecisionModal key={pending?.id ?? "no-decision"} decision={pending ?? null} onResolve={resolve} onDismiss={() => setDismissed(pending?.id ?? null)} isResolving={resolving} />
      <EvidenceDrawer
        open={evidenceOpen}
        onOpenChange={setEvidenceOpen}
        activeRequirements={state.acceptedState.activeRequirements}
        evidenceList={Object.values(state.evidence)}
        journal={state.journal}
        candidates={state.candidates}
      />
    </div>
  );
}
