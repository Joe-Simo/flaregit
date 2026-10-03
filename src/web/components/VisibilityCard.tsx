import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiJson } from "../api";

export function VisibilityCard({ projectId, visibility, publicationBlocked = false, reload }: { projectId: string; visibility: "private" | "public"; publicationBlocked?: boolean; reload: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const change = async () => {
    if (publicationBlocked && visibility === "private") return;
    setBusy(true); setError(null); setNotice(null);
    try {
      await apiJson(`/p/${projectId}/visibility`, { method: "POST", json: visibility === "public" ? { visibility: "private" } : { visibility: "public", confirmed: true } });
      setConfirmed(false); setNotice(visibility === "public" ? "Repository made private. Previously downloaded copies cannot be recalled." : "Accepted source and history are now public."); reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not change repository visibility"); }
    finally { setBusy(false); }
  };
  return <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Repository visibility</CardTitle></CardHeader><CardContent className="space-y-3 text-sm">
    <p className="text-muted-foreground">{publicationBlocked ? "Public access is unavailable. Collaborators retain private repository access." : visibility === "public" ? "Anyone can browse the accepted source and commit history without signing in. Workspaces, credentials, and repository settings remain private." : "Only repository collaborators can browse this repository."}</p>
    {visibility === "public" && !publicationBlocked ? <a href={`/#/public/${encodeURIComponent(projectId)}`} className="inline-block underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open public repository</a> : visibility === "private" ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} disabled={busy || publicationBlocked} onChange={(event) => setConfirmed(event.target.checked)} /><span>I understand that making this repository public publishes its entire accepted source and commit history, including contributor attribution.</span></label> : null}
    <div><Button size="sm" variant="outline" disabled={busy || (visibility === "private" && (publicationBlocked || !confirmed))} onClick={() => void change()}>{busy ? "Saving visibility…" : visibility === "public" ? "Make private" : "Publish accepted repository"}</Button></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}{notice && <p role="status" className="text-muted-foreground">{notice}</p>}
  </CardContent></Card>;
}
