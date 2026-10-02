import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiffViewer, type BlobResult, type FileChange } from "../components/DiffViewer";
import { apiJson } from "../api";
import { CandidateReview } from "../components/CandidateReview";
import { Conversation, type Comment } from "../components/Conversation";
import type { CandidateGeneration, FlareGitProjectState } from "@/core/types";
import { navigate } from "../router";

interface DiffResponse { repo: string; base: string | null; head: { hash: string; message: string; author: { name: string } }; files: FileChange[] }

/** Review of one commit (against its parent) or one change (against the commit it started from). */
export function ReviewTab({ projectId, task, commit, candidate, evidence, reload, isOwner = false }: { projectId: string; task?: string; commit?: string; candidate?: CandidateGeneration; evidence?: FlareGitProjectState; reload?: () => void; isOwner?: boolean }) {
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ path: string; line: number } | null>(null);
  const [commented, setCommented] = useState<Set<string>>(new Set());
  const subject = candidate ? `candidate:${candidate.id}` : task ? `change:${task}` : null;
  const onLoaded = useCallback((c: Comment[]) => setCommented(new Set(c.filter((x) => x.path && x.line).map((x) => `${x.path}:${x.line}`))), []);

  useEffect(() => {
    const q = candidate ? `candidate=${encodeURIComponent(candidate.id)}` : task ? `task=${encodeURIComponent(task)}` : `commit=${encodeURIComponent(commit ?? "")}`;
    apiJson<DiffResponse>(`/p/${projectId}/diff?${q}`).then(setDiff).catch((e: Error) => setError(e.message));
  }, [projectId, task, commit, candidate?.id]);

  const loadBlob = useCallback(
    (hash: string) => apiJson<BlobResult>(`/p/${projectId}/blob-by-hash?hash=${hash}${task ? `&task=${encodeURIComponent(task)}` : ""}`),
    [projectId, task]
  );

  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/p/${projectId}/${candidate ? "integration" : task ? "changes" : "commits"}`)}>
        <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
      </Button>
      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {!diff && !error && <p className="text-sm text-muted-foreground">Loading changes…</p>}
      {diff && (
        <>
          <div className="text-sm">
            <span className="font-semibold">{diff.head.message.split("\n")[0]}</span>
            <span className="text-xs text-muted-foreground ml-2">{diff.head.author.name} · <code>{diff.head.hash.slice(0, 7)}</code></span>
          </div>
          {candidate?.status === "awaiting_review" && (
            <CandidateReview projectId={projectId} isOwner={isOwner} candidate={candidate} evidence={candidate.evidenceId ? evidence?.evidence[candidate.evidenceId] : undefined} showOpen={false} onDone={() => { reload?.(); navigate(`/p/${projectId}/integration`); }} />
          )}
          <DiffViewer files={diff.files} loadBlob={loadBlob} commented={commented} onLineClick={subject ? (path, line) => { setAnchor({ path, line }); document.getElementById("review-conversation")?.scrollIntoView({ behavior: "smooth" }); } : undefined} />
          {subject && (
            <div id="review-conversation" className="max-w-3xl pt-2">
              <h3 className="text-sm font-semibold mb-2">Conversation</h3>
              <Conversation projectId={projectId} subject={subject} anchor={anchor} onAnchorUsed={() => setAnchor(null)} onLoaded={onLoaded} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
