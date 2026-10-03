import React, { useCallback, useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiJson } from "../api";
import { timeAgo } from "../router";
import { useVisiblePolling } from "../use-visible-polling";

type RunStatus = "ok" | "diverged" | "auth_failed" | "error" | "pending";
interface MirrorRun { id: string; commit: string; status: RunStatus; detail: string; at: string }
interface MirrorInfo { target: string | null; enabled: boolean; hasToken: boolean; runs: MirrorRun[] }
type Busy = null | "save" | "toggle" | "remove" | "retry";

const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const alertCls = "rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive";
const okCls = "rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200";
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const LABEL: Record<RunStatus, string> = { ok: "Mirrored", diverged: "GitHub diverged", auth_failed: "Token rejected", error: "Failed", pending: "Queued" };
const VARIANT: Record<RunStatus, "success" | "warning" | "destructive" | "secondary"> = { ok: "success", diverged: "warning", auth_failed: "destructive", error: "destructive", pending: "secondary" };

export function MirrorCard({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const [info, setInfo] = useState<MirrorInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const generation = useRef(0);
  const mutationInFlight = useRef(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  useEffect(() => {
    generation.current++;
    mutationInFlight.current = false;
    setInfo(null); setLoadError(null); setLastLoadedAt(null); setTarget(""); setToken(""); setError(null); setNotice(null); setBusy(null);
    return () => { generation.current++; };
  }, [projectId]);
  const read = useCallback((signal: AbortSignal) => apiJson<MirrorInfo>(`/p/${projectId}/mirror`, { signal }), [projectId]);
  const refresh = useVisiblePolling({
    scope: projectId, intervalMs: 10000, read,
    onValue: (value) => { setInfo(value); setLoadError(null); setLastLoadedAt(new Date().toISOString()); },
    onError: (e) => setLoadError(errText(e, "Could not load mirror status")),
  });

  const guard = async (label: Exclude<Busy, null>, done: string, fn: (current: number) => Promise<void>) => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    const current = generation.current;
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn(current);
      if (current !== generation.current) return;
      setNotice(done);
      await refresh();
    } catch (e) {
      if (current === generation.current) setError(errText(e, "Something went wrong"));
    } finally {
      if (current === generation.current) { mutationInFlight.current = false; setBusy(null); }
    }
  };

  const save = () => guard("save", "Mirror settings saved.", async (current) => {
    await apiJson(`/p/${projectId}/mirror`, { method: "PUT", json: { target: target || info?.target, token: token || undefined, enabled: info?.target ? info.enabled : true } });
    if (current !== generation.current) return;
    setToken("");
    setTarget("");
  });
  const toggle = () => guard("toggle", info?.enabled ? "Mirror paused." : "Mirror resumed.", async () => { await apiJson(`/p/${projectId}/mirror`, { method: "PUT", json: { enabled: !info?.enabled } }); });
  const remove = () => guard("remove", "Mirror removed.", async (current) => { await apiJson(`/p/${projectId}/mirror`, { method: "DELETE" }); if (current !== generation.current) return; setToken(""); setTarget(""); });
  const retry = () => guard("retry", "Mirror run requested. Check the delivery log for the result; accepted repository history is unchanged.", async () => { await apiJson(`/p/${projectId}/mirror/run`, { method: "POST" }); });

  const last = info?.runs[0];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2">
          Mirror to GitHub
          {info?.target && <Badge variant={info.enabled ? "secondary" : "outline"}>{info.enabled ? "On" : "Paused"}</Badge>}
          {last && last.status !== "ok" && <Badge variant={VARIANT[last.status]}>{LABEL[last.status]}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm min-w-0">
        <p className="text-muted-foreground">
          FlareGit stays the source of truth; GitHub is a copy. If GitHub is unavailable or has diverged, repository browsing and review remain independent of the mirror. Accepted work is pushed after it lands, never forced.
        </p>
        {loadError && (
          <div role="alert" className={`${alertCls} flex flex-wrap items-center justify-between gap-2`}>
            <span>{loadError}{info ? ". Showing the last loaded mirror state." : ""}</span>
          </div>
        )}
        {lastLoadedAt && <p className="text-xs text-muted-foreground">Last loaded {timeAgo(lastLoadedAt)}</p>}
        <Button size="sm" variant="ghost" onClick={() => void refresh()}>{loadError ? "Retry refresh" : "Refresh status"}</Button>
        {!info && !loadError && <p role="status" className="text-muted-foreground">Loading mirror status…</p>}
        {info && !info.target && <p className="text-muted-foreground">No mirror configured.</p>}
        {info?.target && (
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-xs break-all">{info.target}</code>
            {isOwner && (
              <>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={toggle}>{busy === "toggle" ? (info.enabled ? "Pausing…" : "Resuming…") : info.enabled ? "Pause" : "Resume"}</Button>
                <Button size="sm" variant="outline" disabled={busy !== null || !info.enabled} onClick={retry}><RotateCw className="h-3.5 w-3.5 mr-1" />{busy === "retry" ? "Queuing…" : "Retry now"}</Button>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={remove}>{busy === "remove" ? "Removing…" : "Remove"}</Button>
              </>
            )}
          </div>
        )}
        {isOwner && info && (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <label className="block">
              <span className="font-medium">GitHub repository URL</span>
              <input className={field} type="url" disabled={busy === "save"} placeholder={info.target ?? "https://github.com/owner/repo"} value={target} onChange={(e) => setTarget(e.target.value)} />
            </label>
            <label className="block">
              <span className="font-medium">GitHub token</span>
              <input className={field} type="password" disabled={busy === "save"} autoComplete="off" placeholder={info.hasToken ? "Token saved — enter a new one to replace it" : "Fine-grained token (Contents: read and write)"} value={token} onChange={(e) => setToken(e.target.value)} />
            </label>
            <Button size="sm" type="submit" disabled={busy !== null || (!target && !info.target) || (!token && !info.hasToken)}>{busy === "save" ? "Saving…" : "Save"}</Button>
          </form>
        )}
        {error && <div role="alert" className={alertCls}>{error}</div>}
        {notice && <div role="status" className={okCls}>{notice}</div>}
        {info && info.runs.length > 0 && (
          <ul className="divide-y divide-border">
            {info.runs.slice(0, 10).map((r) => (
              <li key={r.id} className="py-2 flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={VARIANT[r.status]}>{LABEL[r.status]}</Badge>
                  <code className="text-xs break-all" title={r.commit}>{r.commit.slice(0, 12)}</code>
                  <span className="text-xs text-muted-foreground ml-auto">{timeAgo(r.at)}</span>
                </div>
                <span className="text-xs text-muted-foreground break-all">Run <code>{r.id}</code></span>
                {r.status !== "ok" && r.detail && <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all">{r.detail}</pre>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
