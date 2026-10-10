import {preservedCandidateSuccessors} from "./candidate-lineage";
import type { FlareGitProjectState } from "@/core/types";
import type { PipelineStage } from "./components/StatusBanner";

export function summarizeIntegration(state: FlareGitProjectState): { stage: PipelineStage; message: string; detail: string } {
  const tasks = Object.values(state.tasks);
  const preserved=preservedCandidateSuccessors(state.candidates);
  const candidates = Object.values(state.candidates).filter(candidate=>!preserved.has(candidate.id));
  if (Object.values(state.decisions).some((d) => d.status === "pending")) {
    return { stage: "decision_needed", message: "Decision needed", detail:state.acceptedState.currentCommit===null?"Resolve the recorded requirement conflict before the first contribution can be accepted.":"Two requirements contradict each other. The last accepted version stays live until you choose." };
  }
  if (candidates.some((c) => c.status === "awaiting_review")) return { stage: "verifying", message: "Combined preview waiting for your review", detail: "Read the combined preview diff and native and connected checks before merging." };
  if (candidates.some(candidate => candidate.status === "verified" && candidate.review?.approved && !state.journal.some(entry => entry.candidateId === candidate.id && entry.state === "ACCEPTED"))) return { stage: "review_saved", message: "Approved — waiting to merge", detail: "The approval is saved for this exact commit. Open its saved run below to finish merging." };
  const latestCandidate = [...candidates].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (latestCandidate?.status === "failed" && latestCandidate.review?.approved === false) return { stage: "review_saved", message: "Rejection saved", detail: "The rejection is recorded for its exact commit. Check the saved run before retrying delivery; no acceptance is implied." };
  if (candidates.some((c) => c.status === "repairing")) return { stage: "repairing", message: "Repairing", detail: "Workers AI proposes a fix; it is only accepted if your protected checks pass." };
  if (candidates.some((c) => c.status === "verifying") || tasks.some((t) => t.status === "verifying")) {
    return { stage: "verifying", message: "Verifying the exact combined preview", detail: "Your protected checks run against the combined preview commit in an isolated workspace." };
  }
  if (tasks.some((t) => t.status === "integrating")) return { stage: "analyzing", message: "Combining changes", detail:state.acceptedState.currentCommit===null?"Combining the first changes against empty history.":"Combining changes on top of the merged version." };
  const blocked = tasks.find((t) => t.status === "blocked");
  if (blocked) return { stage: "blocked", message: "Blocked", detail: `${blocked.blockedReason ?? "Integration failed"} — the accepted version is unchanged.` };
  if (tasks.some((t) => t.status === "working" || t.status === "checkpointed")) return { stage: "working", message: "Contributors are working", detail: "Changes are being prepared in isolated workspaces." };
  if (latestCandidate?.status === "failed" && !latestCandidate.review) return { stage: "blocked", message: "Integration failed", detail: latestCandidate.failureBlocker ?? "Inspect the saved combined preview and run. The last accepted repository state is preserved." };
  if(state.acceptedState.currentCommit===null)return {stage:"idle",message:"No accepted commit yet",detail:"Push the first contribution in its isolated workspace, verify its combined preview, and review it before merging repository history."};
  return { stage: "accepted", message: "Accepted repository state is preserved", detail: "Prepare independent contributions, verify a combined preview, then choose which commits enter repository history." };
}

