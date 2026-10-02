import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiffViewer, type BlobResult, type FileChange } from "../components/DiffViewer";
import { apiJson } from "../api";
import { navigate } from "../router";

interface DiffResponse { repo: string; base: string | null; head: { hash: string; message: string; author: { name: string } }; files: FileChange[] }

/** Review of one commit (against its parent) or one change (against the commit it started from). */
export function ReviewTab({ projectId, task, commit }: { projectId: string; task?: string; commit?: string }) {
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = task ? `task=${encodeURIComponent(task)}` : `commit=${encodeURIComponent(commit ?? "")}`;
    apiJson<DiffResponse>(`/p/${projectId}/diff?${q}`).then(setDiff).catch((e: Error) => setError(e.message));
  }, [projectId, task, commit]);

  const loadBlob = useCallback(
    (hash: string) => apiJson<BlobResult>(`/p/${projectId}/blob-by-hash?hash=${hash}${task ? `&task=${encodeURIComponent(task)}` : ""}`),
    [projectId, task]
  );

  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/p/${projectId}/${task ? "changes" : "commits"}`)}>
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
          <DiffViewer files={diff.files} loadBlob={loadBlob} />
        </>
      )}
    </div>
  );
}
