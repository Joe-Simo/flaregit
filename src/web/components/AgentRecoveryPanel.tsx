import React, { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiJson } from "../api";
import { timeAgo } from "../router";
import type { AgentRunRecord } from "@/server/agent-run-ledger";

/** Durable proposals are recoverable work, not evidence of a Git push or accepted history. */
export function AgentRecoveryPanel({ projectId, taskId, runId, canResume = false, onStarted, busy = false }: { projectId: string; taskId: string; runId: string; canResume?: boolean; onStarted?: () => void; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [run, setRun] = useState<AgentRunRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [copied, setCopied] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [resumeRequested, setResumeRequested] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const fileId = useId();
  useEffect(() => {
    if (!open) return;
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError(null);
    void apiJson<{ run: AgentRunRecord | null }>(`/p/${projectId}/tasks/${taskId}/agent-run`, { signal: controller.signal }).then((response) => {
      if (!active) return;
      if (response.run && (response.run.runId !== runId || response.run.taskId !== taskId)) throw new Error("The active agent run changed. Refresh the change before viewing its saved work.");
      setRun(response.run); setLoaded(true);
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not read saved agent work"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [projectId, taskId, runId, open, revision]);
  const files = run?.proposal?.files ?? {};
  const paths = Object.keys(files).sort();
  const path = Object.hasOwn(files, selectedPath) ? selectedPath : paths[0];
  return <details className="mt-3 text-xs" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer rounded w-fit font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Saved agent work</summary>
    {open && <Card className="mt-2 shadow-none"><CardContent className="p-3 space-y-3">
      {resumeRequested && <p role="status" className="text-muted-foreground">Saved-work resume requested. Refresh the change to see the new durable run; this panel describes the previous run.</p>}
      {resumeError && <p role="alert" className="text-destructive">{resumeError}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-muted-foreground break-all">Run <code>{runId}</code></span><Button size="sm" variant="ghost" disabled={loading || resuming} onClick={() => setRevision((value) => value + 1)}>{loading ? "Reading…" : "Refresh saved work"}</Button></div>
      {error && <p role="alert" className="text-destructive">{error}{run ? " Showing the previously loaded run record." : ""}</p>}
      {!loaded && !error && <p role="status" className="text-muted-foreground">Reading durable run data…</p>}
      {loaded && !run && !error && <p className="text-muted-foreground">No durable record was returned for this run. Check again after the run starts.</p>}
      {run && <>
        <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2 text-muted-foreground">
          <div><dt>Saved proposal</dt><dd className="text-foreground mt-0.5">{run.proposal ? `${paths.length} file${paths.length === 1 ? "" : "s"} stored · not a Git checkpoint` : "No proposal recorded"}</dd></div>
          <div><dt>Pushed Git commit</dt><dd className="text-foreground mt-0.5">{run.pushedCommit ? <code className="break-all">{run.pushedCommit}</code> : "No push recorded"}</dd></div>
          <div><dt>Ready checkpoint</dt><dd className="text-foreground mt-0.5">{run.checkpointEventId ? <code className="break-all">{run.checkpointEventId}</code> : "No ready checkpoint recorded"}</dd></div>
          <div><dt>Run record</dt><dd className="text-foreground mt-0.5">{run.phase} · generation {run.generation} · {timeAgo(run.updatedAt)}</dd></div>
        </dl>
        {run.failure && <p className="text-destructive whitespace-pre-wrap break-words">{run.failure}</p>}
        <details><summary className="cursor-pointer w-fit rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Captured purpose and context</summary><div className="mt-2 space-y-2 text-muted-foreground"><p className="whitespace-pre-wrap break-words">{run.goal}</p><p>Started at <code className="break-all">{run.startingCommit}</code></p>{run.context.issue && <p className="whitespace-pre-wrap break-words">Issue #{run.context.issue.number}: {run.context.issue.title}{run.context.issue.summary ? `\n${run.context.issue.summary}` : ""}</p>}{run.context.comments.map((comment) => <p key={comment.id} className="whitespace-pre-wrap break-words">{comment.summary}</p>)}</div></details>
        {run.proposal && path && <div className="space-y-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor={fileId} className="font-medium">Inspect saved proposal</label><code className="text-muted-foreground" title={run.proposal.digest}>Digest {run.proposal.digest.slice(0, 12)}</code></div>
          <select id={fileId} value={path} onChange={(event) => { setSelectedPath(event.target.value); setCopied(false); setCopyError(null); }} className="w-full min-w-0 rounded-md border border-input bg-background px-2 py-2 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{paths.map((file) => <option key={file} value={file}>{file}</option>)}</select>
          <pre aria-label={`Saved content of ${path}`} className="max-h-72 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs leading-5">{files[path]}</pre>
          <Button size="sm" variant="outline" onClick={async () => { setCopyError(null); try { await navigator.clipboard.writeText(files[path] ?? ""); setCopied(true); } catch { setCopyError("Could not copy. Select the saved file content and copy it manually."); } }}><span aria-live="polite">{copied ? "Copied saved file" : "Copy saved file"}</span></Button>
          {copyError && <p role="alert" className="text-destructive">{copyError}</p>}
          {run.phase === "failed" && canResume && <Button size="sm" variant="outline" disabled={busy || loading || resuming || resumeRequested || error !== null} onClick={async () => {
            setResuming(true); setResumeError(null);
            try {
              await apiJson<{ instanceId: string }>(`/p/${projectId}/tasks/${taskId}/agent`, { method: "POST", json: { resumeFrom: run.runId } });
              setResumeRequested(true); onStarted?.();
            } catch (cause) { setResumeError(cause instanceof Error ? cause.message : "Could not resume this saved work"); }
            finally { setResuming(false); }
          }}>{resuming ? "Requesting resume…" : "Resume saved work"}</Button>}
          <p className="text-muted-foreground">{run.phase === "failed" && canResume ? "Explicit resume restores this run’s captured context and frozen files without another model proposal. The server rechecks the purpose, permissions, and branch before applying it; newer contributor work is not overwritten. Manual copying remains available." : "Review these files before continuing with Git. Starting a new agent run does not automatically restore an unpushed proposal."}</p>
        </div>}
      </>}
    </CardContent></Card>}
  </details>;
}
