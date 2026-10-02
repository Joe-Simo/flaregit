import React, { useCallback, useEffect, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WebhooksCard } from "../components/WebhooksCard";
import { DomainsCard } from "../components/DomainsCard";
import { isCommandPolicy } from "@/core/command-policy";
import { VisibilityCard } from "../components/VisibilityCard";
import { ConnectionsCard } from "../components/ConnectionsCard";
import { MirrorCard } from "../components/MirrorCard";
import { apiJson } from "../api";
import { navigate } from "../router";

const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const alertCls = "rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive";
const okCls = "rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200";
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

interface Meta { id: string; role: "owner" | "member"; kind: string; name: string; source: string | null; verification: Record<string, unknown>; protectedPaths: string[]; visibility?: "private" | "public" }
interface Member { user_id: string; role: string; label: string | null; added_at: string }
type Busy = null | "save" | "invite" | "delete" | `remove:${string}`;

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
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
          {isOwner && (
            <>
              <Button variant="outline" disabled={busy !== null} onClick={() => guard("invite", async () => { const r = await apiJson<{ url: string }>(`/p/${meta.id}/invites`, { method: "POST" }); setInvite(r.url); setCopied(false); })}>
                {busy === "invite" ? "Creating…" : "Create invite link"}
              </Button>
              {invite && (
                <div className="flex gap-2 items-center">
                  <label className="sr-only" htmlFor="invite-link">Invite link</label>
                  <input id="invite-link" readOnly className={field} value={invite} onFocus={(e) => e.currentTarget.select()} />
                  <Button variant="outline" size="icon" aria-label="Copy invite link" onClick={() => {
                    navigator.clipboard.writeText(invite).then(() => setCopied(true), () => setError("Could not copy to the clipboard. Select the link and copy it manually."));
                  }}><Copy className="h-4 w-4" /></Button>
                </div>
              )}
              {copied && <p role="status" className="text-xs text-emerald-300">Invite link copied.</p>}
              {invite && <p className="text-xs text-muted-foreground">Single use, valid for 7 days. Whoever signs in with it becomes a collaborator.</p>}
            </>
          )}
        </CardContent>
      </Card>

      {isOwner && <VisibilityCard key={meta.id} projectId={meta.id} visibility={meta.visibility ?? "private"} reload={reload} />}
      {isOwner && <ConnectionsCard key={meta.id} projectId={meta.id} isOwner={isOwner} isCustom={meta.kind === "import" && isCommandPolicy(meta.verification)} />}
      <WebhooksCard projectId={meta.id} isOwner={isOwner} />
      <DomainsCard projectId={meta.id} isOwner={isOwner} />
      {isOwner && <MirrorCard projectId={meta.id} isOwner={isOwner} />}

      {isOwner && (
        <Card className="border-destructive/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-destructive">Delete repository</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground break-words">Permanently deletes the repository, all changes, history and settings. This cannot be undone. Type <strong>{meta.name}</strong> to confirm.</p>
            <input className={field} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} aria-label="Type the repository name to confirm" />
            <Button variant="destructive" disabled={busy !== null || confirmName !== meta.name} onClick={() => guard("delete", async () => { await apiJson(`/p/${meta.id}`, { method: "DELETE" }); navigate("/"); })}>
              {busy === "delete" ? "Deleting…" : "Delete this repository"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
