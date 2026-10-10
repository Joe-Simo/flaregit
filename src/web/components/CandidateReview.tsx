import {PreparedPublicationControl} from './PreparedPublicationControl';
import { TechnicalDetails } from "./TechnicalDetails";
import { combinedHow } from "../lib/glossary";
import {CommitSignature} from './CommitSignature';
import {preparedPublicationRequest} from '../prepared-publication-recovery';
import {FrozenAttribution} from './FrozenAttribution';
import {frozenInputAttribution} from '../frozen-contribution-attribution';
import {checkedCandidateReviewTarget,ownerReviewPayload,type CandidateReviewTarget} from "../candidate-review-target";
import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Check, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from "@/components/ui/collapsible";
import { apiJson,apiSessionIdentity } from "../api";
import {readReviewDraft,saveReviewDraft,clearReviewDraft,type ReviewDraftScope,type OwnerDraftIntent} from "../review-draft-recovery";
import { useVisiblePolling } from "../use-visible-polling";
import { ExternalCheckRows, type ExternalCheckDetail } from "./ExternalCheckRows";
import { VERIFIER_IDENTITIES } from "@/core/verification-identities";
import { externalCheckGate, type ExternalCheckState } from "@/core/external-checks";
import { blocksExternalAcceptance } from "../review-gate";
import { navigate, timeAgo } from "../router";
import { abandonLegacyRerun, checkedLegacyInputObservations, legacyRerunDraft, requestLegacyRerun, type LegacyRerunDraft, type LegacyRerunReport } from "../legacy-candidate-rerun";
import type { CandidateGeneration, RepairAttempt, Task, VerificationEvidence,PublicationJournalEntry } from "@/core/types";

const DelegatedCandidateReviews=lazy(async()=>({default:(await import("./DelegatedCandidateReviews")).DelegatedCandidateReviews}));

function validRepairCommit(value:string|undefined):value is string{return Boolean(value&&/^[a-f0-9]{40}$/.test(value)&&!/^0{40}$/.test(value));}
/** The optional controlled state is also used by focused rendered/SSR verification. */
export function CandidateRepairRecord({repair,open}:{repair:RepairAttempt;open?:boolean}){
          const marker=repair.protectedRepair;
          const phase=marker?.status==='requested'?'Requested':marker?.status==='patch_ready'?'Patch recorded':marker?.status==='applied'?validRepairCommit(marker.resultCommit)?'Commit retained':'Result unconfirmed':marker?.status==='unknown'?'Outcome unknown':'Legacy record';
          const stateCopy=marker?.status==='requested'?'Request saved. Model execution is not confirmed.':marker?.status==='patch_ready'?'Patch recorded. Application and checks are not confirmed.':marker?.status==='applied'?validRepairCommit(marker.resultCommit)?'Result commit retained. Verification and acceptance remain separate.':'An applied marker is recorded, but its result commit is unconfirmed.':marker?.status==='unknown'?'Original repair request retained; recovery is pending.':'Execution state was not recorded for this legacy repair.';
          return <Collapsible open={open} className="rounded-md border border-border bg-background/60 p-3">
            <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="h-auto w-full justify-start gap-2 whitespace-normal px-0 text-left"><span>Repair record {repair.round}</span><span className="text-xs font-normal text-muted-foreground">· {phase}</span></Button></CollapsibleTrigger>
            <p className="mt-1 text-xs text-muted-foreground">{stateCopy}</p>
            {marker&&<p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{validRepairCommit(marker.sourceCommit)?<span>Source <code title={marker.sourceCommit}>{marker.sourceCommit.slice(0,7)}</code></span>:<span>Source commit unconfirmed</span>}{validRepairCommit(marker.resultCommit)&&<span>Result <code title={marker.resultCommit}>{marker.resultCommit?.slice(0,7)}</code></span>}</p>}
            <CollapsibleContent className="space-y-2 pt-2">
              {repair.diagnosticError&&<p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{repair.diagnosticError}</p>}
              {repair.affectedContracts.length>0&&<p className="text-xs text-muted-foreground break-words">Affected checks: {repair.affectedContracts.join(', ')}</p>}
              <pre className="max-h-72 overflow-auto rounded bg-muted/40 p-3 text-xs" aria-label={`Recorded repair patch for round ${repair.round}`}>{repair.patch||'No patch was recorded for this repair record.'}</pre>
            </CollapsibleContent>
          </Collapsible>;
}

/** Requirements and input commits are frozen; legacy task descriptions are current context only. */
export function CandidatePurpose({ projectId, candidate, tasks }: { projectId: string; candidate: CandidateGeneration; tasks?: Record<string, Task> }) {
  return <section aria-label="Contribution purpose" className="space-y-3 text-sm">
    {candidate.predecessorCandidateId && <a className="text-primary underline-offset-4 hover:underline" href={`#/p/${projectId}/review?candidate=${encodeURIComponent(candidate.predecessorCandidateId)}`}>Review the earlier attempt</a>}
    {candidate.frozenRequirements.length > 0 && <div><h3 className="font-semibold">Requirements for this combined preview</h3><ul className="mt-2 space-y-1 list-disc pl-5">{candidate.frozenRequirements.map((requirement) => <li key={requirement.id} className="break-words">{requirement.description}</li>)}</ul></div>}
    <div><h3 className="font-semibold">Contributions</h3><p className="mt-1 text-xs text-muted-foreground">Purpose and attribution are captured for these input commits. Older inputs may lack historical attribution.</p>
      <ul className="mt-2 divide-y divide-border">{candidate.participatingTaskIds.map((id) => {
        const task = tasks?.[id]; const commit = candidate.participatingCommits[id],snapshot=frozenInputAttribution(candidate.frozenAttribution,id,commit);
        return <li key={id} className="py-2 space-y-1">
          <a className="font-medium text-primary underline-offset-4 hover:underline break-words" href={`#/p/${projectId}/review?${commit ? `candidate=${encodeURIComponent(candidate.id)}&input=${encodeURIComponent(id)}` : `task=${encodeURIComponent(id)}`}`}>{snapshot?.goal || id}</a>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{id}</span>{commit && <code title={commit}>{commit.slice(0, 7)}</code>}<FrozenAttribution snapshot={snapshot}/>{snapshot?.issue && <a className="text-primary hover:underline" href={`#/p/${projectId}/issues?n=${snapshot.issue}`}>Issue #{snapshot.issue}</a>}{snapshot?.dependsOn && <a className="text-primary hover:underline" href={`#/p/${projectId}/review?task=${encodeURIComponent(snapshot.dependsOn)}`}>Builds on {snapshot.dependsOn}</a>}</div>
          {task && commit && task.currentCommit !== commit && <p className="text-xs text-muted-foreground">This contribution has advanced. The link opens its combined preview input commit.</p>}
        </li>;
      })}</ul>
    </div>
  </section>;
}

/**
 * The explicit human gate: a verified candidate shows what would land, which checks passed, and asks for
 * Accept or Reject. Nothing becomes repository history without this decision on this exact commit.
 */
export function CandidateReview({ projectId, candidate, evidence, tasks,journal, onDone, showOpen = true, externalChecks, providerNames, onRetryExternalCheck, isOwner = false, reviewReady = true, savedDecisionRecoveryInPanel = false, onRecoverSavedRun }: { projectId: string; candidate: CandidateGeneration; evidence?: VerificationEvidence; tasks?: Record<string, Task>;journal?:PublicationJournalEntry[]; onDone: () => void; showOpen?: boolean; externalChecks?: ExternalCheckState; providerNames?: Record<string, string>; onRetryExternalCheck?: (checkId: string) => Promise<void>; isOwner?: boolean; reviewReady?: boolean; savedDecisionRecoveryInPanel?: boolean; onRecoverSavedRun?: () => void }) {
  const [delegatedGate,setDelegatedGate]=useState<{scope:string;passed:boolean|null}|null>(null);
  const [rerunReserved, setRerunReserved] = useState(false);
  const [note, setNote] = useState("");
  const [noteBrowserSaved,setNoteBrowserSaved]=useState(false);
  const noteRecovery=useRef<ReviewDraftScope|null>(null),ownerIntent=useRef<OwnerDraftIntent|null>(null);
  const [recoveredTargetMismatch,setRecoveredTargetMismatch]=useState(false);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passed = evidence?.testResults.reduce((n, s) => n + s.passedCount, 0) ?? 0;
  const nativeOnly = evidence?.verifierIdentity === VERIFIER_IDENTITIES.external || candidate.frozenExternalChecksPolicy?.mode === "external";
  const total = evidence?.testResults.reduce((n, s) => n + s.passedCount + s.failedCount, 0) ?? 0;

  let reviewTarget:CandidateReviewTarget|null=null,targetInvalid=false;try{reviewTarget=checkedCandidateReviewTarget(projectId,candidate.acceptedTarget,candidate.expectedAcceptedBase,candidate.frozenPolicyVersion);}catch{targetInvalid=true;}
  const targetScope=JSON.stringify([reviewTarget?.projectId??null,reviewTarget?.incarnation??null,reviewTarget?.canonicalRepoName??null,reviewTarget?.ref??null,reviewTarget?.acceptedCommit??null,reviewTarget?.acceptedVersion??null,reviewTarget?.policyVersion??null,targetInvalid]);
  const scope = `${projectId}:${candidate.id}:${candidate.candidateCommit ?? ""}:${targetScope}`;
  useEffect(()=>{setNote("");setNoteBrowserSaved(false);setRecoveredTargetMismatch(false);ownerIntent.current=null;const identity=apiSessionIdentity();noteRecovery.current=identity&&candidate.candidateCommit?{identity,projectId,candidateId:candidate.id,commit:candidate.candidateCommit,kind:"owner"}:null;if(!noteRecovery.current)return;try{const recovered=readReviewDraft(sessionStorage,noteRecovery.current);if(recovered){setNote(recovered.note);ownerIntent.current=recovered.intent?.kind==="owner"?recovered.intent:null;setNoteBrowserSaved(true);const expected=reviewTarget?{ref:reviewTarget.ref,acceptedCommit:reviewTarget.acceptedCommit,acceptedVersion:reviewTarget.acceptedVersion}:undefined;if(recovered.intent?.kind==="owner"&&JSON.stringify(recovered.intent.payload.expectedTarget)!==JSON.stringify(expected))setRecoveredTargetMismatch(true);}}catch{/* Browser recovery is optional. */}},[scope,isOwner]);
  const preserveOwnerNote=(value:string,intent:OwnerDraftIntent|null)=>{const savedScope=noteRecovery.current;if(!savedScope||apiSessionIdentity()!==savedScope.identity)return false;try{return saveReviewDraft(sessionStorage,savedScope,{note:value,intent});}catch{return false;}};
  const onDelegatedGate=useCallback((passed:boolean|null)=>setDelegatedGate({scope,passed}),[scope]);
  const delegatedKnown=delegatedGate?.scope===scope&&delegatedGate.passed===true;
  const checkScope = `${scope}:${isOwner ? "owner" : "member"}`;
  const decisionGeneration = useRef(0);
  useEffect(() => { decisionGeneration.current++; setBusy(null); setError(null); setRerunReserved(false); return () => { decisionGeneration.current++; }; }, [scope, isOwner]);
  const [loadedChecks, setLoadedChecks] = useState<{ scope: string; checks: ExternalCheckState | null; reports: ExternalCheckDetail[] } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const requestSequence = useRef(0);
  const retryInFlight = useRef(false);
  const [retryingCheck, setRetryingCheck] = useState(false);
  const [retryingRequired, setRetryingRequired] = useState(false);
  const refresh = useVisiblePolling({
    scope: checkScope,
    intervalMs: 8000,
    maxBackoffMs: 60_000,
    enabled: !retryingCheck,
    read: (signal) => apiJson<{ checks: ExternalCheckState | null; reports: ExternalCheckDetail[] }>(`/p/${projectId}/candidates/${candidate.id}/checks`, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) }),
    onValue: (response) => {
      if (retryInFlight.current) return;
      setLoadedChecks({ scope: checkScope, checks: response.checks, reports: response.reports ?? [] }); setCheckError(null);
    },
    onError: (cause) => { if (!retryInFlight.current) setCheckError(cause instanceof Error ? cause.message : "Could not load connected checks"); },
  });
  const refreshChecks = async () => {
    if (retryInFlight.current) return;
    const generation = decisionGeneration.current;
    setChecking(true);
    try { await refresh(); }
    finally { if (generation === decisionGeneration.current) setChecking(false); }
  };
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    requestSequence.current++;
    setLoadedChecks(null); setCheckError(null); setNames({}); setChecking(false); retryInFlight.current = false; setRetryingCheck(false); setRetryingRequired(false);
    if (isOwner) void apiJson<{ connections: Array<{ id: string; name: string }> }>(`/p/${projectId}/connections`, { signal: controller.signal }).then((response) => { if (active) setNames(Object.fromEntries(response.connections.map((connection) => [connection.id, connection.name]))); }).catch(() => undefined);
    return () => { active = false; controller.abort(); requestSequence.current++; };
  }, [projectId, isOwner, scope]);
  const checksKnown = loadedChecks?.scope === checkScope;
  const checks = checksKnown ? loadedChecks.checks : externalChecks;
  const identityMismatch = checks && (checks.frozen.repositoryId !== projectId || checks.frozen.candidateId !== candidate.id || checks.frozen.commit !== candidate.candidateCommit || (candidate.frozenExternalChecksPolicy && (checks.frozen.policy.version !== candidate.frozenExternalChecksPolicy.version || checks.frozen.policy.mode !== candidate.frozenExternalChecksPolicy.mode)) || (evidence && (checks.frozen.commit !== evidence.candidateCommit || checks.frozen.tree !== evidence.candidateTree)));
  const declaredRequiredChecks = candidate.frozenExternalChecksPolicy?.checks.some((check) => check.required) ?? false;
  const checkGate = checks ? externalCheckGate(checks) : declaredRequiredChecks ? "pending" : "passed";
  const protectedRepairs=candidate.repairAttempts.flatMap(repair=>repair.protectedRepair?[repair.protectedRepair]:[]);
  const repairAcceptancePending=protectedRepairs.length>0&&(protectedRepairs.some(repair=>repair.status!=="applied"||!validRepairCommit(repair.sourceCommit)||!validRepairCommit(repair.resultCommit))||protectedRepairs.at(-1)?.resultCommit!==candidate.candidateCommit);
  const acceptanceBlocked = repairAcceptancePending || targetInvalid || recoveredTargetMismatch || !delegatedKnown || rerunReserved || candidate.preservationProtocolVersion !== 1 || !reviewReady || !candidate.candidateCommit || blocksExternalAcceptance({ required: declaredRequiredChecks, known: checksKnown, readFailed: checkError !== null, identityMismatch: Boolean(identityMismatch), gate: checkGate, retryingRequired });
  const retryCheck = isOwner ? async (checkId: string) => {
    const sequence = ++requestSequence.current;
    retryInFlight.current = true; setRetryingCheck(true); setRetryingRequired(checks?.frozen.policy.checks.find((check) => check.id === checkId)?.required ?? declaredRequiredChecks);
    try {
      if (onRetryExternalCheck) { await onRetryExternalCheck(checkId); if (sequence === requestSequence.current) setLoadedChecks(null); return; }
      const response = await apiJson<{ checks: ExternalCheckState; reports?: ExternalCheckDetail[] }>(`/p/${projectId}/candidates/${candidate.id}/checks`, { method: "POST", json: { checkId } });
      if (sequence === requestSequence.current) { setLoadedChecks({ scope: checkScope, checks: response.checks, reports: response.reports ?? [] }); setCheckError(null); }
    } catch (cause) {
      if (sequence === requestSequence.current) setCheckError(cause instanceof Error ? cause.message : "Check retry was not confirmed; refresh its status");
      throw cause;
    } finally { if (sequence === requestSequence.current) { retryInFlight.current = false; setRetryingCheck(false); setRetryingRequired(false); } }
  } : undefined;
  const connectedRows = <>
    {checks && <ExternalCheckRows key={`${scope}:${checks.frozen.commit}:${checks.frozen.policy.version}`} externalChecks={checks} reports={checksKnown ? loadedChecks.reports : []} providerNames={providerNames ?? (isOwner ? names : {})} onRetryExternalCheck={retryCheck} />}
    {(!checksKnown || checkError) && <div className="text-xs text-muted-foreground flex flex-wrap gap-2 items-center"><span role={checkError ? "alert" : "status"}>{checkError ? declaredRequiredChecks ? `Required check state unavailable: ${checkError}. Acceptance is paused; review remains available.` : `Required connected checks: none. Optional reports are unavailable: ${checkError}.` : declaredRequiredChecks ? "Reading required connected checks…" : "Required connected checks: none. Reading optional reports…"}</span>{checkError && <Button size="sm" variant="outline" disabled={checking || retryingCheck} onClick={() => void refreshChecks()}>{checking ? "Checking…" : "Retry check status"}</Button>}</div>}
  </>;

  const decide = async (approved: boolean, resendSaved = false) => {
    if (!isOwner || targetInvalid || recoveredTargetMismatch || rerunReserved || busy !== null || !candidate.candidateCommit || (approved && acceptanceBlocked)) return;
    if (resendSaved && (!candidate.review || candidate.review.commit !== candidate.candidateCommit || candidate.review.approved !== approved)) return;
    const generation = decisionGeneration.current;
    setBusy(approved ? "approve" : "reject");
    setError(null);
    const payload=ownerReviewPayload(approved,resendSaved?candidate.review?.note??"":note,resendSaved?candidate.review!.commit:candidate.candidateCommit,reviewTarget);
    ownerIntent.current={kind:"owner",payload};setNoteBrowserSaved(preserveOwnerNote(resendSaved?payload.note:note,ownerIntent.current));
    try {
      const receipt = await apiJson<{ recorded: boolean; approved: boolean }>(`/p/${projectId}/candidates/${candidate.id}/review`, { method: "POST", json: payload,signal:AbortSignal.timeout(15000) });
      if (receipt.recorded !== true || receipt.approved !== approved) throw new Error("Review delivery was not confirmed. Reload the recorded decision before retrying.");
      if (generation === decisionGeneration.current) {const savedScope=noteRecovery.current;if(savedScope&&apiSessionIdentity()===savedScope.identity)clearReviewDraft(sessionStorage,savedScope);ownerIntent.current=null;setNoteBrowserSaved(false);setNote("");onDone();}
    } catch (e) {
      if (generation === decisionGeneration.current) setError(e instanceof Error ? e.message : "Could not record the review");
    } finally {
      if (generation === decisionGeneration.current) setBusy(null);
    }
  };

  const repairHold=repairAcceptancePending&&candidate.status!=="accepted"?<p role="status" className="text-xs text-amber-800 dark:text-amber-200">Protected repair checks are incomplete or do not match this commit. Merging is paused; rejection and the diff remain available.</p>:null;
  const targetSummary=targetInvalid||recoveredTargetMismatch?<p role="alert" className="text-xs text-destructive">The branch this preview merges into could not be confirmed. Approving and rejecting are paused; read the diff and refresh before deciding.</p>:reviewTarget?<div className="text-xs text-muted-foreground break-words"><p>Merges into <strong>{reviewTarget.branch}</strong>{reviewTarget.acceptedCommit===null?", which has no commits yet":""}.</p><TechnicalDetails className="mt-1"><p>Built on {reviewTarget.acceptedCommit??"empty history"}</p><p>Branch version {reviewTarget.acceptedVersion}</p></TechnicalDetails></div>:null;

  const policyDisplayContext=candidate.policyAuthorization&&candidate.policyAuthorization.identity.projectId===projectId&&candidate.policyAuthorization.identity.candidateId===candidate.id&&candidate.policyAuthorization.identity.commit===candidate.candidateCommit&&candidate.policyAuthorization.identity.tree===evidence?.candidateTree&&!candidate.review?.approved&&["verified","accepted"].includes(candidate.status);
  const delegatedRows=candidate.candidateCommit?<Suspense fallback={<p role="status" className="text-xs text-muted-foreground">Checking review status…</p>}><DelegatedCandidateReviews key={scope} projectId={projectId} candidateId={candidate.id} commit={candidate.candidateCommit} base={candidate.expectedAcceptedBase} tree={evidence?.candidateTree} verificationPolicyVersion={candidate.frozenPolicyVersion} reviewReady={reviewReady} editable={["awaiting_review","verified"].includes(candidate.status)} acceptanceContext={candidate.status==="accepted"?"accepted":policyDisplayContext?"policy-authorized":"manual"} onGate={onDelegatedGate}/></Suspense>:null;

  if(candidate.policyAuthorization&&candidate.policyAuthorization.identity.projectId===projectId&&candidate.policyAuthorization.identity.candidateId===candidate.id&&candidate.policyAuthorization.identity.commit===candidate.candidateCommit&&candidate.policyAuthorization.identity.tree===evidence?.candidateTree&&!candidate.review?.approved&&["verified","accepted"].includes(candidate.status)){
    return <section aria-label="Maintainer policy authorization" className="rounded-lg border border-border p-4 space-y-2 text-sm">
      <h3 className="font-semibold">{candidate.status==="accepted"?"Accepted under maintainer policy":"Maintainer policy authorization recorded"}</h3>
      <p>Policy version {candidate.policyAuthorization.policyVersion} authorized exactly <code>{candidate.candidateCommit?.slice(0,12)}</code>. This is a policy decision, separate from human review.</p>
      {candidate.status!=="accepted"&&<p className="text-muted-foreground">Repository history changes only after exact publication and readback are confirmed.</p>}
      {targetSummary}{repairHold}{connectedRows}{delegatedRows}
      <CandidatePurpose projectId={projectId} candidate={candidate} tasks={tasks}/>
    </section>;
  }

  const publicationRequest=preparedPublicationRequest(candidate,journal);
  if (candidate.review?.approved && candidate.status === "verified") {
    return (
      <section aria-label="Approved, waiting to merge" className="rounded-lg border border-border p-4 space-y-2 text-sm">
        <p><span className="font-semibold">Approved by {candidate.review.by}</span> {candidate.review.note ? `(${candidate.review.note})` : ""}: approval saved for <code>{candidate.candidateCommit?.slice(0, 7)}</code>.</p>
        <p className="text-muted-foreground">The approval is saved for this exact commit. If its run was interrupted, recover it below. The branch changes only once the merge is confirmed.</p>
        {targetSummary}
        {connectedRows}
        {delegatedRows}
        <LegacyCandidateRerun projectId={projectId} candidate={candidate} isOwner={isOwner} onDone={onDone} onReserved={setRerunReserved} />
        {identityMismatch && <p role="alert" className="text-destructive">Connected checks belong to a different combined preview or tree. Reload before merging.</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {publicationRequest?<PreparedPublicationControl key={`${candidate.id}:${publicationRequest.journalId}`} projectId={projectId} candidateId={candidate.id} request={publicationRequest} isOwner={isOwner} blocked={acceptanceBlocked} onChange={onDone}/>:savedDecisionRecoveryInPanel ? <a href="#int-saved-runs" className="text-xs underline underline-offset-4" onClick={event => { event.preventDefault(); if (onRecoverSavedRun) { onRecoverSavedRun(); return; } const panel = document.getElementById("int-saved-runs"); panel?.scrollIntoView({ block: "start" }); panel?.focus({ preventScroll: true }); }}>Recover this saved run</a> : <Button size="sm" variant="outline" disabled={!isOwner || busy !== null || acceptanceBlocked} onClick={() => decide(true, true)}>{busy ? "Resending…" : "Resend saved approval"}</Button>}
      </section>
    );
  }

  return (
    <section aria-label="Review needed" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Waiting for your review</h3>
        <code className="text-xs text-muted-foreground" title={candidate.candidateCommit}>{candidate.candidateCommit?.slice(0, 7)}</code>
      </div>
      {targetSummary}
      {showOpen&&candidate.candidateCommit&&<CommitSignature projectId={projectId} commit={candidate.candidateCommit} candidate={candidate.id}/>}
      <p className="text-sm text-muted-foreground">
        Combines {candidate.participatingTaskIds.map(id => `“${tasks?.[id]?.goal ?? "a saved change"}”`).join(" and ")}{candidate.compositionMethod ? `. ${combinedHow[candidate.compositionMethod]}` : ""}
        {candidate.repairAttempts.length > 0 ? `, with ${candidate.repairAttempts.length} repair record${candidate.repairAttempts.length === 1 ? "" : "s"} to review` : ""}.{" "}
        {nativeOnly ? total > 0 ? `${passed} of ${total} native Git integrity checks passed. Application CI is reported by connected providers below.` : "Read the native Git integrity checks and connected application CI below." : total > 0 ? `${passed} of ${total} protected checks passed.` : "No check totals were recorded; read the verification checks."} Accepting moves the branch to exactly this commit.
      </p>
      {showOpen && <CandidatePurpose projectId={projectId} candidate={candidate} tasks={tasks} />}
      {candidate.repairAttempts.length > 0 && <section aria-label="Repair records" className="space-y-2">
        <h4 className="text-sm font-medium">Repair records</h4>
        {candidate.repairAttempts.map((repair,index)=><CandidateRepairRecord key={`${repair.round}-${index}`} repair={repair}/>)}
      </section>}
      {repairHold}
      {connectedRows}
      {delegatedRows}
      <LegacyCandidateRerun projectId={projectId} candidate={candidate} isOwner={isOwner} onDone={onDone} onReserved={setRerunReserved} />
      {candidate.preservationProtocolVersion !== 1 && <p role="status" className="text-xs text-muted-foreground">This older combined preview cannot be merged. Its review stays available; rebuild it as a new attempt when eligible.</p>}
      {!reviewReady && <p role="status" className="text-xs text-muted-foreground">Diff files are loading or unavailable. Acceptance from this review is paused; comments and rejection remain available.</p>}
      {checksKnown && !checkError && (identityMismatch || checkGate !== "passed") && <p role="status" className="text-xs text-amber-800 dark:text-amber-200">{identityMismatch ? "Connected checks do not match this combined preview. Reload before merging." : checkGate === "failed" ? "A required connected check failed or was cancelled. Acceptance is blocked." : "Waiting for required connected checks before acceptance."}</p>}
      <Textarea rows={2} maxLength={500} value={note} onChange={(e) => {setNote(e.target.value);const unchanged=ownerIntent.current?.payload.note===e.target.value?ownerIntent.current:null;ownerIntent.current=unchanged;setNoteBrowserSaved(preserveOwnerNote(e.target.value,unchanged));}} placeholder="Review note (optional; required context if you reject)" aria-label="Review note" />
      {note.length>0&&<p role="status" className="text-xs text-muted-foreground">{noteBrowserSaved?"Review draft saved in this browser session.":"Browser-session draft save is unavailable. Keep this tab open until the review is confirmed."}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {showOpen && <Button size="sm" variant="outline" onClick={() => navigate(`/p/${projectId}/review?candidate=${candidate.id}`)}><Eye className="h-3.5 w-3.5 mr-1.5" /> Read the diff</Button>}
        <Button size="sm" variant="orange" disabled={!isOwner || busy !== null || acceptanceBlocked} onClick={() => decide(true)}><Check className="h-3.5 w-3.5 mr-1.5" /> {busy === "approve" ? "Saving approval…" : "Approve commit"}</Button>
        <Button size="sm" variant="outline" disabled={!isOwner || targetInvalid || recoveredTargetMismatch || rerunReserved || busy !== null || !candidate.candidateCommit} onClick={() => decide(false)}><X className="h-3.5 w-3.5 mr-1.5" /> {busy === "reject" ? "Rejecting…" : "Reject"}</Button>
      </div>
    </section>
  );
}

/** Whether the change branches moved since the preview was built, in one sentence. The rebuild always uses the saved versions. */
function branchesSummary(observations: LegacyRerunReport["inputObservations"]): string {
  if (!observations || observations.status === "unavailable" || observations.rows.length === 0) return "Could not check whether the change branches moved since then. The rebuild uses the saved versions either way.";
  const moved = observations.rows.filter(row => row.observedCommit !== row.expectedCommit).length;
  return moved === 0 ? "The change branches still match the saved versions." : `${moved} change ${moved === 1 ? "branch has" : "branches have"} new commits since then. The rebuild still uses the saved versions; combine again to include the new work.`;
}

/** A rebuild creates a new attempt; the original review stays intact and the new attempt needs its own approval. */
export function LegacyCandidateRerun({ projectId, candidate, isOwner, onDone, onReserved }: { projectId: string; candidate: CandidateGeneration; isOwner: boolean; onDone: () => void; onReserved?: (reserved: boolean) => void }) {
  const scope = `${projectId}:${candidate.id}:${candidate.candidateCommit ?? ""}:${isOwner}`;
  const [loaded, setLoaded] = useState<{ scope: string; report: LegacyRerunReport } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [abandonConfirmed, setAbandonConfirmed] = useState(false);
  const draft = useRef<LegacyRerunDraft | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setLoaded(null); setFailure(null); setBusy(false); setAbandonConfirmed(false);
    if (isOwner && candidate.status !== "accepted" && (candidate.preservationProtocolVersion !== 1 || ["composing", "repairing", "verifying", "failed", "stale"].includes(candidate.status))) void apiJson<LegacyRerunReport>(`/p/${projectId}/candidates/${candidate.id}/rerun`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }).then(report => {
      if (current !== generation.current) return;
      if (report.candidateId !== candidate.id || report.expectedCommit !== (candidate.candidateCommit ?? null)) throw new Error("Combined preview changed. Refresh before requesting a rerun.");
      checkedLegacyInputObservations(report);
      draft.current = legacyRerunDraft(draft.current, projectId, report);
      setLoaded({ scope, report }); onReserved?.(Boolean(report.operation));
    }).catch(cause => { if (current === generation.current && !controller.signal.aborted) setFailure(cause instanceof Error ? cause.message : "Rerun availability is unknown."); });
    return () => { generation.current++; controller.abort(); };
  }, [scope, revision, projectId, candidate.id, candidate.candidateCommit, candidate.preservationProtocolVersion, candidate.status, isOwner]);
  if (!isOwner || candidate.status === "accepted" || (candidate.preservationProtocolVersion === 1 && !["composing", "repairing", "verifying", "failed", "stale"].includes(candidate.status) && !loaded?.report.operation)) return null;
  const report = loaded?.scope === scope ? loaded.report : null;
  const rerun = async () => {
    if (busy || !report || !draft.current || (!report.eligible && (!report.operation || report.operation.phase === "abandoned")) || (report.operation?.phase === "attached" || report.operation?.phase === "awaiting_decision")) return;
    const current = generation.current;
    setBusy(true); setFailure(null);
    try {
      const operation = await requestLegacyRerun(projectId, candidate.id, draft.current);
      if (current !== generation.current) return;
      setLoaded({ scope, report: { ...report, operation } }); onReserved?.(true);
      onDone(); setRevision(value => value + 1);
    } catch (cause) {
      if (current === generation.current) setFailure(`${cause instanceof Error ? cause.message : "Request was not confirmed."} Refresh status or retry the same saved request.`);
    } finally { if (current === generation.current) setBusy(false); }
  };
  const canAbandon = report?.operation?.dispatch === "not_started" && report.operation.phase !== "attached" && report.operation.phase !== "abandoned" && report.operation.phase !== "awaiting_decision";
  const abandon = async () => {
    if (busy || !canAbandon || !abandonConfirmed || !report?.operation) return;
    const current = generation.current;
    setBusy(true); setFailure(null);
    try {
      const result = await abandonLegacyRerun(projectId, candidate.id, report.operation.id);
      if (current !== generation.current) return;
      if (result.id !== report.operation.id || result.phase !== "abandoned") throw new Error("Abandonment was not confirmed.");
      draft.current = null;
      onDone(); setRevision(value => value + 1);
    } catch (cause) {
      if (current === generation.current) setFailure(`${cause instanceof Error ? cause.message : "Abandonment was not confirmed."} Refresh status before continuing.`);
    } finally { if (current === generation.current) setBusy(false); }
  };
  return <section aria-label="Rebuild combined preview" className="space-y-2 border-t border-border pt-3 text-sm">
    <h3 className="font-medium">Rebuild combined preview</h3>
    <p className="text-xs text-muted-foreground">Runs the same saved changes again as a new attempt with new checks. This attempt and its review are kept; the new attempt needs its own approval.</p>
    <p role="status" className="text-xs text-muted-foreground">{report?.detail ?? "Checking saved inputs and rerun availability…"}</p>
    {report && <p className="text-xs text-muted-foreground">Uses {Object.keys(report.inputs).length} saved {Object.keys(report.inputs).length === 1 ? "change" : "changes"}, exactly as they were when this preview was built.</p>}
    {report && <p role="status" className="text-xs text-muted-foreground">{branchesSummary(report.inputObservations)}</p>}
    {report && <TechnicalDetails>
      <p>{report.expectedCommit ? `Original preview commit ${report.expectedCommit}` : "No preview commit was recorded"}</p>
      {Object.entries(report.inputs).map(([id, input]) => <p key={id}>Change {id}: {input.base} → {input.commit}</p>)}
      {report.inputObservations && <p>Branches checked {timeAgo(report.inputObservations.checkedAt)}{report.inputObservations.status === "unavailable" ? " (incomplete)" : ""}</p>}
      {report.inputObservations?.rows.map(row => <div key={row.taskId} className="space-y-0.5 border-t border-border pt-1">
        <p>Change {row.taskId} · {row.ref}</p>
        <p>Saved commit {row.expectedCommit}</p>
        <p>Current branch tip {row.observedCommit ?? (row.status === "unavailable" ? "could not be read" : "none")}</p>
        <p>Saved commit stored {row.expectedObjectAvailable === null ? "not confirmed" : row.expectedObjectAvailable ? "yes" : "no"}</p>
        {row.namedBranchObservedCommit !== null && row.namedBranchObservedCommit !== row.observedCommit && <p>Lookup by branch name returned a different commit, {row.namedBranchObservedCommit}; the exact branch read above is the one used.</p>}
      </div>)}
    </TechnicalDetails>}
    {report?.operation && <p className="text-xs text-muted-foreground">{report.operation.phase === "awaiting_decision" ? "A product decision needs your choice before the new attempt can continue." : report.operation.phase === "abandoned" ? "Saved rerun abandoned. Contributions need normal Ready checks before another attempt." : report.operation.phase === "prepared" ? "Request saved. Replacement is held until the original run and workspace are confirmed stopped." : report.operation.phase === "attached" ? "New attempt created." : "The rebuild is running; the new attempt will need its own approval."}</p>}
    {failure && <p role="alert" className="text-xs text-destructive">{failure}</p>}
    <div className="flex flex-wrap gap-2">
      {report?.operation?.phase === "awaiting_decision" ? <Button size="sm" variant="outline" onClick={() => navigate(`/p/${projectId}/integration`)}>Resolve product decision</Button> : report?.operation?.successorCandidateId ? <Button size="sm" variant="outline" onClick={() => navigate(`/p/${projectId}/review?candidate=${report.operation!.successorCandidateId}`)}>Review the new attempt</Button> : <Button size="sm" variant="outline" disabled={busy || !report || (!report.eligible && (!report.operation || report.operation.phase === "abandoned")) || report.operation?.phase === "attached"} onClick={() => void rerun()}>{busy ? "Requesting…" : report?.operation && report.operation.phase !== "abandoned" ? "Continue saved rerun" : "Rebuild as a new attempt"}</Button>}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh status</Button>
    </div>
    {canAbandon && <div className="space-y-2">
      <label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={abandonConfirmed} disabled={busy} onChange={event => setAbandonConfirmed(event.target.checked)} className="mt-0.5" /> <span>Stop the old run and release this saved rerun. Its review and context remain. Unchanged contributions return to checkpointed and require normal Ready checks; newer work stays intact.</span></label>
      <Button size="sm" variant="outline" disabled={busy || !abandonConfirmed} onClick={() => void abandon()}>Abandon saved rerun</Button>
    </div>}
    {report?.operation && (report.operation.dispatch === "unknown" || report.operation.dispatch === "observed") && <p className="text-xs text-muted-foreground">The new attempt may already have started. Abandoning is unavailable until its state is confirmed.</p>}
  </section>;
}
