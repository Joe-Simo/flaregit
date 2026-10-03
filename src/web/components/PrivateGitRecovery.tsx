import { useAuth } from "@clerk/clerk-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiFetch, apiJson } from "../api";

interface Snapshot { id: string; commit: string; tree: string | null; cacheState?: "deleting" | "deleted"; canRetry?: boolean; status: "pending" | "ready" | "failed"; createdAt: string; error?: string; size?: number }
interface Target { journalId: string; commit: string; tree: string | null; acceptedAt: string }
interface RecoveryInfo { snapshots: Snapshot[]; target: { commit: string; tree: string | null } | null; targets?: Target[] }
interface Preparation { commit: string; expectedTree: string | null; idempotencyKey: string }
const BROWSER_DOWNLOAD_LIMIT = 16 * 1024 * 1024;
const browserDownloadable = (snapshot: Snapshot) => snapshot.size !== undefined && Number.isSafeInteger(snapshot.size) && snapshot.size > 0 && snapshot.size <= BROWSER_DOWNLOAD_LIMIT;
const errorText = (error: unknown) => error instanceof Error ? error.message : "Recovery request failed";

export function PrivateGitRecovery({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const { userId } = useAuth();
  return <RecoveryPanel key={`${projectId}:${userId ?? "signed-out"}:${isOwner}`} projectId={projectId} isOwner={isOwner} />;
}

function RecoveryPanel({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const [info, setInfo] = useState<RecoveryInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [search, setSearch] = useState("");
  const [removing, setRemoving] = useState<Snapshot | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [draft, setDraft] = useState<Preparation | null>(null);
  const selectedTarget = info?.targets?.find(target => target.commit === selectedCommit) ?? info?.target;
  const activeSnapshot = (commit: string) => info?.snapshots.find(snapshot => snapshot.commit === commit && !snapshot.cacheState && (snapshot.status === "ready" || snapshot.status === "pending"));
  const selectedActiveSnapshot = selectedTarget ? activeSnapshot(selectedTarget.commit) : undefined;
  const matchingTargets = (info?.targets ?? []).filter(target => target.commit.includes(search.trim().toLowerCase()));
  const context = `${projectId}:${isOwner ? "owner" : "member"}`;
  const identity = useRef(context);
  identity.current = context;
  const epoch = useRef(0);
  const load = useCallback(async () => {
    const request = ++epoch.current;
    setBusy("load");
    try {
      const result = await apiJson<RecoveryInfo>(`/p/${encodeURIComponent(projectId)}/recovery`);
      if (identity.current !== context || request !== epoch.current) return;
      setInfo(result); setError(null);
    } catch (failure) {
      if (identity.current === context && request === epoch.current) setError(errorText(failure));
    } finally {
      if (identity.current === context && request === epoch.current) setBusy(null);
    }
  }, [projectId, context]);
  useEffect(() => {
    setInfo(null); setDraft(null); setError(null); setNotice(null);
    void load();
    return () => { epoch.current++; };
  }, [load]);

  const prepare = async (snapshot?: Snapshot) => {
    if (!isOwner || busy || snapshot?.cacheState === "deleting" || (!snapshot && !draft && !selectedTarget) || (!draft && (snapshot ? activeSnapshot(snapshot.commit) !== undefined && !(snapshot.status === "pending" && snapshot.canRetry === true && activeSnapshot(snapshot.commit)?.id === snapshot.id) : selectedActiveSnapshot !== undefined))) return;
    const preparation = draft ?? (snapshot ? { commit: snapshot.commit, expectedTree: snapshot.tree, idempotencyKey: snapshot.cacheState === "deleted" || snapshot.canRetry !== true ? crypto.randomUUID() : snapshot.id } : { commit: selectedTarget!.commit, expectedTree: selectedTarget!.tree, idempotencyKey: crypto.randomUUID() });
    setDraft(preparation); setBusy("prepare"); setError(null); setNotice(null);
    const request = ++epoch.current;
    try {
      await apiJson(`/p/${encodeURIComponent(projectId)}/recovery`, { method: "POST", json: preparation });
      if (identity.current !== context || request !== epoch.current) return;
      setDraft(null); setNotice("Preparation requested. Refresh status to check whether the bundle is ready.");
      await load();
    } catch (failure) {
      if (identity.current === context && request === epoch.current) setError(`${errorText(failure)}. The request outcome is unconfirmed. Retry uses the same commit and request identity.`);
    } finally {
      if (identity.current === context && request === epoch.current) setBusy(null);
    }
  };
  const download = async (snapshot: Snapshot) => {
    if (busy || snapshot.status !== "ready" || snapshot.cacheState || !browserDownloadable(snapshot)) return;
    const request = ++epoch.current;
    setBusy(snapshot.id); setError(null); setNotice(null);
    try {
      const response = await apiFetch(`/api/p/${encodeURIComponent(projectId)}/recovery/${encodeURIComponent(snapshot.id)}/bundle`);
      if (!response.ok) throw new Error(await response.text() || `Download failed (${response.status})`);
      if (!response.body) throw new Error("Download body is unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > BROWSER_DOWNLOAD_LIMIT || bytes > snapshot.size! || identity.current !== context || request !== epoch.current) throw new Error("Download exceeded its recorded size or the account context changed");
          chunks.push(new Uint8Array(chunk.value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (bytes !== snapshot.size) throw new Error("Download size does not match its recovery receipt");
      const blob = new Blob(chunks, { type: "application/octet-stream" });
      if (identity.current !== context || request !== epoch.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `flaregit-${projectId}-${snapshot.commit}.bundle`;
      try {
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setNotice(`Download started for commit ${snapshot.commit}.`);
    } catch (failure) {
      if (identity.current === context && request === epoch.current) setError(errorText(failure));
    } finally {
      if (identity.current === context && request === epoch.current) setBusy(null);
    }
  };

  const removeCache = async () => {
    if (!isOwner || busy || !removing || confirmation !== `DELETE CACHED BUNDLE ${removing.id}`) return;
    const snapshot = removing;
    const request = ++epoch.current;
    setBusy("remove"); setError(null); setNotice(null);
    try {
      const result = await apiJson<{ detail: string }>(`/p/${encodeURIComponent(projectId)}/recovery/${encodeURIComponent(snapshot.id)}`, { method: "DELETE", json: { confirmation } });
      if (identity.current !== context || request !== epoch.current) return;
      setRemoving(null); setConfirmation(""); setNotice(result.detail);
      await load();
    } catch (failure) {
      if (identity.current === context && request === epoch.current) setError(`${errorText(failure)}. Removal is unconfirmed; retry the same cached bundle removal.`);
    } finally {
      if (identity.current === context && request === epoch.current) setBusy(null);
    }
  };

  return <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Private Git recovery</CardTitle></CardHeader><CardContent className="min-w-0 space-y-3 text-sm">
    <p className="text-muted-foreground">Download a prepared Git bundle to recover its recorded commit locally. Preparing a bundle uses repository compute and retained storage capacity; only the owner can request it. Limits: 2 cached bundles per account, 8 globally, and 512 MiB per bundle.</p>
    {error && <p role="alert" className="break-words text-destructive">{error}{info && " Showing the last loaded recovery status."}</p>}
    {notice && <p role="status" className="break-all text-muted-foreground">{notice}</p>}
    {!info && !error && <p role="status" className="text-muted-foreground">Loading recovery status…</p>}
    {selectedTarget && <p className="break-all text-xs text-muted-foreground">Preparation target <code>{selectedTarget.commit}</code><br />{selectedTarget.tree ? <>Tree <code>{selectedTarget.tree}</code></> : "Tree will be verified during preparation"}</p>}
    {draft && <p className="break-all text-xs text-muted-foreground">Unconfirmed preparation for <code>{draft.commit}</code>. Retry preserves this request.</p>}
    <div className="flex flex-wrap gap-2">
      {isOwner && <Button size="sm" disabled={busy !== null || (!selectedTarget && !draft) || (!draft && selectedActiveSnapshot !== undefined)} onClick={() => void prepare()}>{busy === "prepare" ? "Requesting…" : draft ? "Retry same preparation" : selectedActiveSnapshot?.status === "ready" ? "Bundle already ready" : selectedActiveSnapshot?.status === "pending" ? "Bundle preparing" : "Prepare Git bundle"}</Button>}
      {isOwner && (info?.targets?.length ?? 0) > 1 && <Button size="sm" variant="outline" disabled={busy !== null || draft !== null} onClick={() => { setChoosing(true); setSearch(""); }}>Choose accepted commit</Button>}
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void load()}>{busy === "load" ? "Checking…" : "Refresh status"}</Button>
    </div>
    {info && info.snapshots.length === 0 && <p className="text-muted-foreground">No recovery bundles have been prepared.</p>}
    {info && !info.target && isOwner && <p className="text-muted-foreground">No commit is currently available to prepare.</p>}
    {info && info.snapshots.length > 0 && <ul className="divide-y divide-border">{info.snapshots.map(snapshot => <li key={snapshot.id} className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2"><Badge variant={snapshot.status === "ready" ? "success" : snapshot.status === "failed" ? "destructive" : "secondary"}>{snapshot.cacheState === "deleted" ? "Cache removed" : snapshot.cacheState === "deleting" ? "Removing cache" : snapshot.status === "ready" ? "Ready" : snapshot.status === "failed" ? "Failed" : "Preparing"}</Badge><span className="text-xs text-muted-foreground">{new Date(snapshot.createdAt).toLocaleString()}</span></div>
      <p className="break-all text-xs">Commit <code>{snapshot.commit}</code><br /><span className="text-muted-foreground">Tree <code>{snapshot.tree}</code></span></p>
      {!snapshot.cacheState && snapshot.status === "pending" && <p className="text-xs text-muted-foreground">Preparation is pending. Refresh status to check progress.{isOwner && snapshot.canRetry === true && " Resume reconciles the saved request using the same identity."}</p>}
      {isOwner && !snapshot.cacheState && snapshot.status === "pending" && snapshot.canRetry === true && <Button size="sm" variant="outline" disabled={busy !== null || draft !== null} onClick={() => void prepare(snapshot)}>Resume preparation</Button>}
      {snapshot.cacheState && <p className="text-xs text-muted-foreground">{snapshot.cacheState === "deleted" ? "Cached bundle removed. Repository history is preserved." : "Cache cleanup is pending. Repository history is preserved; refresh or retry removal."}</p>}
      {snapshot.size !== undefined && <p className="text-xs text-muted-foreground">{snapshot.size.toLocaleString()} bytes</p>}
      {isOwner && (snapshot.status === "failed" || snapshot.cacheState === "deleted") && snapshot.cacheState !== "deleting" && <Button size="sm" variant="outline" disabled={busy !== null || draft !== null} onClick={() => void prepare(snapshot)}>{snapshot.cacheState === "deleted" ? "Prepare this commit again" : snapshot.canRetry === true ? "Retry this preparation" : "Prepare this commit"}</Button>}
      {snapshot.error && <p className="break-words text-xs text-destructive">{snapshot.error}</p>}
      {snapshot.status === "ready" && !snapshot.cacheState && browserDownloadable(snapshot) && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void download(snapshot)}>{busy === snapshot.id ? "Downloading…" : "Download Git bundle"}</Button>}
      {snapshot.status === "ready" && !snapshot.cacheState && !browserDownloadable(snapshot) && <div className="space-y-1"><p className="text-xs text-muted-foreground">Use the CLI for bundles larger than 16 MiB or without a recorded size.</p><code className="block break-all text-xs">bun cli/flaregit.ts recovery download {projectId} {snapshot.id} --output repository.bundle</code></div>}
      {isOwner && snapshot.cacheState !== "deleted" && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => { setRemoving(snapshot); setConfirmation(""); }}>{snapshot.cacheState === "deleting" ? "Retry cache removal" : "Remove cached bundle"}</Button>}
    </li>)}</ul>}
    <Dialog open={choosing} onOpenChange={setChoosing}>
      <DialogHeader><DialogTitle>Choose accepted commit</DialogTitle></DialogHeader>
      <p className="mb-3 text-sm text-muted-foreground">Choose recorded accepted history. Preparing this commit uses repository compute and retained storage capacity.</p>
      <label htmlFor="recovery-target-search" className="sr-only">Search accepted commit</label>
      <Input id="recovery-target-search" placeholder="Search commit" value={search} onChange={event => setSearch(event.target.value)} />
      <p className="my-2 text-xs text-muted-foreground">{matchingTargets.length} matching accepted commits{matchingTargets.length > 50 ? "; showing the first 50. Search to narrow the list." : "."}</p>
      <ul className="max-h-72 overflow-y-auto space-y-2">{matchingTargets.slice(0, 50).map(target => <li key={target.journalId}><Button size="sm" variant={selectedTarget?.commit === target.commit ? "secondary" : "outline"} className="h-auto w-full justify-start whitespace-normal break-all text-left font-mono text-xs" disabled={busy !== null || draft !== null || activeSnapshot(target.commit) !== undefined} onClick={() => { setSelectedCommit(target.commit); setChoosing(false); }}>{target.commit}<span className="ml-2 font-sans text-muted-foreground">{activeSnapshot(target.commit)?.status === "ready" ? "Ready" : activeSnapshot(target.commit)?.status === "pending" ? "Preparing" : new Date(target.acceptedAt).toLocaleDateString()}</span></Button></li>)}</ul>
      <DialogFooter><Button variant="outline" onClick={() => setChoosing(false)}>Cancel</Button></DialogFooter>
    </Dialog>
    <Dialog open={removing !== null} onOpenChange={open => { if (!open && busy !== "remove") { setRemoving(null); setConfirmation(""); } }}>
      <DialogHeader><DialogTitle>Remove cached Git bundle</DialogTitle></DialogHeader>
      <p className="mb-3 text-sm text-muted-foreground">This permanently removes the cached recovery artifact. Repository history is preserved. Preparing another copy requires repository compute and available storage capacity.</p>
      <label htmlFor="recovery-cache-confirmation" className="mb-2 block break-all text-xs">Type DELETE CACHED BUNDLE {removing?.id}</label>
      <Input id="recovery-cache-confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy !== null} autoComplete="off" />
      <DialogFooter><Button variant="outline" disabled={busy !== null} onClick={() => { setRemoving(null); setConfirmation(""); }}>Cancel</Button><Button variant="destructive" disabled={!isOwner || busy !== null || !removing || confirmation !== `DELETE CACHED BUNDLE ${removing.id}`} onClick={() => void removeCache()}>{busy === "remove" ? "Removing…" : "Remove cached bundle"}</Button></DialogFooter>
    </Dialog>
  </CardContent></Card>;
}
