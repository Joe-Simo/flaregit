import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiJson } from "../api";
import type { ImportHistoryResult } from "@/server/import-history";

interface Inspection { instanceId: string; head: string; status: string; receipt?: { head: string; inspectedAt: string; result: ImportHistoryResult } | null; detail?: string }
const operationPattern = /^import-history-[a-f0-9-]{36}$/;
const storageKey = (projectId: string) => `flaregit.import-history.${projectId}`;
const readSaved = (projectId: string) => { try { const value = localStorage.getItem(storageKey(projectId)); return value && operationPattern.test(value) ? value : null; } catch { return null; } };

/** Owner-only receipts are independent of imported browsing readiness. */
export function ImportHistoryCard({ projectId }: { projectId: string }) {
  const [instanceId, setInstanceId] = useState<string | null>(() => readSaved(projectId));
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const epoch = useRef(0);
  const identity = useRef(projectId);
  identity.current = projectId;
  const load = useCallback(async (id: string) => {
    const request = ++epoch.current;
    setBusy(true); setError(null);
    try {
      const result = await apiJson<Inspection>(`/p/${projectId}/import-history/${id}`);
      if (request !== epoch.current || identity.current !== projectId) return;
      if (result.instanceId !== id) throw new Error("Inspection identity does not match the saved operation");
      setInspection(result);
    } catch (failure) { if (request === epoch.current && identity.current === projectId) setError(failure instanceof Error ? failure.message : "Inspection status is unavailable"); }
    finally { if (request === epoch.current && identity.current === projectId) setBusy(false); }
  }, [projectId]);
  useEffect(() => {
    const saved = readSaved(projectId);
    setInstanceId(saved); setInspection(null); setError(null); setNotice(null); setBusy(false);
    if (saved) void load(saved);
    return () => { epoch.current++; };
  }, [projectId, load]);
  const requestInspection = async (retryId?: string) => {
    const request = ++epoch.current;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await apiJson<Inspection>(`/p/${projectId}/import-history`, { method: "POST", json: retryId ? { instanceId: retryId } : {} });
      if (request !== epoch.current || identity.current !== projectId) return;
      if (!operationPattern.test(result.instanceId) || (retryId && result.instanceId !== retryId)) throw new Error("The returned inspection identity does not match; refresh status before retrying");
      setInstanceId(result.instanceId); setInspection(result);
      try { localStorage.setItem(storageKey(projectId), result.instanceId); }
      catch { setNotice("Inspection is saved on the server. This browser could not retain its ID for reopening; copy the operation ID below."); }
      if (result.status === "dispatch-unknown") setNotice(result.detail ?? "Inspection is saved; dispatch is uncertain. Check status or retry this same inspection.");
    } catch (failure) {
      if (request === epoch.current && identity.current === projectId) setError(`${failure instanceof Error ? failure.message : "Inspection request failed"}. The request outcome is not confirmed; repository browsing remains available.`);
    } finally { if (request === epoch.current && identity.current === projectId) setBusy(false); }
  };
  const result = inspection?.receipt?.result;
  return <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex flex-wrap items-center gap-2">Import history{result && <Badge variant={result.status === "verified" ? "success" : result.status === "mismatch" ? "destructive" : "warning"}>{result.status === "verified" ? "Selected branch verified" : result.status === "mismatch" ? "History mismatch" : "Unverified"}</Badge>}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm min-w-0">
    <p className="text-muted-foreground">Compare the imported branch’s commit ancestry, tree IDs and parent order with a fresh source capture. Browsing readiness is independent of this inspection.</p>
    <p className="text-xs text-muted-foreground">Source capture currently supports public github.com repositories without redirects. Other source hosts remain unverified. A verified receipt covers only the selected branch’s reachable commit history; it does not prove blob recovery, tags or every repository ref. Inspection is bounded to 1,000 commits.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}{inspection && " Showing the last loaded inspection."}</p>}
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    {instanceId && <div className="space-y-2 text-xs"><p className="break-all">Saved operation <code>{instanceId}</code></p>{inspection && <><p>Workflow: <strong>{inspection.status}</strong></p><p className="break-all">Accepted head at request <code>{inspection.head}</code></p></>}{inspection?.receipt && <p>Inspected {new Date(inspection.receipt.inspectedAt).toLocaleString()}</p>}{result && "receipt" in result && <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1"><dt>Compared commits</dt><dd>{result.receipt.commitsCompared}</dd><dt>Selected refs</dt><dd className="break-all font-mono">{result.receipt.refs.join(", ")}</dd><dt>Source snapshot</dt><dd>{new Date(result.receipt.sourceCapturedAt).toLocaleString()}</dd><dt>Imported snapshot</dt><dd>{new Date(result.receipt.destinationCapturedAt).toLocaleString()}</dd>{result.status === "mismatch" && <><dt>Different refs</dt><dd>{result.receipt.differentRefs.length}</dd><dt>Missing commits</dt><dd>{result.receipt.missingCommits.length}</dd><dt>Different commits</dt><dd>{result.receipt.differentCommits.length}</dd></>}</dl>}{result ? <p className="leading-6">{result.detail}</p> : <p className="text-muted-foreground">No completed receipt has been loaded. Workflow status alone is not evidence that history matches.</p>}</div>}
    <div className="flex flex-wrap gap-2">{!instanceId && <Button size="sm" disabled={busy} onClick={() => void requestInspection()}>{busy ? "Requesting…" : error ? "Recover saved inspection" : "Inspect imported history"}</Button>}{instanceId && <><Button size="sm" variant="outline" disabled={busy} onClick={() => void load(instanceId)}>{busy ? "Checking…" : "Refresh status"}</Button>{(!inspection?.receipt || inspection.status === "handle-unavailable" || inspection.status === "dispatch-unknown") && <Button size="sm" variant="outline" disabled={busy} onClick={() => void requestInspection(instanceId)}>Retry same inspection</Button>}</>}</div>
  </CardContent></Card>;
}
