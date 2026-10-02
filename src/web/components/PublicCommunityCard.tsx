import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { navigate } from "../router";
import { apiJson } from "../api";
import type { PublicCommunityPolicy, PublicCommunityScope, ContributionRequest } from "@/server/public-community";
const scopeNames: Record<PublicCommunityScope, string> = { discussions: "Public discussions", issues: "Public issues", "contribution-requests": "Contribution requests" };
export function PublicCommunityCard({ projectId, isPublic }: { projectId: string; isPublic: boolean }) {
  const generation = useRef(0);
  const mutating = useRef(false);
  const [loading, setLoading] = useState(false);
  const [policy, setPolicy] = useState<PublicCommunityPolicy | null>(null);
  const [requests, setRequests] = useState<ContributionRequest[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [accessConfirmed, setAccessConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (mutating.current) return;
    let active = true; const requestGeneration = ++generation.current; setLoading(true);
    void Promise.allSettled([apiJson<{ policy: PublicCommunityPolicy }>(`/p/${projectId}/community`), apiJson<{ requests: ContributionRequest[] }>(`/p/${projectId}/community/requests`)]).then(([settings, inbox]) => {
      if (!active || requestGeneration !== generation.current) return;
      setLoading(false);
      if (settings.status === "fulfilled") setPolicy((draft) => draft ?? settings.value.policy);
      if (inbox.status === "fulfilled") setRequests(inbox.value.requests);
      setError(settings.status === "rejected" || inbox.status === "rejected" ? "Some community data could not load. Previously loaded rows may be outdated." : null);
    });
    return () => { active = false; };
  }, [projectId, revision]);
  const act = async (id: string, operation: (requestGeneration: number) => Promise<void>) => {
    if (mutating.current) return;
    const requestGeneration = ++generation.current; mutating.current = true; setLoading(false);
    setBusy(id); setError(null); setNotice(null);
    try { await operation(requestGeneration); }
    catch (cause) { if (requestGeneration === generation.current) setError(cause instanceof Error ? cause.message : "Community request failed"); }
    finally { if (requestGeneration === generation.current) { mutating.current = false; setBusy(null); } }
  };
  return <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Public participation</CardTitle></CardHeader><CardContent className="space-y-4 text-sm">
    <p className="text-muted-foreground">Enable new public discussions and issues separately. Existing private issues, comments, tasks, and conversations are never published by this control.</p>
    {isPublic && <Button size="sm" variant="ghost" onClick={() => navigate(`/participate/${projectId}`)}>Manage public posts</Button>}
    {!isPublic && <p className="text-muted-foreground">Make accepted source and history public before enabling public participation.</p>}
    {error && <div role="alert" className="text-destructive"><p>{error}</p></div>}
    {notice && <p role="status" className="text-muted-foreground">{notice}</p>}
    <Button size="sm" variant="ghost" disabled={busy !== null || loading} onClick={() => { if (!mutating.current) setRevision((value) => value + 1); }}>{loading ? "Refreshing…" : "Refresh community"}</Button>
    {!policy && !error && <p role="status" className="text-muted-foreground">Loading participation settings…</p>}
    {policy && <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void act("save", async (requestGeneration) => { const saved = await apiJson<{ policy: PublicCommunityPolicy }>(`/p/${projectId}/community`, { method: "PUT", json: { policy, confirmed: policy.enabled ? confirmed : false } }); if (requestGeneration !== generation.current) return; setPolicy(saved.policy); setConfirmed(false); setNotice("Public participation settings saved."); }); }}>
      <label className="flex items-center gap-2"><input type="checkbox" checked={policy.enabled} disabled={!isPublic || busy !== null} onChange={(event) => { setPolicy({ ...policy, enabled: event.target.checked }); setConfirmed(false); }} />Enable public participation</label>
      <fieldset className="space-y-2"><legend className="sr-only">Enabled public scopes</legend>{(Object.keys(scopeNames) as PublicCommunityScope[]).map((scope) => <label key={scope} className="flex gap-2 items-center"><input type="checkbox" checked={policy.scopes.includes(scope)} disabled={!isPublic || busy !== null || !policy.enabled} onChange={() => { setPolicy({ ...policy, scopes: policy.scopes.includes(scope) ? policy.scopes.filter((value) => value !== scope) : [...policy.scopes, scope] }); setConfirmed(false); }} />{scopeNames[scope]}</label>)}</fieldset>
      {policy.enabled && <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmed} disabled={busy !== null} onChange={(event) => setConfirmed(event.target.checked)} /><span>I confirm that new records in these scopes are public. Approving a contribution request separately grants private repository access.</span></label>}
      <Button size="sm" variant="outline" type="submit" disabled={busy !== null || (policy.enabled && (!isPublic || !confirmed || policy.scopes.length === 0))}>{busy === "save" ? "Saving…" : "Save participation"}</Button>
    </form>}
    {requests && <section className="border-t border-border pt-4"><h3 className="text-sm font-medium mb-2">Contribution requests</h3><ul className="divide-y divide-border">{requests.map((request) => <li key={request.id} className="py-3 space-y-2"><p className="font-medium">{request.requesterName} <span className="font-normal text-muted-foreground">· {request.status}</span></p><p className="whitespace-pre-wrap break-words">{request.purpose}</p>{request.status === "requested" && <><label className="flex gap-2 items-start text-xs"><input className="mt-0.5" type="checkbox" disabled={busy !== null} checked={accessConfirmed[request.id] ?? false} onChange={(event) => setAccessConfirmed({ ...accessConfirmed, [request.id]: event.target.checked })} /><span>Approval grants access to private issues, tasks, and shared repository context.</span></label><div className="flex gap-2">{(["approved", "rejected"] as const).map((decision) => <Button key={decision} size="sm" variant="outline" aria-label={`${decision === "approved" ? "Approve private access for" : "Reject contribution request from"} ${request.requesterName}`} disabled={!isPublic || loading || busy !== null || (decision === "approved" && !accessConfirmed[request.id])} onClick={() => void act(request.id, async (requestGeneration) => { const saved = await apiJson<{ request: ContributionRequest }>(`/p/${projectId}/community/requests/${request.id}/decision`, { method: "POST", json: { decision, ...(decision === "approved" ? { confirmedPrivateAccess: true } : {}) } }); if (requestGeneration !== generation.current) return; setRequests((previous) => previous?.map((item) => item.id === saved.request.id ? saved.request : item) ?? null); setNotice(`Contribution request ${decision}. Historical approval does not regrant revoked access.`); })}>{busy === request.id ? "Saving…" : decision === "approved" ? "Approve private access" : "Reject request"}</Button>)}</div></>}</li>)}{requests.length === 0 && <li className="text-muted-foreground text-sm py-2">No contribution requests.</li>}</ul></section>}
  </CardContent></Card>;
}
