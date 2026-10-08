import {RepositoryNotifications} from "../components/RepositoryNotifications";
import {InviteManagement} from "../components/InviteManagement";
import {GitCredentialRevocation} from "../components/GitCredentialRevocation";
import { StorageReconciliation } from "../components/StorageReconciliation";
import {PrivateGitRecovery} from "../components/PrivateGitRecovery";
import React, { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WebhooksCard } from "../components/WebhooksCard";
import { DeploymentCard } from "../components/DeploymentCard";
import { DomainsCard } from "../components/DomainsCard";
import { isCommandPolicy } from "@/core/command-policy";
import { PublicCommunityCard } from "../components/PublicCommunityCard";
import { VisibilityCard } from "../components/VisibilityCard";
import { ConnectionsCard } from "../components/ConnectionsCard";
import { ImportHistoryCard } from "../components/ImportHistoryCard";
import { MirrorCard } from "../components/MirrorCard";
import { apiJson } from "../api";
import { navigate } from "../router";

const RepositoryApplications=lazy(async()=>({default:(await import("../components/RepositoryApplications")).RepositoryApplications}));
const MetadataArchiveCard=lazy(async()=>({default:(await import("../components/MetadataArchiveCard")).MetadataArchiveCard}));
const ConversationMigrationCard=lazy(async()=>({default:(await import("../components/ConversationMigrationCard")).ConversationMigrationCard}));
const ReviewPolicySettings=lazy(async()=>({default:(await import("../components/ReviewPolicySettings")).ReviewPolicySettings}));
const AgentCleanupRecovery=lazy(async()=>({default:(await import("../components/AgentCleanupRecovery")).AgentCleanupRecovery}));

const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const alertCls = "rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive";
const okCls = "rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200";
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

interface Meta { id: string; role: "owner" | "member"; kind: string; name: string; source: string | null; verification: Record<string, unknown>; protectedPaths: string[]; visibility?: "private" | "public"; moderation?: { suppressed: boolean; reason: string; reportId: string; version: number } }
interface Member { user_id: string; role: string; label: string | null; added_at: string }
type Busy = null | "save" | "delete" | `remove:${string}`;

export function SettingsTab({ meta, reload }: { meta: Meta; reload: () => void }) {
  const isOwner = meta.role === "owner";
  const editable = meta.kind === "import";
  const v = meta.verification as { install?: string; build?: string; test?: string };
  const [install, setInstall] = useState(v.install ?? "");
  const [build, setBuild] = useState(v.build ?? "");
  const [test, setTest] = useState(v.test ?? "");
  const [landing, setLanding] = useState<"merge" | "squash">((meta.verification as { landing?: string }).landing === "squash" ? "squash" : "merge");
  const [paths, setPaths] = useState(meta.protectedPaths.join("\n"));
  const [members, setMembers] = useState<Member[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState<Busy>(null);

  const loadMembers = useCallback(async () => {
    setMembersError(null);
    try {
      setMembers(await apiJson<Member[]>(`/p/${meta.id}/members`));
    } catch (e) {
      setMembersError(errText(e, "Could not load collaborators"));
    }
  }, [meta.id]);
  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const guard = async (label: Exclude<Busy, null>, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e, "Something went wrong"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl min-w-0">
      <h2 className="sr-only">Repository settings</h2>
      <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Your repository notifications</p><RepositoryNotifications key={meta.id} projectId={meta.id} projectName={meta.name}/></div>
      <Suspense fallback={<p role="status" className="text-xs text-muted-foreground">Loading app access…</p>}><RepositoryApplications key={`apps:${meta.id}`} projectId={meta.id}/></Suspense>
      <Suspense fallback={<p role="status" className="text-xs text-muted-foreground">Loading metadata archive…</p>}><MetadataArchiveCard key={`metadata-archive:${meta.id}`} projectId={meta.id} isOwner={isOwner}/></Suspense>
      <GitCredentialRevocation key={`git-credentials:${meta.id}`} projectId={meta.id}/>
      {isOwner&&<Suspense fallback={<p role="status" className="text-xs text-muted-foreground">Loading review settings…</p>}><ReviewPolicySettings key={`review-policy:${meta.id}`} projectId={meta.id}/></Suspense>}
      {isOwner&&<Suspense fallback={null}><AgentCleanupRecovery key={`agent-cleanup:${meta.id}`} projectId={meta.id}/></Suspense>}
      {error && <div role="alert" className={alertCls}>{error}</div>}
      {message && <div role="status" className={okCls}>{message}</div>}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Protected checks</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {editable ? (
            <>
              <p className="text-xs text-muted-foreground">Every candidate must pass these before it is accepted. Contributors cannot change them, or the protected paths below.</p>
              <label className="block text-sm"><span className="font-medium">Install</span><input className={field} disabled={!isOwner} value={install} onChange={(e) => setInstall(e.target.value)} /></label>
              <label className="block text-sm"><span className="font-medium">Build</span><input className={field} disabled={!isOwner} value={build} onChange={(e) => setBuild(e.target.value)} /></label>
              <label className="block text-sm"><span className="font-medium">Test</span><input className={field} disabled={!isOwner} value={test} onChange={(e) => setTest(e.target.value)} /></label>
              <label className="block text-sm"><span className="font-medium">Landing</span>
                <select className={field} disabled={!isOwner} value={landing} onChange={(e) => setLanding(e.target.value === "squash" ? "squash" : "merge")}>
                  <option value="merge">Merge commit per change (keeps each contributor's commits)</option>
                  <option value="squash">Squash into one commit (co-authors credited)</option>
                </select>
              </label>
              <label className="block text-sm"><span className="font-medium">Protected paths (one per line; end folders with “/”)</span><textarea className={field} rows={6} disabled={!isOwner} value={paths} onChange={(e) => setPaths(e.target.value)} /></label>
              {isOwner && (
                <Button variant="orange" disabled={busy !== null || !test.trim()} onClick={() => guard("save", async () => {
                  await apiJson(`/p/${meta.id}/config`, { method: "PATCH", json: { install, build, test, landing, protectedPaths: paths.split("\n").map((x) => x.trim()).filter(Boolean) } });
                  setMessage("Settings saved. They apply to the next integration.");
                  reload();
                })}>{busy === "save" ? "Saving…" : "Save checks"}</Button>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">The demo repository uses fixed, platform-owned checks (ticket pricing rules and the checkout page).</p>
          )}
          {meta.source && <p className="text-xs text-muted-foreground break-all">Imported from {meta.source}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Collaborators</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {membersError && (
            <div role="alert" className={`${alertCls} flex flex-wrap items-center justify-between gap-2`}>
              <span>{membersError}</span>
              <Button size="sm" variant="outline" onClick={() => void loadMembers()}>Retry</Button>
            </div>
          )}
          {!members && !membersError && <p role="status" className="text-sm text-muted-foreground">Loading collaborators…</p>}
          {members && (
            <div className="divide-y divide-border rounded-md border border-border">
              {members.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No collaborators yet</p>}
              {members.map((m) => (
                <div key={m.user_id} className="px-3 py-2 flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 break-all">{m.label ?? "Owner"}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <Badge variant={m.role === "owner" ? "success" : "outline"}>{m.role}</Badge>
                    {isOwner && m.role !== "owner" && (
                      <Button size="sm" variant="ghost" aria-label={`Remove ${m.label ?? "member"}`} disabled={busy !== null} onClick={() => guard(`remove:${m.user_id}`, async () => {
                        await apiJson(`/p/${meta.id}/members/${m.user_id}`, { method: "DELETE" });
                        setMessage("Collaborator removed.");
                        await loadMembers();
                      })}>
                        {busy === `remove:${m.user_id}` ? "Removing…" : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

        </CardContent>
      </Card>

      {isOwner && <InviteManagement key={`invitations:${meta.id}`} projectId={meta.id} isOwner/>}
      {isOwner && meta.moderation?.suppressed && <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Public repository unavailable</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p className="whitespace-pre-wrap break-words">{meta.moderation.reason}</p><p className="text-xs text-muted-foreground break-all">Report {meta.moderation.reportId}</p><p className="text-xs text-muted-foreground">Private Git, reviews, and collaborator access remain available.</p><a className="inline-block underline underline-offset-4" href={`/#/report?signin=1&target=${encodeURIComponent(`/#/public/${meta.id}`)}`}>Appeal this decision</a></CardContent></Card>}
      {isOwner && <VisibilityCard key={`visibility:${meta.id}`} projectId={meta.id} visibility={meta.visibility ?? "private"} publicationBlocked={meta.moderation?.suppressed} reload={reload} />}
      {isOwner && <PublicCommunityCard key={`community:${meta.id}`} projectId={meta.id} isPublic={meta.visibility === "public"} publicationBlocked={meta.moderation?.suppressed} />}
      {isOwner && <ConnectionsCard key={`connections:${meta.id}`} projectId={meta.id} isOwner={isOwner} isCustom={meta.kind === "import" && isCommandPolicy(meta.verification)} />}
      {isOwner && <DeploymentCard key={`deployments:${meta.id}`} projectId={meta.id} />}
      <div id="deployment-deliveries"><WebhooksCard projectId={meta.id} isOwner={isOwner} /></div>
      <PrivateGitRecovery projectId={meta.id} isOwner={isOwner} />
      {isOwner && <StorageReconciliation projectId={meta.id} />}
      <DomainsCard projectId={meta.id} isOwner={isOwner} />
      {isOwner&&meta.kind==="import"&&meta.source?.startsWith("https://github.com/")&&<Suspense fallback={<p role="status" className="text-xs text-muted-foreground">Loading saved conversation migration…</p>}><ConversationMigrationCard key={`conversation-migration:${meta.id}`} projectId={meta.id}/></Suspense>}
      {isOwner && meta.kind === "import" && <ImportHistoryCard key={`import-history:${meta.id}`} projectId={meta.id} />}
      {isOwner && <MirrorCard projectId={meta.id} isOwner={isOwner} />}

      {isOwner && (
        <Card className="border-destructive/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-destructive">Delete repository</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground break-words">Permanently deletes the repository, all changes, history and settings. This cannot be undone. Type <strong>{meta.name}</strong> to confirm.</p>
            <input className={field} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} aria-label="Type the repository name to confirm" />
            <Button variant="destructive" disabled={busy !== null || confirmName !== meta.name} onClick={() => guard("delete", async () => { const result = await apiJson<{ deleted: string | false; status?: string; detail?: string }>(`/p/${meta.id}`, { method: "DELETE" }); if (result.deleted === false) throw new Error(result.detail ?? "Repository cleanup is pending. Retry deletion."); navigate("/"); })}>
              {busy === "delete" ? "Deleting…" : "Delete this repository"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
