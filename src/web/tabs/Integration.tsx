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
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "../router";
import type { CandidateGeneration, FlareGitProjectState, ProductDecision } from "@/core/types";

const IN_PROGRESS: Record<string, string> = { composing: "Combining", repairing: "AI repairing conflicts", verifying: "Running checks", verified: "Publishing" };

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
  reload,
  kind,
}: {
  projectId: string;
  state: FlareGitProjectState;
  reload: () => void;
  kind: string;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [scenario, setScenario] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => summarize(state), [state]);
  const describe = (c: CandidateGeneration) => c.participatingTaskIds.map((id) => state.tasks[id]?.goal ?? id).join(" + ");
  const all = Object.values(state.candidates);
  const reviewing = all.filter((c) => c.status === "awaiting_review" || (c.review?.approved && c.status === "verified" && !state.journal.some((j) => j.candidateId === c.id)));
  const running = all.filter((c) => (c.status === "composing" || c.status === "repairing" || c.status === "verifying" || c.status === "verified") && !reviewing.includes(c));
  const landed = all.filter((c) => c.status === "accepted").slice(-10).reverse();
  const failed = all.filter((c) => c.status === "failed" || c.status === "stale").slice(-10).reverse();
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
    setScenario(act);
    setError(null);
    try {
      await apiJson(`/p/${projectId}/scenarios/run`, { method: "POST", json: { act } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scenario failed");
    } finally {
      setScenario(null);
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
              <Button key={act} size="sm" variant="outline" disabled={scenario !== null} onClick={() => runScenario(act!)}>
                <Play className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> {scenario === act ? "Starting…" : label}
              </Button>
            ))}
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => setEvidenceOpen(true)}>
          <FileText className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" /> Audit evidence
        </Button>
      </div>
      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      <section aria-labelledby="int-review" className="space-y-2">
        <h2 id="int-review" className="text-sm font-semibold">Waiting for your review ({reviewing.length})</h2>
        {reviewing.length === 0 ? <p className="text-sm text-muted-foreground">Nothing needs your review.</p> :
          reviewing.map((c) => <CandidateReview key={c.id} projectId={projectId} candidate={c} evidence={c.evidenceId ? state.evidence[c.evidenceId] : undefined} onDone={reload} />)}
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
          {failed.length === 0 ? <p className="text-xs text-muted-foreground">No failures.</p> : (
            <ul className="space-y-2">
              {failed.map((c) => (
                <li key={c.id} className="text-sm min-w-0">
                  <div className="break-words">{describe(c)}</div>
                  <div className="text-xs"><Badge variant={c.status === "stale" ? "outline" : "destructive"}>{c.status === "stale" ? "Outdated" : "Failed"}</Badge> <span className="text-muted-foreground break-words">{c.failureBlocker ?? (c.status === "stale" ? "The accepted version moved on before this finished." : "No reason was recorded.")}</span></div>
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
