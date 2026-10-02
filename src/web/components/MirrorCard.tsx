import React, { useCallback, useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiJson } from "../api";
import { timeAgo } from "../router";

type RunStatus = "ok" | "diverged" | "auth_failed" | "error" | "pending";
interface MirrorRun { id: string; commit: string; status: RunStatus; detail: string; at: string }
interface MirrorInfo { target: string | null; enabled: boolean; hasToken: boolean; runs: MirrorRun[] }

const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const LABEL: Record<RunStatus, string> = { ok: "Mirrored", diverged: "GitHub diverged", auth_failed: "Token rejected", error: "Failed", pending: "Queued" };
const VARIANT: Record<RunStatus, "success" | "warning" | "destructive" | "secondary"> = { ok: "success", diverged: "warning", auth_failed: "destructive", error: "destructive", pending: "secondary" };

export function MirrorCard({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const [info, setInfo] = useState<MirrorInfo | null>(null);
  const [target, setTarget] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiJson<MirrorInfo>(`/p/${projectId}/mirror`).then(setInfo).catch(() => undefined);
  }, [projectId]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const save = () => guard(async () => {
    await apiJson(`/p/${projectId}/mirror`, { method: "PUT", json: { target: target || info?.target, token: token || undefined, enabled: true } });
    setToken("");
    setTarget("");
  });
  const toggle = () => guard(async () => { await apiJson(`/p/${projectId}/mirror`, { method: "PUT", json: { enabled: !info?.enabled } }); });
  const remove = () => guard(async () => { await apiJson(`/p/${projectId}/mirror`, { method: "DELETE" }); });
  const retry = () => guard(async () => { await apiJson(`/p/${projectId}/mirror/run`, { method: "POST" }); });

  const last = info?.runs[0];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          Mirror to GitHub
          {info?.target && <Badge variant={info.enabled ? "secondary" : "outline"}>{info.enabled ? "On" : "Paused"}</Badge>}
          {last && last.status !== "ok" && <Badge variant={VARIANT[last.status]}>{LABEL[last.status]}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          FlareGit stays the source of truth; GitHub is a copy. If GitHub is down or has diverged, nothing here is affected. Accepted work is pushed after it lands, never forced.
        </p>
        {info?.target && (
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-xs break-all">{info.target}</code>
            {isOwner && (
              <>
                <Button size="sm" variant="outline" disabled={busy} onClick={toggle}>{info.enabled ? "Pause" : "Resume"}</Button>
                <Button size="sm" variant="outline" disabled={busy || !info.enabled} onClick={retry}><RotateCw className="h-3.5 w-3.5 mr-1" />Retry now</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={remove}>Remove</Button>
              </>
            )}
          </div>
        )}
        {isOwner && (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <input className={field} placeholder={info?.target ?? "https://github.com/owner/repo"} value={target} onChange={(e) => setTarget(e.target.value)} />
            <input className={field} type="password" autoComplete="off" placeholder={info?.hasToken ? "Token saved — enter a new one to replace it" : "GitHub fine-grained token (Contents: read and write)"} value={token} onChange={(e) => setToken(e.target.value)} />
            <Button size="sm" type="submit" disabled={busy || (!target && !info?.target) || (!token && !info?.hasToken)}>Save</Button>
          </form>
        )}
        {error && <p className="text-destructive">{error}</p>}
        {info && info.runs.length > 0 && (
          <ul className="divide-y divide-border">
            {info.runs.slice(0, 10).map((r) => (
              <li key={r.id} className="py-2 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Badge variant={VARIANT[r.status]}>{LABEL[r.status]}</Badge>
                  <code className="text-xs">{r.commit.slice(0, 12)}</code>
                  <span className="text-xs text-muted-foreground ml-auto">{timeAgo(r.at)}</span>
                </div>
                {r.status !== "ok" && r.detail && <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all">{r.detail}</pre>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
