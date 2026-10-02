import React, { useCallback, useEffect, useState } from "react";
import { RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiJson } from "../api";
import { timeAgo } from "../router";

interface Hook { id: string; url: string; events: string; active: number }
interface Delivery { id: string; seq: number; queue_ms: number | null; webhook_id: string; event: string; status: "pending" | "success" | "failed"; attempts: number; last_status: number | null; last_error: string | null; latency_ms: number | null; updated_at: string }

const EVENTS: Array<[string, string]> = [
  ["change.ready", "A change is ready"],
  ["change.accepted", "Work was accepted"],
  ["change.blocked", "Integration was blocked"],
  ["decision.needed", "A decision is needed"],
];
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const alertCls = "rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive";
const okCls = "rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200";
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function WebhooksCard({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const [hooks, setHooks] = useState<Hook[] | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["change.accepted", "change.blocked"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, d] = await Promise.all([
        apiJson<Hook[]>(`/p/${projectId}/webhooks`),
        apiJson<Delivery[]>(`/p/${projectId}/deliveries`),
      ]);
      setHooks(h);
      setDeliveries(d);
      setLoadError(null);
    } catch (e) {
      setLoadError(errText(e, "Could not load webhooks"));
    }
  }, [projectId]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  const guard = async (label: string, done: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (e) {
      setError(errText(e, "Something went wrong"));
    } finally {
      setBusy(null);
    }
  };

  const failing = deliveries?.filter((d) => d.status !== "success").length ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex flex-wrap items-center gap-2">
          Webhooks {failing > 0 && <Badge variant="warning">{failing} not delivered</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 min-w-0">
        <p className="text-xs text-muted-foreground">
          Events are saved first, then delivered with a signature (<code>webhook-signature</code>) and retried with backoff. Receivers should de-duplicate on <code>webhook-id</code>.
        </p>
        {loadError && (
          <div role="alert" className={`${alertCls} flex flex-wrap items-center justify-between gap-2`}>
            <span>{loadError}</span>
            <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
          </div>
        )}
        {error && <div role="alert" className={alertCls}>{error}</div>}
        {notice && <div role="status" className={okCls}>{notice}</div>}
        {secret && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
            Signing secret (shown once): <code className="break-all">{secret}</code>
          </div>
        )}
        {hooks === null && !loadError && <p role="status" className="text-sm text-muted-foreground">Loading webhooks…</p>}
        {hooks && (
          <div className="divide-y divide-border rounded-md border border-border">
            {hooks.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No webhooks yet</p>}
            {hooks.map((h) => (
              <div key={h.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="break-all">{h.url}</div>
                  <div className="text-xs text-muted-foreground">{h.events.split(",").join(" · ")}</div>
                </div>
                {isOwner && (
                  <Button size="sm" variant="ghost" aria-label={`Remove webhook ${h.url}`} disabled={busy !== null} onClick={() => guard(`del:${h.id}`, "Webhook removed.", async () => { await apiJson(`/p/${projectId}/webhooks/${h.id}`, { method: "DELETE" }); })}>
                    {busy === `del:${h.id}` ? "Removing…" : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {isOwner && (
          <form className="space-y-2" onSubmit={(e) => {
            e.preventDefault();
            void guard("add", "Webhook added.", async () => {
              const r = await apiJson<{ secret: string }>(`/p/${projectId}/webhooks`, { method: "POST", json: { url, events } });
              setSecret(r.secret);
              setUrl("");
            });
          }}>
            <label className="block text-sm">
              <span className="font-medium">Webhook URL</span>
              <input className={field} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/flaregit" />
            </label>
            <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
              <legend className="sr-only">Events to deliver</legend>
              {EVENTS.map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={events.includes(key)} onChange={() => setEvents((cur) => (cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]))} /> {label}
                </label>
              ))}
            </fieldset>
            <Button type="submit" variant="outline" disabled={busy !== null || !url || events.length === 0}>{busy === "add" ? "Adding…" : "Add webhook"}</Button>
          </form>
        )}
        {deliveries && deliveries.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold mb-1">Delivery log</h4>
            <div className="divide-y divide-border rounded-md border border-border text-xs">
              {deliveries.map((d) => (
                <div key={d.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-medium break-all">{d.event}</span>
                    <span className="text-muted-foreground"> · #{d.seq} · {timeAgo(d.updated_at)} · {d.attempts} attempt{d.attempts === 1 ? "" : "s"}{d.queue_ms !== null ? ` · queued ${d.queue_ms} ms` : ""}{d.latency_ms !== null ? ` · ${d.latency_ms} ms` : ""}{d.last_status ? ` · HTTP ${d.last_status}` : ""}</span>
                    {d.last_error && d.status !== "success" && <div className="text-destructive break-all">{d.last_error}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={d.status === "success" ? "success" : d.status === "failed" ? "destructive" : "warning"}>{d.status === "pending" ? "retrying" : d.status}</Badge>
                    {isOwner && d.status !== "success" && (
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => guard(`re:${d.id}`, "Redelivery queued.", async () => { await apiJson(`/p/${projectId}/deliveries/${d.id}/redeliver`, { method: "POST" }); })}>
                        <RotateCw className="h-3 w-3 mr-1" /> {busy === `re:${d.id}` ? "Queuing…" : "Redeliver"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
