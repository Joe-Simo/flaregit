import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { apiJson } from "../api";
import { timeAgo } from "../router";

interface Row { id: number; at: string; actor: string; type: string; summary: string }

export function ActivityTab({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    const load = () => apiJson<Row[]>(`/p/${projectId}/activity`).then(setRows).catch(() => undefined);
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [projectId]);
  return (
    <Card>
      <CardContent className="p-0 divide-y divide-border">
        {rows === null && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
        {rows?.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nothing has happened yet</p>}
        {rows?.map((r) => (
          <div key={r.id} className="px-4 py-2.5 flex justify-between gap-4 text-sm">
            <span>{r.summary}</span>
            <span className="text-xs text-muted-foreground shrink-0">{timeAgo(r.at)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
