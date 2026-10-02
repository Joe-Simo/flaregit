import React, { useCallback, useEffect, useState } from "react";
import { Bot, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiJson } from "../api";
import { navigate, timeAgo } from "../router";

interface Recent { id: string; goal: string; status: string; updatedAt: string }
interface Person { kind: "human" | "agent"; name: string; handle?: string | null; role?: string; bio?: string; joinedAt?: string; changes: number; accepted: number; open: number; recent: Recent[] }

/** Contribution history: every person and agent, attributed separately, with what they actually landed. */
export function PeopleTab({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{ humans: Person[]; agents: Person[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiJson<{ humans: Person[]; agents: Person[] }>(`/p/${projectId}/people`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load people");
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive flex flex-wrap items-center justify-between gap-2">
        <span>{error}</span>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>{loading ? "Retrying…" : "Retry"}</Button>
      </div>
    );
  }
  if (!data) return <p role="status" className="text-sm text-muted-foreground">Loading people…</p>;
  const card = (p: Person) => (
    <li key={`${p.kind}:${p.name}`} className="rounded-lg border border-border p-4 space-y-2 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        {p.kind === "agent" ? <Bot className="h-4 w-4 text-sky-400" aria-hidden /> : <User className="h-4 w-4" aria-hidden />}
        <h3 className="font-semibold break-all">{p.name}</h3>
        {p.handle && <span className="text-xs text-muted-foreground break-all">@{p.handle}</span>}
        {p.role && <Badge variant="outline">{p.role}</Badge>}
        {p.kind === "agent" && <Badge variant="info">AI agent</Badge>}
      </div>
      {p.bio && <p className="text-sm text-muted-foreground break-words">{p.bio}</p>}
      <p className="text-xs text-muted-foreground">{p.accepted} accepted · {p.open} open · {p.changes} total{p.joinedAt ? ` · joined ${timeAgo(p.joinedAt)}` : ""}</p>
      {p.recent.length > 0 && (
        <ul className="text-sm space-y-1">
          {p.recent.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0">
              <button className="break-words min-w-0 hover:underline text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => navigate(`/p/${projectId}/review?task=${r.id}`)}>{r.goal}</button>
              <span className="text-xs text-muted-foreground shrink-0">{r.status} · {timeAgo(r.updatedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
  return (
    <div className="space-y-6">
      <section aria-labelledby="people-h">
        <h2 id="people-h" className="text-sm font-semibold mb-2">People</h2>
        {data.humans.length === 0 ? <p className="text-sm text-muted-foreground">No people yet.</p> : <ul className="grid gap-3 md:grid-cols-2">{data.humans.map(card)}</ul>}
      </section>
      {data.agents.length > 0 && <section aria-labelledby="agents-h"><h2 id="agents-h" className="text-sm font-semibold mb-2">Agents</h2><ul className="grid gap-3 md:grid-cols-2">{data.agents.map(card)}</ul></section>}
    </div>
  );
}
