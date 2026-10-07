import {FrozenAttribution} from '../components/FrozenAttribution';
import type {FrozenContributionAttribution} from '@/core/types';
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bot, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiJson } from "../api";
import { navigate, timeAgo } from "../router";

interface AcceptedContribution {candidateId:string;acceptedCommit:string;acceptedAt:string;attribution:FrozenContributionAttribution[]|null}
interface Recent { id: string; goal: string; status: string; updatedAt: string }
interface Person { id?: string; kind: "human" | "agent"; name: string; handle?: string | null; role?: string; bio?: string; joinedAt?: string; changes: number; accepted: number; open: number; recent: Recent[] }

/** Contribution history: every person and agent, attributed separately, with what they actually landed. */
export function PeopleTab({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{ humans: Person[]; agents: Person[];unattributed?:Recent[];acceptedContributions?:AcceptedContribution[] } | null>(null);
  const [loadedProject,setLoadedProject]=useState<string|null>(null);
  const generation=useRef(0),request=useRef<AbortController|null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    request.current?.abort();const controller=new AbortController();request.current=controller;const current=++generation.current;
    setLoading(true);
    setError(null);
    try {
      const next=await apiJson<{ humans: Person[]; agents: Person[];unattributed?:Recent[];acceptedContributions?:AcceptedContribution[] }>(`/p/${projectId}/people`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});if(current===generation.current){setData(next);setLoadedProject(projectId);}
    } catch (e) {
      if(current===generation.current&&!controller.signal.aborted)setError(e instanceof Error ? e.message : "Could not load people");
    } finally {
      if(current===generation.current)setLoading(false);
    }
  }, [projectId]);
  useEffect(() => { setData(null);setLoadedProject(null);void load();return()=>{generation.current++;request.current?.abort();}; }, [load]);

  if (error) {
    return (
      <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive flex flex-wrap items-center justify-between gap-2">
        <span>{error}</span>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>{loading ? "Retrying…" : "Retry"}</Button>
      </div>
    );
  }
  if (!data||loadedProject!==projectId) return <p role="status" className="text-sm text-muted-foreground">Loading people…</p>;
  const card = (p: Person) => (
    <li key={`${p.kind}:${p.id ?? p.name}`} className="rounded-lg border border-border p-4 space-y-2 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        {p.kind === "agent" ? <Bot className="h-4 w-4 text-sky-400" aria-hidden /> : <User className="h-4 w-4" aria-hidden />}
        <h3 className="font-semibold break-all">{p.name}</h3>
        {p.handle && <span className="text-xs text-muted-foreground break-all">@{p.handle}</span>}
        {p.role && <Badge variant="outline">{p.role}</Badge>}
        {p.kind === "agent" && <Badge variant="info">AI agent</Badge>}
      </div>
      {p.bio && <p className="text-sm text-muted-foreground break-words">{p.bio}</p>}
      <p className="text-xs text-muted-foreground">{p.accepted} accepted · {p.open} open · {p.changes} total{p.joinedAt ? ` · joined ${timeAgo(p.joinedAt)}` : ""}</p>
      {p.recent.some(r=>r.status!=="accepted") && (
        <ul className="text-sm space-y-1">
          {p.recent.filter(r=>r.status!=="accepted").map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0">
              <button className="break-words min-w-0 hover:underline text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => navigate(`/p/${projectId}/review?task=${encodeURIComponent(r.id)}`)}>{r.goal}</button>
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
      {data.unattributed&&data.unattributed.some(change=>change.status!=="accepted")&&<section aria-labelledby="people-unknown"><h2 id="people-unknown" className="text-sm font-semibold mb-2">Unattributed contributions</h2><p className="text-xs text-muted-foreground mb-3">These changes cannot be attributed to a current repository member. Their recorded history is preserved.</p><ul className="space-y-2">{data.unattributed.filter(change=>change.status!=="accepted").map(change=><li key={change.id} className="text-sm"><Button variant="link" className="p-0 h-auto whitespace-normal text-left" onClick={()=>navigate(`/p/${projectId}/review?task=${encodeURIComponent(change.id)}`)}>{change.goal}</Button><span className="ml-2 text-xs text-muted-foreground">{change.status}</span></li>)}</ul></section>}
      {data.acceptedContributions&&data.acceptedContributions.length>0&&<section aria-labelledby="people-accepted"><h2 id="people-accepted" className="text-sm font-semibold mb-2">Accepted contribution history</h2><ul className="space-y-3">{data.acceptedContributions.map(entry=><li key={`${entry.candidateId}:${entry.acceptedCommit}`} className="text-sm space-y-2"><a className="text-primary underline-offset-4 hover:underline" href={`#/p/${projectId}/review?candidate=${encodeURIComponent(entry.candidateId)}`}><code title={entry.acceptedCommit}>{entry.acceptedCommit.slice(0,12)}</code></a><span className="ml-2 text-xs text-muted-foreground">Accepted {timeAgo(entry.acceptedAt)}</span>{entry.attribution?<ul className="space-y-2">{entry.attribution.map(snapshot=><li key={`${snapshot.taskId}:${snapshot.commit}`} className="space-y-1"><a className="break-words text-primary underline-offset-4 hover:underline" href={`#/p/${projectId}/review?candidate=${encodeURIComponent(entry.candidateId)}&input=${encodeURIComponent(snapshot.taskId)}`}>{snapshot.goal}</a><div className="text-xs"><code title={snapshot.commit} className="mr-2">{snapshot.commit.slice(0,7)}</code><FrozenAttribution snapshot={snapshot}/></div></li>)}</ul>:<p className="text-xs text-muted-foreground">Historical attribution unavailable</p>}</li>)}</ul></section>}
      {data.agents.length > 0 && <section aria-labelledby="agents-h"><h2 id="agents-h" className="text-sm font-semibold mb-2">Agents</h2><ul className="grid gap-3 md:grid-cols-2">{data.agents.map(card)}</ul></section>}
    </div>
  );
}
