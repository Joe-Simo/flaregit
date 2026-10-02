import React, { useState } from "react";
import { Check, Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiJson } from "../api";
import { navigate } from "../router";
import type { CandidateGeneration, VerificationEvidence } from "@/core/types";

/**
 * The explicit human gate: a verified candidate shows what would land, which checks passed, and asks for
 * Accept or Reject. Nothing becomes repository history without this decision on this exact commit.
 */
export function CandidateReview({ projectId, candidate, evidence, onDone, showOpen = true }: { projectId: string; candidate: CandidateGeneration; evidence?: VerificationEvidence; onDone: () => void; showOpen?: boolean }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passed = evidence?.testResults.reduce((n, s) => n + s.passedCount, 0) ?? 0;
  const total = evidence?.testResults.reduce((n, s) => n + s.passedCount + s.failedCount, 0) ?? 0;

  const decide = async (approved: boolean) => {
    setBusy(approved ? "approve" : "reject");
    setError(null);
    try {
      await apiJson(`/p/${projectId}/candidates/${candidate.id}/review`, { method: "POST", json: { approved, note } });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the review");
    } finally {
      setBusy(null);
    }
  };

  if (candidate.review?.approved && candidate.status === "verified") {
    return (
      <section aria-label="Publishing" className="rounded-lg border border-border p-4 space-y-2 text-sm">
        <p><span className="font-semibold">Approved by {candidate.review.by}</span> {candidate.review.note ? `(${candidate.review.note})` : ""}: publishing <code>{candidate.candidateCommit?.slice(0, 7)}</code>.</p>
        <p className="text-muted-foreground">If this does not move to Accepted within a minute, the run may not have received the decision. Resending is safe.</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => decide(true)}>{busy ? "Resending…" : "Resend approval"}</Button>
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
        {total > 0 ? `${passed} of ${total} checks passed.` : "No check totals were recorded; read the verification evidence."} Accepting moves the branch to exactly this commit.
      </p>
      {candidate.repairAttempts.length > 0 && <div className="space-y-2">
        <h4 className="text-sm font-medium text-amber-200">Conflict repairs are part of this candidate</h4>
        {candidate.repairAttempts.map((repair, index) => <details key={`${repair.round}-${index}`} className="rounded-md border border-border bg-background/60 p-3">
          <summary className="cursor-pointer text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Read repair round {repair.round}</summary>
          <p className="mt-3 text-xs text-muted-foreground whitespace-pre-wrap break-words">{repair.diagnosticError || "Repair proposed during integration."}</p>
          {repair.affectedContracts.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Affected requirements: {repair.affectedContracts.join(", ")}</p>}
          <pre className="mt-3 max-h-72 overflow-auto rounded bg-muted/40 p-3 text-xs" aria-label={`Repair patch for round ${repair.round}`}>{repair.patch || "No patch was recorded for this attempt."}</pre>
        </details>)}
      </div>}
      <textarea className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Review note (optional; required context if you reject)" aria-label="Review note" />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {showOpen && <Button size="sm" variant="outline" onClick={() => navigate(`/p/${projectId}/review?candidate=${candidate.id}`)}><Eye className="h-3.5 w-3.5 mr-1.5" /> Read the diff</Button>}
        <Button size="sm" variant="orange" disabled={busy !== null} onClick={() => decide(true)}><Check className="h-3.5 w-3.5 mr-1.5" /> {busy === "approve" ? "Accepting…" : "Accept into history"}</Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => decide(false)}><X className="h-3.5 w-3.5 mr-1.5" /> {busy === "reject" ? "Rejecting…" : "Reject"}</Button>
      </div>
    </section>
  );
}
