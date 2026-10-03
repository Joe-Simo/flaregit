import { useAuth } from "@clerk/clerk-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { storageReconciliationReport } from "@/server/storage-reconciliation-report";
import { apiJson } from "../api";
import { storageRepositoryId } from "../storage-repository-input";

type Report = Awaited<ReturnType<typeof storageReconciliationReport>>;
const kindLabel = { preview: "Previews", evidence: "Check evidence", "private-recovery": "Git recovery bundles" } as const;
const bytes = (value: number) => value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 ** 2).toFixed(1)} MiB`;

/** Read-only observations remain available while deletion is pending. */
export function StorageReconciliation({ projectId }: { projectId?: string }) {
  const { userId } = useAuth();
  return <StorageReportPanel key={`${userId ?? "signed-out"}:${projectId ?? "account"}`} projectId={projectId} />;
}

function StorageReportPanel({ projectId }: { projectId?: string }) {
  const [repository, setRepository] = useState(projectId ?? "");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadedRepository, setLoadedRepository] = useState<string | null>(null);
  const [plansCursor, setPlansCursor] = useState<string | null>(null);
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; }, []);
  const load = async (next: "refresh" | "objects" | "plans" = "refresh") => {
    const id = storageRepositoryId(repository, window.location.origin);
    if (busy || !id) return;
    const request = ++sequence.current;
    const query = new URLSearchParams();
    if (next !== "refresh" && plansCursor) query.set("plansCursor", plansCursor);
    if (next === "objects" && report?.cursor) query.set("cursor", report.cursor);
    if (next === "plans" && report?.plansNextCursor) query.set("plansCursor", report.plansNextCursor);
    setBusy(true); setError(null);
    try {
      const result = await apiJson<Report>(`/p/${encodeURIComponent(id)}/storage-reconciliation${query.size ? `?${query}` : ""}`);
      if (request !== sequence.current) return;
      setReport(result); setLoadedRepository(id); setPlansCursor(query.get("plansCursor"));
    } catch (failure) {
      if (request === sequence.current) setError(failure instanceof Error ? failure.message : "Storage status is unavailable. Retry when the connection recovers.");
    } finally { if (request === sequence.current) setBusy(false); }
  };
  const unresolved = report?.plans.reduce((sum, plan) => sum + plan.unfinishedCount, 0) ?? 0;
  const present = report?.observations.filter(item => item.status === "present") ?? [];
  const absent = report?.observations.filter(item => item.status === "absent").length ?? 0;
  const unknown = report?.observations.filter(item => item.status === "unknown").length ?? 0;
  return <Card>
    <CardHeader className="pb-2"><CardTitle className="text-base">Storage recovery</CardTitle></CardHeader>
    <CardContent className="space-y-4 min-w-0">
      <p className="text-sm text-muted-foreground">Inspect saved copies and unresolved uploads, including during deletion. This report does not delete data or free reserved capacity.</p>
      {!projectId && <label className="block space-y-2 text-sm">Repository<Input value={repository} disabled={busy} maxLength={2048} placeholder="Repository URL or ID" onChange={event => { sequence.current++; setRepository(event.target.value); setReport(null); setError(null); setLoadedRepository(null); setPlansCursor(null); }} /><span className="block text-xs text-muted-foreground">Paste its FlareGit URL or ID. Only the owner can view this report.</span></label>}
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy || !storageRepositoryId(repository, window.location.origin)} onClick={() => void load()}>{busy ? "Checking…" : report ? "Refresh report" : "Check storage"}</Button></div>
      {error && <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive break-words"><p>{error}</p>{report && <p className="mt-2 text-muted-foreground">The previous report is retained and may be stale. Refresh before relying on its observations.</p>}</div>}
      {busy && <p role="status" className="text-sm text-muted-foreground">Checking a bounded page of storage. Existing observations remain visible.</p>}
      {report && <div className="space-y-4">
        <p role="status" className="text-sm font-medium">{report.complete ? "Requested inventory observed" : "Partial storage report"}{loadedRepository && !projectId ? ` · ${loadedRepository}` : ""}</p>
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <div><dt className="text-muted-foreground">Unresolved uploads on this page</dt><dd className="mt-1 font-medium">{unresolved} recorded operations</dd></div>
          <div><dt className="text-muted-foreground">Objects observed on this page</dt><dd className="mt-1 font-medium">{present.length} present · {bytes(present.reduce((sum, item) => sum + (item.bytes ?? 0), 0))}</dd></div>
          <div><dt className="text-muted-foreground">Missing objects</dt><dd className="mt-1">{absent} observed absent</dd></div>
          <div><dt className="text-muted-foreground">Unknown observations</dt><dd className="mt-1">{unknown} object checks{report.inventory.some(item => item.status === "unknown" || item.status === "incomplete") ? " · inventory checks incomplete" : ""}</dd></div>
        </dl>
        <div className="divide-y divide-border border-y border-border">{report.inventory.map(item => <div key={item.kind} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>{kindLabel[item.kind]}</span><span className="text-muted-foreground">{item.status === "empty" ? "No objects observed" : item.status === "nonempty" ? "Objects remain" : item.status === "incomplete" ? "Inventory incomplete" : "Provider check unavailable"}</span></div>)}</div>
        {(report.legacyInventory || report.legacyEvidence) && <p className="text-sm text-muted-foreground">Older {report.legacyInventory && report.legacyEvidence ? "storage and check evidence" : report.legacyInventory ? "storage" : "check evidence"} may not have complete tracking. Provider reconciliation is still required.</p>}
        <p className="text-xs leading-5 text-muted-foreground">Missing objects do not prove that an upload stopped. Capacity stays reserved until cleanup is confirmed. Retry an existing deletion request to continue its saved work; unresolved uploads or older untracked copies require provider reconciliation. Refresh retries observations only.</p>
        {(report.cursor || report.plansNextCursor) && <div className="flex flex-wrap gap-2">{report.cursor && <Button size="sm" variant="outline" disabled={busy} onClick={() => void load("objects")}>Next object page</Button>}{report.plansNextCursor && !report.cursor && <Button size="sm" variant="outline" disabled={busy} onClick={() => void load("plans")}>Next saved-copy page</Button>}<span className="self-center text-xs text-muted-foreground">Each page replaces the current observations.</span></div>}
      </div>}
    </CardContent>
  </Card>;
}
