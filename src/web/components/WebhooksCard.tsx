import React, { useCallback, useEffect, useState } from "react";
import { RotateCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiJson } from "../api";
import { timeAgo } from "../router";

interface Hook { id: string; url: string; events: string; active: number }
interface Delivery { id: string; webhook_id: string; event: string; status: "pending" | "success" | "failed"; attempts: number; last_status: number | null; last_error: string | null; latency_ms: number | null; updated_at: string }

const EVENTS: Array<[string, string]> = [
  ["change.ready", "A change is ready"],
  ["change.accepted", "Work was accepted"],
  ["change.blocked", "Integration was blocked"],
  ["decision.needed", "A decision is needed"],
];
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

export function WebhooksCard({ projectId, isOwner }: { projectId: string; isOwner: boolean }) {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["change.accepted", "change.blocked"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiJson<Hook[]>(`/p/${projectId}/webhooks`).then(setHooks).catch(() => undefined);
    apiJson<Delivery[]>(`/p/${projectId}/deliveries`).then(setDeliveries).catch(() => undefined);
  }, [projectId]);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
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

  const failing = deliveries.filter((d) => d.status !== "success").length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          Webhooks {failing > 0 && <Badge variant="warning">{failing} not delivered</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Events are saved first, then delivered with a signature (<code>webhook-signature</code>) and retried with backoff. Receivers should de-duplicate on <code>webhook-id</code>.
        </p>
        {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        {secret && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
            Signing secret (shown once): <code className="break-all">{secret}</code>
          </div>
        )}
        <div className="divide-y divide-border rounded-md border border-border">
          {hooks.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No webhooks yet</p>}
          {hooks.map((h) => (
            <div key={h.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate">{h.url}</div>
                <div className="text-xs text-muted-foreground">{h.events.split(",").join(" · ")}</div>
              </div>
              {isOwner && <Button size="sm" variant="ghost" aria-label="Remove webhook" disabled={busy} onClick={() => guard(async () => { await apiJson(`/p/${projectId}/webhooks/${h.id}`, { method: "DELETE" }); })}><Trash2 className="h-3.5 w-3.5" /></Button>}
            </div>
          ))}
        </div>
        {isOwner && (
          <div className="space-y-2">
            <input className={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/flaregit" aria-label="Webhook URL" />
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {EVENTS.map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={events.includes(key)} onChange={() => setEvents((cur) => (cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]))} /> {label}
                </label>
              ))}
            </div>
            <Button variant="outline" disabled={busy || !url || events.length === 0} onClick={() => guard(async () => {
              const r = await apiJson<{ secret: string }>(`/p/${projectId}/webhooks`, { method: "POST", json: { url, events } });
              setSecret(r.secret);
              setUrl("");
            })}>Add webhook</Button>
          </div>
        )}
        {deliveries.length > 0 && (
          <div>
            <div className="text-xs font-semibold mb-1">Delivery log</div>
            <div className="divide-y divide-border rounded-md border border-border text-xs">
              {deliveries.map((d) => (
                <div key={d.id} className="px-3 py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-medium">{d.event}</span>
                    <span className="text-muted-foreground"> · {timeAgo(d.updated_at)} · {d.attempts} attempt{d.attempts === 1 ? "" : "s"}{d.latency_ms !== null ? ` · ${d.latency_ms} ms` : ""}{d.last_status ? ` · HTTP ${d.last_status}` : ""}</span>
                    {d.last_error && d.status !== "success" && <div className="text-destructive truncate">{d.last_error}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={d.status === "success" ? "success" : d.status === "failed" ? "destructive" : "warning"}>{d.status === "pending" ? "retrying" : d.status}</Badge>
                    {isOwner && d.status !== "success" && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => guard(async () => { await apiJson(`/p/${projectId}/deliveries/${d.id}/redeliver`, { method: "POST" }); })}><RotateCw className="h-3 w-3 mr-1" /> Redeliver</Button>
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
