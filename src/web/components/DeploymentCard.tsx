import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { apiJson } from "../api";
import type { AcceptedDeploymentTarget, DeploymentRecord } from "@/server/deployments";

interface Service { id: string; name: string; active: boolean; capabilities: string[] }
interface Delivery { id: string; event: string; status: string; attempts: number }
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function DeploymentCard({ projectId }: { projectId: string }) {
  const [records, setRecords] = useState<DeploymentRecord[] | null>(null);
  const [targets, setTargets] = useState<AcceptedDeploymentTarget[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [sourceErrors, setSourceErrors] = useState<string[]>([]);
  const [configurationKnown, setConfigurationKnown] = useState(false);
  const [deliveryKnown, setDeliveryKnown] = useState(false);
  const [journalId, setJournalId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const request = useRef<{ payload: string; key: string } | null>(null);
  const load = useCallback(async (current = generation.current) => {
    const result = await Promise.allSettled([
      apiJson<{ deployments: DeploymentRecord[] }>(`/p/${projectId}/deployments`),
      apiJson<{ targets: AcceptedDeploymentTarget[] }>(`/p/${projectId}/deployment-targets`),
      apiJson<{ connections: Service[] }>(`/p/${projectId}/connections`),
      apiJson<Delivery[]>(`/p/${projectId}/deliveries`),
    ]);
    if (current !== generation.current) return;
    const [history, accepted, connections, delivery] = result;
    if (history.status === "fulfilled") setRecords(history.value.deployments);
    if (accepted.status === "fulfilled") setTargets(accepted.value.targets); else { setTargets([]); setJournalId(""); }
    if (connections.status === "fulfilled") setServices(connections.value.connections.filter(service => service.active && service.capabilities.includes("report-deployment"))); else { setServices([]); setServiceId(""); }
    setConfigurationKnown(accepted.status === "fulfilled" && connections.status === "fulfilled");
    setDeliveryKnown(delivery.status === "fulfilled");
    if (delivery.status === "fulfilled") setDeliveries(delivery.value.filter(item => item.event === "deployment.requested")); else setDeliveries([]);
    setSourceErrors([history.status === "rejected" ? "Deployment history unavailable; previously loaded records may be outdated." : "", accepted.status === "rejected" ? "Accepted revisions unavailable. Requests are disabled." : "", connections.status === "rejected" ? "Service configuration unavailable. Requests are disabled." : "", delivery.status === "rejected" ? "Webhook delivery status unavailable." : ""].filter(Boolean));
  }, [projectId]);
  useEffect(() => {
    const current = ++generation.current;
    setSourceErrors([]); setConfigurationKnown(false); setDeliveryKnown(false); setRecords(null); setTargets([]); setServices([]); setDeliveries([]); setJournalId(""); setServiceId(""); setEnvironment("production"); setError(null); setNotice(null); setBusy(false); request.current = null;
    void load(current).catch(() => { if (current === generation.current) setError("Deployment settings could not load. Refresh to retry."); });
    return () => { generation.current++; };
  }, [load]);
  const target = targets.find(item => item.journalId === journalId);
  return <Card>
    <CardHeader className="pb-2"><CardTitle className="text-sm">Deploy accepted history</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-xs text-muted-foreground">Send a committed, recoverable Git revision to your deployment service. The service reports deployment status separately from webhook delivery.</p>
      {sourceErrors.map(message => <p key={message} role="alert" className="text-xs text-destructive">{message}</p>)}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <Button size="sm" variant="outline" disabled={busy} onClick={async () => { const current = generation.current; setBusy(true); setError(null); try { await load(current); } catch { if (current === generation.current) setError("Could not refresh. Previously loaded records may be outdated."); } finally { if (current === generation.current) setBusy(false); } }}>Refresh deployment status</Button>
      {!records && !error && <p role="status" className="text-sm text-muted-foreground">Loading deployments…</p>}
      {records && <>
        <form className="space-y-3" onSubmit={async event => {
          event.preventDefault(); if (!configurationKnown) return; const current = generation.current;
          const payload = JSON.stringify({ journalId, serviceId, environment: environment.trim() });
          if (request.current?.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
          const idempotencyKey = request.current.key;
          setBusy(true); setError(null); setNotice(null);
          try {
            const result = await apiJson<{ kind: "created" | "duplicate"; deployment: DeploymentRecord }>(`/p/${projectId}/deployments`, { method: "POST", json: { journalId, serviceId, environment: environment.trim(), idempotencyKey } });
            if (current !== generation.current) return;
            setRecords(rows => [...(rows ?? []).filter(row => row.id !== result.deployment.id), result.deployment]);
            setNotice(result.kind === "duplicate" ? "Existing request recovered. Deployment status is shown below." : "Request saved for webhook delivery. The deployment has not yet been confirmed by the service.");
            try { await load(current); } catch { if (current === generation.current) setError("Request saved, but status could not refresh. Refresh to read delivery progress."); }
          } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : "Request outcome is unknown. Retry unchanged fields to reuse the same request key."); }
          finally { if (current === generation.current) setBusy(false); }
        }}>
          <label className="block text-sm">Accepted revision<select className={field} value={journalId} disabled={busy} onChange={event => setJournalId(event.target.value)}><option value="">Choose accepted history</option>{targets.map(item => <option key={item.journalId} value={item.journalId}>{item.commit.slice(0, 12)} · {new Date(item.acceptedAt).toLocaleString()}</option>)}</select></label>
          {target && <code className="block break-all text-xs text-muted-foreground">{target.recoverableRef}</code>}
          <label className="block text-sm">Deployment service<select className={field} value={serviceId} disabled={busy} onChange={event => setServiceId(event.target.value)}><option value="">Choose connected service</option>{services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
          <label className="block text-sm">Environment<Input value={environment} maxLength={100} disabled={busy} onChange={event => setEnvironment(event.target.value)} /></label>
          {configurationKnown && (!targets.length || !services.length) && <p className="text-xs text-muted-foreground">Accept a reviewed change and connect a service with deployment reporting enabled. Configure its webhook for deployment.requested below.</p>}
          <Button variant="outline" disabled={busy || !configurationKnown || !target || !services.some(service => service.id === serviceId) || !environment.trim()}>{busy ? "Saving…" : "Request deployment"}</Button>
        </form>
        <ul className="divide-y divide-border">{records.length === 0 && <li className="text-sm text-muted-foreground">No deployment requests.</li>}{records.slice().reverse().map(record => <li key={record.id} className="space-y-1 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{record.environment}</span><Badge variant="outline">{record.status === "requested" ? "Awaiting service report" : record.status}</Badge></div><code className="block text-xs break-all">{record.target.commit}</code>{record.summary && <p className="text-sm break-words">{record.summary}</p>}{record.detailsUrl && <a href={record.detailsUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline">Deployment details</a>}<p className="text-xs text-muted-foreground break-all">Request event: {record.requestEventId}</p></li>)}</ul>
        {deliveryKnown && deliveries.length > 0 && <p className="text-xs text-muted-foreground">Webhook delivery: {deliveries.filter(row => row.status === "success").length} delivered · {deliveries.filter(row => row.status === "pending").length} pending · {deliveries.filter(row => row.status === "failed").length} failed. <a href="#deployment-deliveries" className="underline">Inspect and replay failed delivery below</a>.</p>}
      </>}
    </CardContent>
  </Card>;
}
