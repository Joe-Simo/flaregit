import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiffViewer, type BlobResult, type FileChange } from "../components/DiffViewer";
import { apiJson } from "../api";
import { AgentRecoveryPanel } from "../components/AgentRecoveryPanel";
import { CandidateReview } from "../components/CandidateReview";
import { Conversation, type Comment } from "../components/Conversation";
import type { CandidateGeneration, FlareGitProjectState } from "@/core/types";
import { navigate } from "../router";

interface DiffResponse { repo: string; base: string | null; head: { hash: string; message: string; author: { name: string } }; files: FileChange[] }

/** Review of one commit (against its parent) or one change (against the commit it started from). */
export function ReviewTab({ projectId, task, commit, candidate, evidence, reload, isOwner = false }: { projectId: string; task?: string; commit?: string; candidate?: CandidateGeneration; evidence?: FlareGitProjectState; reload?: () => void; isOwner?: boolean }) {
  const taskSnapshot = task ? evidence?.tasks[task] : undefined;
  const reviewScope = JSON.stringify([projectId, task, taskSnapshot?.currentCommit, taskSnapshot?.baseCommit, commit, candidate?.id, candidate?.candidateCommit, candidate?.expectedAcceptedBase]);
  const [readyDiff, setReadyDiff] = useState<{ scope: string; ready: boolean } | null>(null);
  const onDiffReady = useCallback((ready: boolean) => setReadyDiff((previous) => previous?.scope === reviewScope && previous.ready === ready ? previous : { scope: reviewScope, ready }), [reviewScope]);
  const [loadedDiff, setLoadedDiff] = useState<{ scope: string; response: DiffResponse } | null>(null);
  const diff = loadedDiff?.scope === reviewScope ? loadedDiff.response : null;
  const [revision, setRevision] = useState(0);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const error = failure?.scope === reviewScope ? failure.message : null;
  const [anchor, setAnchor] = useState<{ scope: string; subject: string; path: string; line: number; commit: string } | null>(null);
  const [commentState, setCommentState] = useState<{ scope: string; positions: Set<string> } | null>(null);
  const commented = commentState?.scope === reviewScope ? commentState.positions : new Set<string>();
  const subject = candidate ? `candidate:${candidate.id}` : task ? `change:${task}` : null;
  const onLoaded = useCallback((c: Comment[]) => setCommentState({ scope: reviewScope, positions: new Set(c.filter((x) => x.path && x.line && x.commit === diff?.head.hash).map((x) => `${x.path}:${x.line}`)) }), [reviewScope, diff?.head.hash]);

  useEffect(() => {
    let active = true; const controller = new AbortController();
    setLoadedDiff(null); setFailure(null); setCommentState(null);
    const query = candidate ? `candidate=${encodeURIComponent(candidate.id)}` : task ? `task=${encodeURIComponent(task)}` : `commit=${encodeURIComponent(commit ?? "")}`;
    void apiJson<DiffResponse>(`/p/${projectId}/diff?${query}`, { signal: controller.signal }).then((response) => {
      if (!active) return;
      if (candidate && (response.head.hash !== candidate.candidateCommit || response.base !== candidate.expectedAcceptedBase)) throw new Error("The returned diff does not match this candidate commit and base. Refresh the review before accepting.");
      if (taskSnapshot && (response.head.hash !== taskSnapshot.currentCommit || response.base !== taskSnapshot.baseCommit)) throw new Error("The change checkpoint advanced while the diff was loading. Refresh the change before reviewing.");
      setLoadedDiff({ scope: reviewScope, response });
    }).catch((cause: unknown) => { if (active) setFailure({ scope: reviewScope, message: cause instanceof Error ? cause.message : "Could not load the review diff" }); });
    return () => { active = false; controller.abort(); };
  }, [projectId, task, taskSnapshot?.currentCommit, taskSnapshot?.baseCommit, commit, candidate?.id, candidate?.candidateCommit, candidate?.expectedAcceptedBase, reviewScope, revision]);

  const loadBlob = useCallback(
    (hash: string) => apiJson<BlobResult>(`/p/${projectId}/blob-by-hash?hash=${hash}${task ? `&task=${encodeURIComponent(task)}` : ""}`),
    [projectId, task]
  );

  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/p/${projectId}/${candidate ? "integration" : task ? "changes" : "commits"}`)}>
        <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
      </Button>
      {task && evidence?.tasks[task]?.agentRunId && <AgentRecoveryPanel key={`${projectId}:${task}:${evidence.tasks[task]!.agentRunId}`} projectId={projectId} taskId={task} runId={evidence.tasks[task]!.agentRunId!} canResume={["working", "checkpointed", "blocked", "needs_decision"].includes(evidence.tasks[task]!.status)} onStarted={reload} />}
      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}<Button size="sm" variant="outline" className="ml-3" onClick={() => setRevision((value) => value + 1)}>Retry diff</Button></div>}
      {!diff && !error && <p className="text-sm text-muted-foreground">Loading changes…</p>}
      {diff && (
        <>
          <div className="text-sm">
            <span className="font-semibold">{diff.head.message.split("\n")[0]}</span>
            <span className="text-xs text-muted-foreground ml-2">{diff.head.author.name} · <code>{diff.head.hash.slice(0, 7)}</code></span>
          </div>
          {candidate?.status === "awaiting_review" && (
            <CandidateReview projectId={projectId} isOwner={isOwner} candidate={candidate} evidence={candidate.evidenceId ? evidence?.evidence[candidate.evidenceId] : undefined} showOpen={false} reviewReady={readyDiff?.scope === reviewScope && readyDiff.ready} onDone={() => { reload?.(); navigate(`/p/${projectId}/integration`); }} />
          )}
          <DiffViewer key={`${reviewScope}:${diff.head.hash}:${diff.base}`} files={diff.files} loadBlob={loadBlob} onReadyChange={onDiffReady} commented={commented} onLineClick={subject ? (path, line) => { setAnchor({ scope: reviewScope, subject, path, line, commit: diff.head.hash }); document.getElementById("review-conversation")?.scrollIntoView({ behavior: "smooth" }); } : undefined} />
        </>
      )}
      {subject && <div id="review-conversation" className="max-w-3xl pt-2"><h3 className="text-sm font-semibold mb-2">Conversation</h3>{anchor?.subject === subject && anchor.scope !== reviewScope && <p role="status" className="text-xs text-muted-foreground mb-2">The source checkpoint changed. Your draft and line anchor are preserved on the original commit shown below; select a new line to discuss the newer checkpoint.</p>}<Conversation key={`${projectId}:${subject}`} projectId={projectId} subject={subject} anchor={anchor?.subject === subject ? { path: anchor.path, line: anchor.line, commit: anchor.commit } : null} onAnchorUsed={() => setAnchor((current) => current === anchor ? null : current)} onLoaded={onLoaded} /></div>}
    </div>
  );
}
