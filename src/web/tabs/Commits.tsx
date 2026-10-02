import React, { useEffect, useState } from "react";
import { GitCommit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiJson } from "../api";
import { navigate, timeAgo } from "../router";

interface Commit { hash: string; message: string; author: { name: string }; committedAt: number; parents: string[] }
const PAGE = 30;

export function CommitsTab({ projectId }: { projectId: string }) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [more, setMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (offset: number) => {
    try {
      const rows = await apiJson<Commit[]>(`/p/${projectId}/commits?limit=${PAGE}&offset=${offset}`);
      setCommits((prev) => (offset === 0 ? rows : [...prev, ...rows]));
      setMore(rows.length === PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load commits");
    }
  };
  useEffect(() => {
    void load(0);
  }, [projectId]);

  return (
    <div className="space-y-3">
      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {commits.length === 0 && !error && <p className="p-4 text-sm text-muted-foreground">No commits yet</p>}
          {commits.map((c) => (
            <button key={c.hash} onClick={() => navigate(`/p/${projectId}/commit?hash=${c.hash}`)} className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/40">
              <GitCommit className="h-4 w-4 mt-1 opacity-60 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{c.message.split("\n")[0]}</div>
                <div className="text-xs text-muted-foreground">{c.author.name} · {timeAgo(c.committedAt)}{c.parents.length > 1 ? " · merge" : ""}</div>
              </div>
              <code className="text-xs text-muted-foreground">{c.hash.slice(0, 7)}</code>
            </button>
          ))}
        </CardContent>
      </Card>
      {more && commits.length > 0 && <Button variant="outline" onClick={() => void load(commits.length)}>Load more</Button>}
    </div>
  );
}
