import React, { useEffect, useState } from "react";
import { Bot, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiJson } from "../api";
import { navigate, timeAgo } from "../router";

interface Recent { id: string; goal: string; status: string; updatedAt: string }
interface Person { kind: "human" | "agent"; name: string; handle?: string | null; role?: string; bio?: string; joinedAt?: string; changes: number; accepted: number; open: number; recent: Recent[] }

/** Contribution history: every person and agent, attributed separately, with what they actually landed. */
export function PeopleTab({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{ humans: Person[]; agents: Person[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { apiJson<{ humans: Person[]; agents: Person[] }>(`/p/${projectId}/people`).then(setData).catch((e: Error) => setError(e.message)); }, [projectId]);

  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Loading people…</p>;
  const card = (p: Person) => (
    <li key={`${p.kind}:${p.name}`} className="rounded-lg border border-border p-4 space-y-2">
      <div className="flex items-center gap-2">
        {p.kind === "agent" ? <Bot className="h-4 w-4 text-sky-400" aria-hidden /> : <User className="h-4 w-4" aria-hidden />}
        <span className="font-semibold">{p.name}</span>
        {p.handle && <span className="text-xs text-muted-foreground">@{p.handle}</span>}
        {p.role && <Badge variant="outline">{p.role}</Badge>}
        {p.kind === "agent" && <Badge variant="info">AI agent</Badge>}
      </div>
      {p.bio && <p className="text-sm text-muted-foreground">{p.bio}</p>}
      <p className="text-xs text-muted-foreground">{p.accepted} accepted · {p.open} open · {p.changes} total{p.joinedAt ? ` · joined ${timeAgo(p.joinedAt)}` : ""}</p>
      {p.recent.length > 0 && (
        <ul className="text-sm space-y-1">
          {p.recent.map((r) => (
            <li key={r.id} className="flex items-center gap-2 min-w-0">
              <button className="truncate hover:underline text-left" onClick={() => navigate(`/p/${projectId}/review?task=${r.id}`)}>{r.goal}</button>
              <span className="text-xs text-muted-foreground shrink-0">{r.status} · {timeAgo(r.updatedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
  return (
    <div className="space-y-6">
      <section aria-labelledby="people-h"><h2 id="people-h" className="text-sm font-semibold mb-2">People</h2><ul className="grid gap-3 md:grid-cols-2">{data.humans.map(card)}</ul></section>
      {data.agents.length > 0 && <section aria-labelledby="agents-h"><h2 id="agents-h" className="text-sm font-semibold mb-2">Agents</h2><ul className="grid gap-3 md:grid-cols-2">{data.agents.map(card)}</ul></section>}
    </div>
  );
}
