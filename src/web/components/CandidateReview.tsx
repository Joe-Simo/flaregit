import React, { useEffect, useRef, useState } from "react";
import { Check, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiJson } from "../api";
import { useVisiblePolling } from "../use-visible-polling";
import { ExternalCheckRows, type ExternalCheckDetail } from "./ExternalCheckRows";
import { VERIFIER_IDENTITIES } from "@/core/verification-identities";
import { externalCheckGate, type ExternalCheckState } from "@/core/external-checks";
import { blocksExternalAcceptance } from "../review-gate";
import { navigate } from "../router";
import type { CandidateGeneration, Task, VerificationEvidence } from "@/core/types";

/** Requirements and input commits are frozen; legacy task descriptions are current context only. */
export function CandidatePurpose({ projectId, candidate, tasks }: { projectId: string; candidate: CandidateGeneration; tasks?: Record<string, Task> }) {
  return <section aria-label="Contribution purpose" className="space-y-3 text-sm">
    {candidate.frozenRequirements.length > 0 && <div><h3 className="font-semibold">Requirements for this candidate</h3><ul className="mt-2 space-y-1 list-disc pl-5">{candidate.frozenRequirements.map((requirement) => <li key={requirement.id} className="break-words">{requirement.description}</li>)}</ul></div>}
    <div><h3 className="font-semibold">Contributions</h3><p className="mt-1 text-xs text-muted-foreground">Input commits belong to this candidate. Descriptions, contributors, and issue/dependency links reflect the current contributions.</p>
      <ul className="mt-2 divide-y divide-border">{candidate.participatingTaskIds.map((id) => {
        const task = tasks?.[id]; const commit = candidate.participatingCommits[id];
        return <li key={id} className="py-2 space-y-1">
          <a className="font-medium text-primary underline-offset-4 hover:underline break-words" href={`#/p/${projectId}/review?${commit ? `candidate=${encodeURIComponent(candidate.id)}&input=${encodeURIComponent(id)}` : `task=${encodeURIComponent(id)}`}`}>{task?.goal || id}</a>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>{id}</span>{commit && <code title={commit}>{commit.slice(0, 7)}</code>}{task?.contributor && <span>{task.contributor.name} · {task.contributor.type}</span>}{task?.issue && <a className="text-primary hover:underline" href={`#/p/${projectId}/issues?n=${task.issue}`}>Issue #{task.issue}</a>}{task?.dependsOn && <a className="text-primary hover:underline" href={`#/p/${projectId}/review?task=${encodeURIComponent(task.dependsOn)}`}>Builds on {task.dependsOn}</a>}</div>
          {task && commit && task.currentCommit !== commit && <p className="text-xs text-muted-foreground">This contribution has advanced. The link opens its candidate input commit.</p>}
        </li>;
      })}</ul>
    </div>
  </section>;
}

/**
 * The explicit human gate: a verified candidate shows what would land, which checks passed, and asks for
 * Accept or Reject. Nothing becomes repository history without this decision on this exact commit.
 */
export function CandidateReview({ projectId, candidate, evidence, tasks, onDone, showOpen = true, externalChecks, providerNames, onRetryExternalCheck, isOwner = false, reviewReady = true }: { projectId: string; candidate: CandidateGeneration; evidence?: VerificationEvidence; tasks?: Record<string, Task>; onDone: () => void; showOpen?: boolean; externalChecks?: ExternalCheckState; providerNames?: Record<string, string>; onRetryExternalCheck?: (checkId: string) => Promise<void>; isOwner?: boolean; reviewReady?: boolean }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passed = evidence?.testResults.reduce((n, s) => n + s.passedCount, 0) ?? 0;
  const nativeOnly = evidence?.verifierIdentity === VERIFIER_IDENTITIES.external || candidate.frozenExternalChecksPolicy?.mode === "external";
  const total = evidence?.testResults.reduce((n, s) => n + s.passedCount + s.failedCount, 0) ?? 0;

  const scope = `${projectId}:${candidate.id}:${candidate.candidateCommit ?? ""}`;
  const checkScope = `${scope}:${isOwner ? "owner" : "member"}`;
  const decisionGeneration = useRef(0);
  useEffect(() => { decisionGeneration.current++; setBusy(null); setError(null); return () => { decisionGeneration.current++; }; }, [scope, isOwner]);
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
  const acceptanceBlocked = !reviewReady || !candidate.candidateCommit || blocksExternalAcceptance({ required: declaredRequiredChecks, known: checksKnown, readFailed: checkError !== null, identityMismatch: Boolean(identityMismatch), gate: checkGate, retryingRequired });
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
    {(!checksKnown || checkError) && <div className="text-xs text-muted-foreground flex flex-wrap gap-2 items-center"><span role={checkError ? "alert" : "status"}>{checkError ? declaredRequiredChecks ? `Required check state unavailable: ${checkError}. Acceptance is paused; review remains available.` : `Required connected checks: none. Optional reports are unavailable: ${checkError}.` : declaredRequiredChecks ? "Reading required connected check evidence…" : "Required connected checks: none. Reading optional reports…"}</span>{checkError && <Button size="sm" variant="outline" disabled={checking || retryingCheck} onClick={() => void refreshChecks()}>{checking ? "Checking…" : "Retry check status"}</Button>}</div>}
  </>;

  const decide = async (approved: boolean) => {
    if (!isOwner || busy !== null || !candidate.candidateCommit || (approved && acceptanceBlocked)) return;
    const generation = decisionGeneration.current;
    setBusy(approved ? "approve" : "reject");
    setError(null);
    try {
      await apiJson(`/p/${projectId}/candidates/${candidate.id}/review`, { method: "POST", json: { approved, note, expectedCommit: candidate.candidateCommit } });
      if (generation === decisionGeneration.current) onDone();
    } catch (e) {
      if (generation === decisionGeneration.current) setError(e instanceof Error ? e.message : "Could not record the review");
    } finally {
      if (generation === decisionGeneration.current) setBusy(null);
    }
  };

  if (candidate.review?.approved && candidate.status === "verified") {
    return (
      <section aria-label="Publishing" className="rounded-lg border border-border p-4 space-y-2 text-sm">
        <p><span className="font-semibold">Approved by {candidate.review.by}</span> {candidate.review.note ? `(${candidate.review.note})` : ""}: publishing <code>{candidate.candidateCommit?.slice(0, 7)}</code>.</p>
        <p className="text-muted-foreground">If this does not move to Accepted within a minute, the run may not have received the decision. Resending is safe.</p>
        {connectedRows}
        {identityMismatch && <p role="alert" className="text-destructive">Connected check evidence belongs to a different candidate or tree. Reload before accepting.</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <Button size="sm" variant="outline" disabled={!isOwner || busy !== null || acceptanceBlocked} onClick={() => decide(true)}>{busy ? "Resending…" : "Resend approval"}</Button>
      </section>
    );
  }

  return (
    <section aria-label="Review needed" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Waiting for your review</h3>
        <code className="text-xs text-muted-foreground">{candidate.candidateCommit?.slice(0, 7)} on {candidate.expectedAcceptedBase.slice(0, 7)}</code>
      </div>
      <p className="text-sm text-muted-foreground">
        Combines {candidate.participatingTaskIds.join(" and ")}{candidate.compositionMethod ? ` (${candidate.compositionMethod.replace(/_/g, " ")})` : ""}
        {candidate.repairAttempts.length > 0 ? `, with ${candidate.repairAttempts.length} AI repair round${candidate.repairAttempts.length === 1 ? "" : "s"} you should read` : ""}.{" "}
        {nativeOnly ? total > 0 ? `${passed} of ${total} native Git integrity checks passed. Application CI is reported by connected providers below.` : "Read the native Git integrity evidence and connected application CI below." : total > 0 ? `${passed} of ${total} protected checks passed.` : "No check totals were recorded; read the verification evidence."} Accepting moves the branch to exactly this commit.
      </p>
      {showOpen && <CandidatePurpose projectId={projectId} candidate={candidate} tasks={tasks} />}
      {candidate.repairAttempts.length > 0 && <div className="space-y-2">
        <h4 className="text-sm font-medium text-amber-800 dark:text-amber-200">Conflict repairs are part of this candidate</h4>
        {candidate.repairAttempts.map((repair, index) => <details key={`${repair.round}-${index}`} className="rounded-md border border-border bg-background/60 p-3">
          <summary className="cursor-pointer text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Read repair round {repair.round}</summary>
          <p className="mt-3 text-xs text-muted-foreground whitespace-pre-wrap break-words">{repair.diagnosticError || "Repair proposed during integration."}</p>
          {repair.affectedContracts.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Affected requirements: {repair.affectedContracts.join(", ")}</p>}
          <pre className="mt-3 max-h-72 overflow-auto rounded bg-muted/40 p-3 text-xs" aria-label={`Repair patch for round ${repair.round}`}>{repair.patch || "No patch was recorded for this attempt."}</pre>
        </details>)}
      </div>}
      {connectedRows}
      {!reviewReady && <p role="status" className="text-xs text-muted-foreground">Diff files are loading or unavailable. Acceptance from this review is paused; comments and rejection remain available.</p>}
      {checksKnown && !checkError && (identityMismatch || checkGate !== "passed") && <p role="status" className="text-xs text-amber-800 dark:text-amber-200">{identityMismatch ? "Connected check evidence does not match this candidate. Reload before accepting." : checkGate === "failed" ? "A required connected check failed or was cancelled. Acceptance is blocked." : "Waiting for required connected checks before acceptance."}</p>}
      <textarea className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Review note (optional; required context if you reject)" aria-label="Review note" />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {showOpen && <Button size="sm" variant="outline" onClick={() => navigate(`/p/${projectId}/review?candidate=${candidate.id}`)}><Eye className="h-3.5 w-3.5 mr-1.5" /> Read the diff</Button>}
        <Button size="sm" variant="orange" disabled={!isOwner || busy !== null || acceptanceBlocked} onClick={() => decide(true)}><Check className="h-3.5 w-3.5 mr-1.5" /> {busy === "approve" ? "Accepting…" : "Accept into history"}</Button>
        <Button size="sm" variant="outline" disabled={!isOwner || busy !== null || !candidate.candidateCommit} onClick={() => decide(false)}><X className="h-3.5 w-3.5 mr-1.5" /> {busy === "reject" ? "Rejecting…" : "Reject"}</Button>
      </div>
    </section>
  );
}
