import React, { useEffect, useState } from "react";
import { CircleCheck, CircleDot, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiJson } from "../api";
import { navigate, timeAgo } from "../router";
import { Conversation } from "../components/Conversation";

interface Issue { number: number; title: string; body: string; state: "open" | "closed"; author: string; created_at: string; updated_at: string; closed_by: string | null; comments: number }
interface IssueDetail extends Omit<Issue, "comments"> { linked: Array<{ id: string; goal: string; status: string }> }
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "issue";

export function IssuesTab({ projectId, issue }: { projectId: string; issue?: number }) {
  return issue ? <IssueView projectId={projectId} number={issue} /> : <IssueList projectId={projectId} />;
}

function IssueList({ projectId }: { projectId: string }) {
  const [state, setState] = useState<"open" | "closed">("open");
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setIssues(null); apiJson<Issue[]>(`/p/${projectId}/issues?state=${state}`).then(setIssues).catch((e: Error) => setError(e.message)); }, [projectId, state]);

  const create = async () => {
    setError(null);
    try {
      const created = await apiJson<Issue>(`/p/${projectId}/issues`, { method: "POST", json: { title, body } });
      navigate(`/p/${projectId}/issues?n=${created.number}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Issue not saved"); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 text-sm" role="tablist">
          {(["open", "closed"] as const).map((s) => (
            <button key={s} role="tab" aria-selected={state === s} className={`px-3 py-1 rounded-md capitalize ${state === s ? "bg-muted font-medium" : "text-muted-foreground"}`} onClick={() => setState(s)}>{s}</button>
          ))}
        </div>
        <Button size="sm" variant="orange" onClick={() => setComposing((v) => !v)}><Plus className="h-3.5 w-3.5 mr-1.5" /> New issue</Button>
      </div>
      {composing && (
        <div className="rounded-lg border border-border p-3 space-y-2">
          <input className={field} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Issue title" />
          <textarea className={field} rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What should change, and why? Agents working on a linked change read this." aria-label="Issue description" />
          <Button size="sm" disabled={!title.trim()} onClick={create}>Open issue</Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!issues && <p className="text-sm text-muted-foreground">Loading issues…</p>}
      {issues && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {issues.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No {state} issues.</li>}
          {issues.map((i) => (
            <li key={i.number}>
              <button className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-muted/40" onClick={() => navigate(`/p/${projectId}/issues?n=${i.number}`)}>
                {i.state === "open" ? <CircleDot className="h-4 w-4 mt-0.5 text-emerald-400 shrink-0" aria-label="open" /> : <CircleCheck className="h-4 w-4 mt-0.5 text-purple-400 shrink-0" aria-label="closed" />}
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{i.title}</span>
                  <span className="block text-xs text-muted-foreground">#{i.number} by {i.author} · updated {timeAgo(i.updated_at)}{i.comments ? ` · ${i.comments} comment${i.comments === 1 ? "" : "s"}` : ""}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IssueView({ projectId, number }: { projectId: string; number: number }) {
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => apiJson<IssueDetail>(`/p/${projectId}/issues/${number}`).then(setIssue).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, [projectId, number]);

  const toggle = async () => {
    if (!issue) return;
    await apiJson(`/p/${projectId}/issues/${number}`, { method: "PATCH", json: { state: issue.state === "open" ? "closed" : "open" } }).catch((e: Error) => setError(e.message));
    void load();
  };
  const startChange = async (agent: boolean) => {
    if (!issue) return;
    setError(null);
    try {
      const taskId = `${slug(issue.title)}-${Math.random().toString(36).slice(2, 6)}`;
      await apiJson(`/p/${projectId}/tasks`, { method: "POST", json: { taskId, goal: issue.title, issue: number } });
      if (agent) await apiJson(`/p/${projectId}/tasks/${taskId}/agent`, { method: "POST" });
      navigate(`/p/${projectId}/changes`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not start a change"); }
  };

  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (!issue) return <p className="text-sm text-muted-foreground">Loading issue…</p>;
  return (
    <div className="space-y-4 max-w-3xl">
      <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => navigate(`/p/${projectId}/issues`)}>← All issues</button>
      <div>
        <h2 className="text-lg font-semibold">{issue.title} <span className="text-muted-foreground font-normal">#{issue.number}</span></h2>
        <p className="text-xs text-muted-foreground">
          <Badge variant={issue.state === "open" ? "success" : "purple"}>{issue.state}</Badge> opened by {issue.author} {timeAgo(issue.created_at)}
          {issue.closed_by && issue.state === "closed" ? ` · closed by ${issue.closed_by}` : ""}
        </p>
      </div>
      {issue.body && <p className="text-sm whitespace-pre-wrap break-words rounded-md border border-border p-3">{issue.body}</p>}
      <div className="flex flex-wrap gap-2">
        {issue.state === "open" && <Button size="sm" variant="orange" onClick={() => startChange(false)}>Start a change</Button>}
        {issue.state === "open" && <Button size="sm" variant="outline" onClick={() => startChange(true)}>Ask an agent</Button>}
        <Button size="sm" variant="ghost" onClick={toggle}>{issue.state === "open" ? "Close issue" : "Reopen"}</Button>
      </div>
      {issue.linked.length > 0 && (
        <div className="text-sm">
          <h3 className="font-semibold mb-1">Changes for this issue</h3>
          <ul className="space-y-1">{issue.linked.map((t) => <li key={t.id}><button className="hover:underline" onClick={() => navigate(`/p/${projectId}/review?task=${t.id}`)}>{t.goal}</button> <span className="text-xs text-muted-foreground">{t.status}</span></li>)}</ul>
        </div>
      )}
      <Conversation projectId={projectId} subject={`issue:${number}`} />
    </div>
  );
}
