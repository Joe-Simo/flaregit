import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { IntegrationCallback } from "@/server/integration-auth";
import type { ExternalCheckState, ExternalCheckStatus } from "@/core/external-checks";

export interface ExternalCheckDetail { providerId: string; report: Extract<IntegrationCallback["report"], { type: "check" }> }
function safeDetailsUrl(value: string | undefined): string | undefined { if (!value) return; try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; } catch { return; } }
const labels: Record<ExternalCheckStatus, string> = { queued: "Queued", running: "Running", passed: "Passed", failed: "Failed", cancelled: "Cancelled" };
export function ExternalCheckRows({ externalChecks, providerNames, onRetryExternalCheck, reports = [] }: { externalChecks: ExternalCheckState; providerNames?: Record<string, string>; onRetryExternalCheck?: (checkId: string) => Promise<void>; reports?: ExternalCheckDetail[] }) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { frozen, runs, selectedRuns } = externalChecks;
  if (frozen.policy.checks.length === 0) return null;
  return <div className="space-y-2 text-xs">
    <p className="text-muted-foreground">Connected checks · commit <code title={frozen.commit}>{frozen.commit.slice(0, 12)}</code> · policy {frozen.policy.version}</p>
    <ul className="divide-y divide-border">{frozen.policy.checks.map((check) => {
      const runId = selectedRuns[check.id];
      const run = runId ? runs[runId] : undefined;
      const detail = run ? reports.find((item) => item.providerId === check.providerId && item.report.checkId === check.id && item.report.runId === run.id && item.report.sequence === run.sequence && item.report.status === run.status && item.report.candidateId === frozen.candidateId && item.report.commit === frozen.commit && item.report.tree === frozen.tree && item.report.policyVersion === frozen.policy.version)?.report : undefined;
      const detailsUrl = safeDetailsUrl(detail?.detailsUrl);
      return <li key={check.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <div className="min-w-0"><p className="font-medium break-words">{check.id}<span className="ml-2 font-normal text-muted-foreground">{check.required ? "Required" : "Optional"}</span></p><p className="text-muted-foreground break-all">{providerNames?.[check.providerId] ?? check.providerId}{run ? <> · run <code>{run.id}</code></> : " · no selected run"}</p>{detail?.summary && <p className="mt-1 whitespace-pre-line break-words text-muted-foreground max-w-2xl">{detail.summary}</p>}{detailsUrl && <a href={detailsUrl} target="_blank" rel="noopener noreferrer" className="inline-block mt-1 underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`View external details for ${check.id}`}>View check details</a>}</div>
        <div className="flex gap-2 items-center"><Badge variant={run?.status === "passed" ? "success" : run?.status === "failed" || run?.status === "cancelled" ? "destructive" : "secondary"}>{run ? labels[run.status] : "Not dispatched"}</Badge>
          {onRetryExternalCheck && (run?.status === "failed" || run?.status === "cancelled") && <Button size="sm" variant="outline" disabled={retrying !== null} onClick={async () => { setRetrying(check.id); setError(null); setNotice(null); try { await onRetryExternalCheck(check.id); setNotice(`Retry requested for ${check.id}. Waiting for updated run results.`); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not request check retry"); } finally { setRetrying(null); } }}>{retrying === check.id ? "Requesting…" : "Retry check"}</Button>}
        </div>
      </li>;
    })}</ul>
    {notice && <p role="status" className="text-muted-foreground">{notice}</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
