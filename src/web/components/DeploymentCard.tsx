import {deploymentTargetRefLabel,deploymentTargetOptionLabel} from "../deployment-target-display";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { apiJson } from "../api";
import { deploymentStatusRead } from "../deployment-status-read";
import type { AcceptedDeploymentTarget, DeploymentRecord, DeploymentEnvironment } from "@/server/deployments";

interface Service { id: string; name: string; active: boolean; capabilities: string[] }
interface Delivery { id: string; event: string; status: string; attempts: number }
const field = "w-full min-w-0 max-w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function DeploymentTargetSummary({target}:{target:AcceptedDeploymentTarget}){
 return <dl className="grid min-w-0 gap-x-3 gap-y-1 text-xs sm:grid-cols-[auto_1fr]"><dt className="text-muted-foreground">Accepted branch</dt><dd className="break-all font-mono">{deploymentTargetRefLabel(target)}</dd><dt className="text-muted-foreground">Commit</dt><dd className="break-all font-mono">{target.commit}</dd><dt className="text-muted-foreground">Recovery ref</dt><dd className="break-all font-mono text-muted-foreground">{target.recoverableRef}</dd></dl>;
}

export function DeploymentCard({ projectId }: { projectId: string }) {
  const [environments,setEnvironments]=useState<DeploymentEnvironment[]>([]);
  const [assets,setAssets]=useState<Array<{releaseId:string;id:string;name:string;sha256:string;commit:string}>>([]);
  const [assetId,setAssetId]=useState("");
  const [approvalId,setApprovalId]=useState("");
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
  const readSequence = useRef(0);
  const rollbackRequests=useRef(new Map<string,{key:string;approvalId?:string}>());
  const request = useRef<{ payload: string; key: string } | null>(null);
  const load = useCallback(async (current = generation.current) => {
    const sequence = ++readSequence.current;
    const extra=await Promise.allSettled([apiJson<{environments:DeploymentEnvironment[]}>(`/p/${projectId}/deployment-environments`),apiJson<{releases:Array<{scope:{id:string;source:{commit:string}};phase:string;assets:Array<{id:string;name:string;sha256:string;phase:string}>}>}>(`/p/${projectId}/releases`)]);
    if(current!==generation.current||sequence!==readSequence.current)return;
    setEnvironments(extra[0].status==="fulfilled"?extra[0].value.environments:[]);
    setAssets(extra[1].status==="fulfilled"?extra[1].value.releases.filter(row=>row.phase==="published").flatMap(row=>row.assets.filter(asset=>asset.phase==="verified").map(asset=>({...asset,releaseId:row.scope.id,commit:row.scope.source.commit}))):[]);
    const result = await Promise.allSettled([
      deploymentStatusRead(signal => apiJson<{ deployments: DeploymentRecord[] }>(`/p/${projectId}/deployments`, { signal })),
      deploymentStatusRead(signal => apiJson<{ targets: AcceptedDeploymentTarget[] }>(`/p/${projectId}/deployment-targets`, { signal })),
      deploymentStatusRead(signal => apiJson<{ connections: Service[] }>(`/p/${projectId}/connections`, { signal })),
      deploymentStatusRead(signal => apiJson<Delivery[]>(`/p/${projectId}/deliveries`, { signal })),
    ]);
    if (current !== generation.current || sequence !== readSequence.current) return;
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
  const selectedAsset=assets.find(row=>row.id===assetId);
  const selectedEnvironment=environments.find(row=>row.name===environment.trim());
  const artifact=selectedAsset&&selectedEnvironment?{releaseId:selectedAsset.releaseId,assetId:selectedAsset.id,environmentId:selectedEnvironment.id,approvalId}:undefined;
  const target = targets.find(item => item.journalId === journalId);
  return <Card>
    <CardHeader className="pb-2"><CardTitle className="text-sm">Deploy accepted history</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-xs text-muted-foreground">Send a committed, recoverable Git revision to your deployment service. The service reports deployment status separately from webhook delivery.</p>
      {sourceErrors.map(message => <p key={message} role="alert" className="text-xs text-destructive">{message}</p>)}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <Button type="button" size="sm" variant="outline" disabled={busy||!environment.trim()||!!selectedEnvironment} onClick={async()=>{setBusy(true);setError(null);try{await apiJson(`/p/${projectId}/deployment-environments`,{method:"POST",json:{id:crypto.randomUUID(),name:environment.trim(),requireApproval:true,revision:0}});await load();}catch(cause){setError(cause instanceof Error?cause.message:"Environment could not save");}finally{setBusy(false);}}}>Require artifact approval for this environment</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={async () => { const current = generation.current; setBusy(true); setError(null); try { await load(current); } catch { if (current === generation.current) setError("Could not refresh. Previously loaded records may be outdated."); } finally { if (current === generation.current) setBusy(false); } }}>Refresh deployment status</Button>
      {!records && !error && sourceErrors.length === 0 && <p role="status" className="text-sm text-muted-foreground">Loading deployments…</p>}
      {records && <>
        <form className="space-y-3" onSubmit={async event => {
          event.preventDefault(); if (!configurationKnown) return; const current = generation.current;
          const payload = JSON.stringify({ journalId, serviceId, environment: environment.trim(),artifact });
          if (request.current?.payload !== payload) request.current = { payload, key: crypto.randomUUID() };
          const idempotencyKey = request.current.key;
          setBusy(true); setError(null); setNotice(null);
          try {
            const result = await apiJson<{ kind: "created" | "duplicate"; deployment: DeploymentRecord }>(`/p/${projectId}/deployments`, { method: "POST", json: { journalId, serviceId, environment: environment.trim(), idempotencyKey,artifact } });
            if (current !== generation.current) return;
            setRecords(rows => [...(rows ?? []).filter(row => row.id !== result.deployment.id), result.deployment]);
            setNotice(result.kind === "duplicate" ? "Existing request recovered. Deployment status is shown below." : "Request saved for webhook delivery. The deployment has not yet been confirmed by the service.");
            try { await load(current); } catch { if (current === generation.current) setError("Request saved, but status could not refresh. Refresh to read delivery progress."); }
          } catch (cause) { if (current === generation.current) setError(cause instanceof Error ? cause.message : "Request outcome is unknown. Retry unchanged fields to reuse the same request key."); }
          finally { if (current === generation.current) setBusy(false); }
        }}>
          <label className="block text-sm">Accepted revision<select className={field} value={journalId} disabled={busy} onChange={event => {setJournalId(event.target.value);setApprovalId("");}}><option value="">Choose accepted history</option>{targets.map(item => <option key={item.journalId} value={item.journalId}>{deploymentTargetOptionLabel(item)}</option>)}</select></label>
          {target && <DeploymentTargetSummary target={target}/>}
          <label className="block text-sm">Deployment service<select className={field} value={serviceId} disabled={busy} onChange={event => setServiceId(event.target.value)}><option value="">Choose connected service</option>{services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
          <label className="block text-sm">Environment<Input value={environment} maxLength={100} disabled={busy} onChange={event => {setEnvironment(event.target.value);setApprovalId("");}} /></label>
          {configurationKnown && (!targets.length || !services.length) && <p className="text-xs text-muted-foreground">Accept a reviewed change and connect a service with deployment reporting enabled. Configure its webhook for deployment.requested below.</p>}
          {selectedEnvironment && <><label className="block text-sm">Release artifact<select className={field} value={assetId} onChange={event=>{setAssetId(event.target.value);setApprovalId("");}}><option value="">Choose immutable artifact</option>{assets.filter(row=>row.commit===target?.commit).map(row=><option key={row.id} value={row.id}>{row.name} · {row.sha256.slice(0,12)}</option>)}</select></label><Button type="button" variant="outline" disabled={busy||!selectedAsset||!target} onClick={async()=>{setBusy(true);setError(null);try{const result=await apiJson<{approvalId:string}>(`/p/${projectId}/deployment-approvals`,{method:"POST",json:{journalId,artifact:{releaseId:selectedAsset!.releaseId,assetId:selectedAsset!.id,environmentId:selectedEnvironment.id}}});setApprovalId(result.approvalId);}catch(cause){setError(cause instanceof Error?cause.message:"Approval failed");}finally{setBusy(false);}}}>{approvalId?"Artifact approved":"Approve exact artifact"}</Button></>}
          <Button type="submit" variant="outline" disabled={busy || (selectedEnvironment&&!approvalId) || !configurationKnown || !target || !services.some(service => service.id === serviceId) || !environment.trim()}>{busy ? "Saving…" : "Request deployment"}</Button>
        </form>
        <ul className="divide-y divide-border">{records.length === 0 && <li className="text-sm text-muted-foreground">No deployment requests.</li>}{records.slice().reverse().map(record => <li key={record.id} className="space-y-1 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">{record.environment}</span><Badge variant="outline">{record.status === "requested" ? "Awaiting service report" : record.status}</Badge></div><p className="text-xs break-all font-mono text-muted-foreground">{deploymentTargetRefLabel(record.target)}</p><code className="block text-xs break-all">{record.target.commit}</code>{record.artifact && record.status==="succeeded" && <Button size="sm" variant="outline" disabled={busy||!assets.some(row=>row.id===record.artifact?.artifactId)} onClick={async()=>{const asset=assets.find(row=>row.id===record.artifact!.artifactId)!;const binding={releaseId:asset.releaseId,assetId:asset.id,environmentId:record.artifact!.environmentId,rollbackOf:record.id};let attempt=rollbackRequests.current.get(record.id);if(!attempt){attempt={key:crypto.randomUUID()};rollbackRequests.current.set(record.id,attempt);}setBusy(true);setError(null);try{if(!attempt.approvalId){const approved=await apiJson<{approvalId:string}>(`/p/${projectId}/deployment-approvals`,{method:"POST",json:{journalId:record.target.journalId,artifact:binding}});attempt.approvalId=approved.approvalId;}await apiJson(`/p/${projectId}/deployments`,{method:"POST",json:{journalId:record.target.journalId,serviceId:record.serviceId,environment:record.environment,idempotencyKey:attempt.key,artifact:{...binding,approvalId:attempt.approvalId}}});setNotice("Rollback requested for the exact observed artifact.");await load();}catch(cause){setError(cause instanceof Error?cause.message:"Rollback outcome unknown; retry to recover the same request.");}finally{setBusy(false);}}}>Restore this artifact</Button>}{record.artifact && <code className="block break-all text-xs">SHA-256 {record.artifact.digest}</code>}{record.summary && <p className="text-sm break-words">{record.summary}</p>}{record.detailsUrl && <a href={record.detailsUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline">Deployment details</a>}<p className="text-xs text-muted-foreground break-all">Request event: {record.requestEventId}</p></li>)}</ul>
        {deliveryKnown && deliveries.length > 0 && <p className="text-xs text-muted-foreground">Webhook delivery: {deliveries.filter(row => row.status === "success").length} delivered · {deliveries.filter(row => row.status === "pending").length} pending · {deliveries.filter(row => row.status === "failed").length} failed. <a href="#deployment-deliveries" className="underline">Inspect and replay failed delivery below</a>.</p>}
      </>}
    </CardContent>
  </Card>;
}
