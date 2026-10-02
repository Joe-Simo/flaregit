import React, { useMemo, useState } from "react";
import { FileText, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBanner, type PipelineStage } from "../components/StatusBanner";
import { CandidateJournal } from "../components/CandidateJournal";
import { LivePreview } from "../components/LivePreview";
import { DecisionModal } from "../components/DecisionModal";
import { EvidenceDrawer } from "../components/EvidenceDrawer";
import { CandidateReview } from "../components/CandidateReview";
import { apiJson } from "../api";
import type { FlareGitProjectState, ProductDecision } from "@/core/types";

function summarize(state: FlareGitProjectState): { stage: PipelineStage; message: string; detail: string } {
  const tasks = Object.values(state.tasks);
  const candidates = Object.values(state.candidates);
  if (Object.values(state.decisions).some((d) => d.status === "pending")) {
    return { stage: "decision_needed", message: "Decision needed", detail: "Two requirements contradict each other. The last accepted version stays live until you choose." };
  }
  if (candidates.some((c) => c.status === "awaiting_review")) return { stage: "verifying", message: "Verified, waiting for your review", detail: "Checks passed on the exact candidate. Nothing lands until a person accepts it." };
  if (candidates.some((c) => c.status === "repairing")) return { stage: "repairing", message: "Repairing", detail: "Workers AI proposes a fix; it is only accepted if your protected checks pass." };
  if (candidates.some((c) => c.status === "verifying") || tasks.some((t) => t.status === "verifying")) {
    return { stage: "verifying", message: "Verifying the exact candidate", detail: "Your protected checks run against the candidate commit in an isolated workspace." };
  }
  if (tasks.some((t) => t.status === "integrating")) return { stage: "analyzing", message: "Combining changes", detail: "Composing the candidate on top of the accepted version." };
  const blocked = tasks.find((t) => t.status === "blocked");
  if (blocked) return { stage: "blocked", message: "Blocked", detail: `${blocked.blockedReason ?? "Integration failed"} — the accepted version is unchanged.` };
  if (tasks.some((t) => t.status === "working" || t.status === "checkpointed")) return { stage: "working", message: "Contributors are working", detail: "Changes are being prepared in isolated workspaces." };
  return { stage: "accepted", message: "All accepted work is live", detail: "Contributors can start changes at any time; nothing lands unless it passes your checks." };
}

export function IntegrationTab({
  projectId,
  state,
  previewBase,
  reload,
  kind,
}: {
  projectId: string;
  state: FlareGitProjectState;
  previewBase: string;
  reload: () => void;
  kind: string;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => summarize(state), [state]);
  const pending: ProductDecision | undefined = Object.values(state.decisions).find((d) => d.status === "pending" && d.id !== dismissed);

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
    setRunning(act);
    setError(null);
    try {
      await apiJson(`/p/${projectId}/scenarios/run`, { method: "POST", json: { act } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scenario failed");
    } finally {
      setRunning(null);
      reload();
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg overflow-hidden border border-border">
        <StatusBanner stage={summary.stage} message={summary.message} detail={summary.detail} lastAcceptedCommit={state.acceptedState.currentCommit} />
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        {kind === "demo" && (
          <>
            {[["act1", "Text conflict"], ["act2", "Clean merge, broken behavior"], ["act3", "Contradiction"]].map(([act, label]) => (
              <Button key={act} size="sm" variant="outline" disabled={running !== null} onClick={() => runScenario(act!)}>
                <Play className="h-3.5 w-3.5 mr-1.5" /> {running === act ? "Starting…" : label}
              </Button>
            ))}
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => setEvidenceOpen(true)}>
          <FileText className="h-3.5 w-3.5 mr-1.5" /> Audit evidence
        </Button>
      </div>
      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {Object.values(state.candidates)
        .filter((c) => c.status === "awaiting_review" || (c.review?.approved && c.status === "verified" && !state.journal.some((j) => j.candidateId === c.id)))
        .map((c) => <CandidateReview key={c.id} projectId={projectId} candidate={c} evidence={c.evidenceId ? state.evidence[c.evidenceId] : undefined} onDone={reload} />)}
      <div className={`grid gap-4 ${kind === "demo" ? "lg:grid-cols-2" : ""}`}>
        <div className="min-h-[360px]">
          <CandidateJournal candidates={state.candidates} journal={state.journal} />
        </div>
        {kind === "demo" && (
          <div className="min-h-[560px]">
            <LivePreview projectId={projectId} currentCommit={state.acceptedState.currentCommit} />
          </div>
        )}
      </div>
      <DecisionModal decision={pending ?? null} onResolve={resolve} onDismiss={() => setDismissed(pending?.id ?? null)} isResolving={resolving} />
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
