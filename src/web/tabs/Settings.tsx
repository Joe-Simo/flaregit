import React, { useEffect, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WebhooksCard } from "../components/WebhooksCard";
import { DomainsCard } from "../components/DomainsCard";
import { apiJson } from "../api";
import { navigate } from "../router";

const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

interface Meta { id: string; role: "owner" | "member"; kind: string; name: string; source: string | null; verification: Record<string, unknown>; protectedPaths: string[] }
interface Member { user_id: string; role: string; label: string | null; added_at: string }

export function SettingsTab({ meta, reload }: { meta: Meta; reload: () => void }) {
  const isOwner = meta.role === "owner";
  const editable = meta.kind === "import";
  const v = meta.verification as { install?: string; build?: string; test?: string };
  const [install, setInstall] = useState(v.install ?? "");
  const [build, setBuild] = useState(v.build ?? "");
  const [test, setTest] = useState(v.test ?? "");
  const [paths, setPaths] = useState(meta.protectedPaths.join("\n"));
  const [members, setMembers] = useState<Member[]>([]);
  const [invite, setInvite] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);

  const loadMembers = () => apiJson<Member[]>(`/p/${meta.id}/members`).then(setMembers).catch(() => undefined);
  useEffect(() => {
    void loadMembers();
  }, [meta.id]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {message && <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{message}</div>}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Protected checks</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {editable ? (
            <>
              <p className="text-xs text-muted-foreground">Every candidate must pass these before it is accepted. Contributors cannot change them, or the protected paths below.</p>
              <label className="block text-sm"><span className="font-medium">Install</span><input className={field} disabled={!isOwner} value={install} onChange={(e) => setInstall(e.target.value)} /></label>
              <label className="block text-sm"><span className="font-medium">Build</span><input className={field} disabled={!isOwner} value={build} onChange={(e) => setBuild(e.target.value)} /></label>
              <label className="block text-sm"><span className="font-medium">Test</span><input className={field} disabled={!isOwner} value={test} onChange={(e) => setTest(e.target.value)} /></label>
              <label className="block text-sm"><span className="font-medium">Protected paths (one per line; end folders with “/”)</span><textarea className={field} rows={6} disabled={!isOwner} value={paths} onChange={(e) => setPaths(e.target.value)} /></label>
              {isOwner && (
                <Button variant="orange" disabled={busy || !test.trim()} onClick={() => guard(async () => {
                  await apiJson(`/p/${meta.id}/config`, { method: "PATCH", json: { install, build, test, protectedPaths: paths.split("\n").map((x) => x.trim()).filter(Boolean) } });
                  setMessage("Settings saved. They apply to the next integration.");
                  reload();
                })}>Save checks</Button>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">The demo repository uses fixed, platform-owned checks (ticket pricing rules and the checkout page).</p>
          )}
          {meta.source && <p className="text-xs text-muted-foreground">Imported from {meta.source}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Collaborators</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="divide-y divide-border rounded-md border border-border">
            {members.map((m) => (
              <div key={m.user_id} className="px-3 py-2 flex items-center justify-between text-sm">
                <span>{m.label ?? "Owner"}</span>
                <span className="flex items-center gap-2">
                  <Badge variant={m.role === "owner" ? "success" : "outline"}>{m.role}</Badge>
                  {isOwner && m.role !== "owner" && (
                    <Button size="sm" variant="ghost" aria-label="Remove member" disabled={busy} onClick={() => guard(async () => { await apiJson(`/p/${meta.id}/members/${m.user_id}`, { method: "DELETE" }); await loadMembers(); })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
          {isOwner && (
            <>
              <Button variant="outline" disabled={busy} onClick={() => guard(async () => { const r = await apiJson<{ url: string }>(`/p/${meta.id}/invites`, { method: "POST" }); setInvite(r.url); })}>Create invite link</Button>
              {invite && (
                <div className="flex gap-2 items-center">
                  <input readOnly className={field} value={invite} onFocus={(e) => e.currentTarget.select()} />
                  <Button variant="outline" size="icon" aria-label="Copy invite link" onClick={() => navigator.clipboard.writeText(invite)}><Copy className="h-4 w-4" /></Button>
                </div>
              )}
              {invite && <p className="text-xs text-muted-foreground">Single use, valid for 7 days. Whoever signs in with it becomes a collaborator.</p>}
            </>
          )}
        </CardContent>
      </Card>

      <WebhooksCard projectId={meta.id} isOwner={isOwner} />
      <DomainsCard projectId={meta.id} isOwner={isOwner} />

      {isOwner && (
        <Card className="border-destructive/40">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-destructive">Delete repository</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">Permanently deletes the repository, all changes, history and settings. This cannot be undone. Type <strong>{meta.name}</strong> to confirm.</p>
            <input className={field} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} aria-label="Type the repository name to confirm" />
            <Button variant="destructive" disabled={busy || confirmName !== meta.name} onClick={() => guard(async () => { await apiJson(`/p/${meta.id}`, { method: "DELETE" }); navigate("/"); })}>Delete this repository</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
