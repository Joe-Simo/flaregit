import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiJson } from "../api";
import { timeAgo } from "../router";
import { useVisiblePolling } from "../use-visible-polling";

interface Row { id: number; at: string; actor: string; type: string; summary: string }

export function ActivityTab({ projectId }: { projectId: string }) {
  const [loaded, setLoaded] = useState<{ projectId: string; rows: Row[] } | null>(null);
  const rows = loaded?.projectId === projectId ? loaded.rows : null;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setLoaded(null); setError(null);
  }, [projectId]);
  const refresh = useVisiblePolling({
    scope: projectId,
    intervalMs: 8000,
    read: signal => apiJson<Row[]>(`/p/${projectId}/activity`, { signal }),
    onValue: value => { setLoaded({ projectId, rows: value }); setError(null); },
    onError: cause => setError(cause instanceof Error ? cause.message : "Activity is unavailable"),
  });
  return (
    <Card>
      <CardContent className="p-0 divide-y divide-border">
        {error && <div role="alert" className="p-4 text-sm text-destructive"><p>Could not load activity: {error}{rows !== null && " Showing the last loaded activity."}</p><Button size="sm" variant="outline" className="mt-2" onClick={() => void refresh()}>Retry activity</Button></div>}
        {rows === null && !error && <p role="status" className="p-4 text-sm text-muted-foreground">Loading activity…</p>}
        {rows?.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing has happened yet.</p>}
        {rows?.map((r) => (
          <div key={r.id} className="px-4 py-2.5 flex justify-between gap-4 text-sm">
            <span className="min-w-0 break-words">{r.summary}</span>
            <span className="text-xs text-muted-foreground shrink-0">{timeAgo(r.at)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
