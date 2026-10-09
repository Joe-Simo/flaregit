import React, { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function ConnectionSecret({ secret, dismiss }: { secret: string; dismiss: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <section aria-label="New connection credential" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
    <h3 className="text-sm font-medium">Store this connection credential</h3>
    <p className="text-xs text-muted-foreground">It is shown only after creation. Keep it on the connected service's backend; do not include it in agent prompts or client code.</p>
    <input aria-label="Connection credential" readOnly type={revealed ? "text" : "password"} value={secret} autoComplete="off" spellCheck={false} className={`${field} font-mono`} />
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => setRevealed((value) => !value)}>{revealed ? <EyeOff className="mr-1.5 h-3 w-3" aria-hidden="true" /> : <Eye className="mr-1.5 h-3 w-3" aria-hidden="true" />}{revealed ? "Mask" : "Reveal"}</Button>
      <Button type="button" size="sm" variant="outline" onClick={async () => { setError(null); try { await navigator.clipboard.writeText(secret); setCopied(true); } catch { setError("Could not copy. Reveal the credential and copy it manually."); } }}><Copy className="mr-1.5 h-3 w-3" aria-hidden="true" /><span aria-live="polite">{copied ? "Copied" : "Copy credential"}</span></Button>
      <Button type="button" size="sm" variant="ghost" onClick={dismiss}>Hide credential</Button>
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiJson } from "../api";
import type { IntegrationCapability } from "@/server/integration-auth";
import type { ExternalCheckPolicy } from "@/core/external-checks";

interface Connection { id: string; name: string; capabilities: IntegrationCapability[]; active: boolean; createdAt: string }
interface ConnectionSettings { connections: Connection[]; policy: ExternalCheckPolicy }
const capabilities: Array<{ id: IntegrationCapability; label: string }> = [{ id: "read-candidate", label: "Read combined previews" }, { id: "report-check", label: "Publish checks" }, { id: "comment", label: "Post review comments" }, { id: "report-deployment", label: "Report deployment status" }];
const alertCls = "rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive";

export function ConnectionsCard({ projectId, isOwner, isCustom = false }: { projectId: string; isOwner: boolean; isCustom?: boolean }) {
  const [settings, setSettings] = useState<ConnectionSettings | null>(null);
  const [policy, setPolicy] = useState<ExternalCheckPolicy | null>(null);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<IntegrationCapability[]>(["read-candidate"]);
  const [credential, setCredential] = useState<{ projectId: string; id: string; secret: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const load = useCallback(async (generation = requestGeneration.current) => {
    const data = await apiJson<ConnectionSettings>(`/p/${projectId}/connections`);
    if (generation !== requestGeneration.current) return;
    setSettings(data);
    setPolicy((draft) => draft ?? data.policy);
  }, [projectId]);
  const run = async (operation: string, action: (generation: number) => Promise<void>) => {
    setBusy(operation); setError(null); setNotice(null);
    const generation = requestGeneration.current;
    try { await action(generation); }
    catch (cause) { if (generation === requestGeneration.current) setError(cause instanceof Error ? cause.message : "Connection request failed"); }
    finally { if (generation === requestGeneration.current) setBusy(null); }
  };
  useEffect(() => {
    const generation = ++requestGeneration.current;
    setSettings(null); setPolicy(null); setCredential(null); setError(null); setNotice(null); setBusy(null); setName("");
    void load(generation).catch((cause: unknown) => { if (generation === requestGeneration.current) setError(cause instanceof Error ? cause.message : "Could not load connections"); });
    return () => { requestGeneration.current++; };
  }, [load, isOwner]);
  const checkProviders = settings?.connections.filter((connection) => connection.active && connection.capabilities.includes("report-check")) ?? [];
  const invalidChecks = policy?.checks.some((check) => !check.id.trim() || !checkProviders.some((connection) => connection.id === check.providerId)) ?? false;
  const duplicateChecks = policy ? new Set(policy.checks.map((check) => check.id)).size !== policy.checks.length : false;
  const policyValid = policy && !invalidChecks && !duplicateChecks && (policy.mode === "augment" || (isCustom && policy.checks.some((check) => check.required)));

  return <Card>
    <CardHeader className="pb-2"><CardTitle className="text-sm">Connected tools</CardTitle></CardHeader>
    <CardContent className="space-y-4 min-w-0">
      <p className="text-xs text-muted-foreground">Connect your own agent, review, or CI service with repository-scoped capabilities. Connections cannot approve repository history.</p>
      {error && <div role="alert" className={alertCls}>{error}</div>}
      {notice && <p role="status" className="text-sm text-emerald-200">{notice}</p>}
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run("load", async (generation) => load(generation))}>{busy === "load" ? "Refreshing…" : settings ? "Refresh connections" : "Retry loading"}</Button>
      {!settings && !error && <p role="status" className="text-sm text-muted-foreground">Loading connections…</p>}
      {settings && <ul className="divide-y divide-border">
        {settings.connections.length === 0 && <li className="text-sm text-muted-foreground">No tools connected.</li>}
        {settings.connections.map((connection) => <li key={connection.id} className="py-3 flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1"><h3 className="text-sm font-medium break-words">{connection.name} {!connection.active && <Badge variant="outline">Revoked</Badge>}</h3><code className="block text-xs text-muted-foreground break-all">{connection.id}</code><p className="text-xs text-muted-foreground">{connection.capabilities.map((capability) => capabilities.find((item) => item.id === capability)?.label ?? capability).join(" · ")}</p></div>
          {isOwner && connection.active && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run(`revoke:${connection.id}`, async (generation) => { await apiJson(`/p/${projectId}/connections/${connection.id}`, { method: "DELETE" }); if (generation !== requestGeneration.current) return; if (credential?.id === connection.id) setCredential(null); setNotice("Connection revoked. Its credential can no longer authorize requests."); try { await load(generation); } catch { if (generation === requestGeneration.current) setError("Revoked, but the list could not refresh. Refresh connections to read the current state."); } })}>{busy === `revoke:${connection.id}` ? "Revoking…" : "Revoke"}</Button>}
        </li>)}
      </ul>}
      {isOwner && credential?.projectId === projectId && <ConnectionSecret key={credential.id} secret={credential.secret} dismiss={() => setCredential(null)} />}
      {isOwner && settings && <form className="space-y-3 border-t border-border pt-4" onSubmit={(event) => { event.preventDefault(); void run("create", async (generation) => {
        const created = await apiJson<{ connection: Connection; secret: string }>(`/p/${projectId}/connections`, { method: "POST", json: { name: name.trim(), capabilities: selected } });
        if (generation !== requestGeneration.current) return;
        setCredential({ projectId, id: created.connection.id, secret: created.secret }); setName(""); setSettings((current) => current ? { ...current, connections: [...current.connections, created.connection] } : current); setNotice("Connection created. Store its credential before leaving this page.");
      }); }}>
        <label className="block text-sm"><span className="font-medium">Connection name</span><input className={field} required maxLength={120} value={name} disabled={busy !== null} onChange={(event) => setName(event.target.value)} /></label>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-2"><legend className="text-xs text-muted-foreground mb-2">Allowed capabilities</legend>{capabilities.map((capability) => <label key={capability.id} className="text-xs flex items-center gap-2"><input type="checkbox" disabled={busy !== null} checked={selected.includes(capability.id)} onChange={() => setSelected((current) => current.includes(capability.id) ? current.filter((id) => id !== capability.id) : [...current, capability.id])} />{capability.label}</label>)}</fieldset>
        {credential && <p className="text-xs text-muted-foreground">Store and hide the credential above before creating another connection.</p>}
        <Button type="submit" variant="outline" disabled={busy !== null || !name.trim() || selected.length === 0 || credential !== null}>{busy === "create" ? "Creating…" : "Create connection"}</Button>
      </form>}
      {policy && <section className="border-t border-border pt-4 space-y-3" aria-label="External check policy">
        <h3 className="text-sm font-medium">External checks <span className="text-muted-foreground font-normal">· policy {settings?.policy.version}</span></h3>
        <p className="text-xs text-muted-foreground">Checks apply to the exact combined preview commit and frozen policy. Required checks gate acceptance; optional checks remain visible. Saving applies to future combined previews.</p>
        <label className="block text-sm"><span className="font-medium">CI mode</span><select className={field} disabled={!isOwner || busy !== null} value={policy.mode} onChange={(event) => setPolicy({ ...policy, mode: event.target.value === "external" ? "external" : "augment" })}><option value="augment">Keep protected CI and add connected checks</option><option value="external" disabled={!isCustom}>Use connected application CI{isCustom ? "" : " (imported repositories only)"}</option></select></label>
        <p className="text-xs text-muted-foreground">{policy.mode === "external" ? "Connected providers run application CI. FlareGit retains native Git integrity and human acceptance; customer commands, automatic AI repair, and preview builds do not run in this mode." : isCustom ? "Connected checks supplement protected CI. You can instead choose connected application CI with at least one required check." : "This demo retains its protected CI. Connected checks can supplement it."}</p>
        {policy.mode === "external" && !policy.checks.some((check) => check.required) && <p role="alert" className="text-xs text-destructive">Connected application CI needs at least one required check.</p>}
        <div className="space-y-3">{policy.checks.map((check, index) => <fieldset key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
          <label className="text-xs"><span>Check ID</span><input className={field} maxLength={200} disabled={!isOwner || busy !== null} value={check.id} onChange={(event) => setPolicy({ ...policy, checks: policy.checks.map((item, position) => position === index ? { ...item, id: event.target.value } : item) })} /></label>
          <label className="text-xs"><span>Connection</span><select className={field} disabled={!isOwner || busy !== null} value={check.providerId} onChange={(event) => setPolicy({ ...policy, checks: policy.checks.map((item, position) => position === index ? { ...item, providerId: event.target.value } : item) })}><option value="">Choose connection</option>{checkProviders.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label>
          <div className="flex items-center gap-2"><label className="text-xs flex gap-1.5 items-center"><input type="checkbox" disabled={!isOwner || busy !== null} checked={check.required} onChange={(event) => setPolicy({ ...policy, checks: policy.checks.map((item, position) => position === index ? { ...item, required: event.target.checked } : item) })} />Required</label>{isOwner && <Button type="button" size="sm" variant="ghost" disabled={busy !== null} aria-label={`Remove check ${check.id || index + 1}`} onClick={() => setPolicy({ ...policy, checks: policy.checks.filter((_, position) => position !== index) })}>Remove</Button>}</div>
        </fieldset>)}</div>
        {duplicateChecks && <p role="alert" className="text-xs text-destructive">Each check ID must be unique.</p>}
        {invalidChecks && <p role="alert" className="text-xs text-destructive">Each check needs an ID and an active connection with permission to publish checks.</p>}
        {isOwner && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy !== null || checkProviders.length === 0 || policy.checks.length >= 100} onClick={() => setPolicy({ ...policy, checks: [...policy.checks, { id: "", providerId: checkProviders[0]?.id ?? "", required: false }] })}>Add check</Button><Button size="sm" disabled={busy !== null || !policyValid} onClick={() => void run("policy", async (generation) => { const saved = await apiJson<{ policy: ExternalCheckPolicy }>(`/p/${projectId}/connections/policy`, { method: "PUT", json: policy }); if (generation !== requestGeneration.current) return; setPolicy(saved.policy); setSettings((current) => current ? { ...current, policy: saved.policy } : current); setNotice("Check policy saved for future combined previews."); })}>{busy === "policy" ? "Saving…" : "Save check policy"}</Button></div>}
      </section>}
    </CardContent>
  </Card>;
}
