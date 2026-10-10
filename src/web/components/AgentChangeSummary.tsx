import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiJsonWithRetry } from "../api";
import type { AgentRunRecord } from "@/server/agent-run-ledger";
import type { AgentRoundRecord } from "@/server/agent-loop";

function roundHeadline(round: AgentRoundRecord): string {
  if (round.edits === "rejected") return "Edits could not be applied";
  if (round.edits === "none") return "No changes proposed";
  if (round.tests.status === "not-run") return "Tests not run";
  const counts = round.tests.passed !== null || round.tests.failed !== null ? ` · ${round.tests.passed ?? 0} passed, ${round.tests.failed ?? 0} failed` : "";
  return `${round.tests.status === "passed" ? "Tests passed" : "Tests failed"}${counts}`;
}

/** Plain-language account of what the coding agent did on this change, round by round. */
export function AgentChangeSummary({ projectId, taskId, runId, revision }: { projectId: string; taskId: string; runId: string; revision: string }) {
  const [run, setRun] = useState<AgentRunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true); setError(null);
    void apiJsonWithRetry<{ run: AgentRunRecord | null }>(`/p/${projectId}/tasks/${taskId}/agent-run`, controller.signal)
      .then((response) => { if (active) setRun(response.run && response.run.runId === runId && response.run.taskId === taskId ? response.run : null); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load the agent's summary"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [projectId, taskId, runId, revision, refresh]);
  const explanation = run?.explanation;
  if (!explanation && !error) return null;
  return <Card className="mt-3 shadow-none" aria-label="What the agent did">
    <CardContent className="p-3 space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">What the agent did</h4>
        <Button size="sm" variant="ghost" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>{loading ? "Loading…" : "Refresh"}</Button>
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {explanation && <>
        <div><p className="text-muted-foreground">Goal</p><p className="mt-0.5 whitespace-pre-wrap break-words">{explanation.goal}</p></div>
        {explanation.plan.length > 0 && <div><p className="text-muted-foreground">Plan</p><ul className="mt-0.5 list-disc pl-5 space-y-0.5">{explanation.plan.map((item, index) => <li key={index} className="break-words">{item}</li>)}</ul></div>}
        {explanation.reasoning && <div><p className="text-muted-foreground">Why this approach</p><p className="mt-0.5 whitespace-pre-wrap break-words">{explanation.reasoning}</p></div>}
        <div><p className="text-muted-foreground">Files changed</p>{explanation.filesTouched.length ? <ul className="mt-0.5 space-y-0.5">{explanation.filesTouched.map((file) => <li key={file}><code className="break-all">{file}</code></li>)}</ul> : <p className="mt-0.5">None yet</p>}</div>
        <div>
          <p className="text-muted-foreground">Attempts ({explanation.rounds.length} of up to {explanation.maxRounds})</p>
          <ol className="mt-1 space-y-2">{explanation.rounds.map((round) => <li key={round.round} className="rounded-md border border-border p-2">
            <p className={round.tests.status === "passed" ? "font-medium text-emerald-500" : round.tests.status === "failed" || round.edits === "rejected" ? "font-medium text-amber-500" : "font-medium"}>Attempt {round.round}: {roundHeadline(round)}</p>
            {round.filesChanged.length > 0 && <p className="mt-0.5 text-muted-foreground break-words">Changed {round.filesChanged.join(", ")}</p>}
            {round.tests.status !== "passed" && round.tests.summary && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-mono text-[11px] leading-4">{round.tests.summary}</pre>}
          </li>)}</ol>
        </div>
        <p role="status" className="text-muted-foreground">{explanation.note}</p>
      </>}
    </CardContent>
  </Card>;
}
