import React, { useCallback, useEffect, useState } from "react";
import { CircleCheck, CircleDot, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiJson } from "../api";
import { navigate, timeAgo } from "../router";
import { Conversation } from "../components/Conversation";

interface Issue { number: number; title: string; body: string; state: "open" | "closed"; author: string; created_at: string; updated_at: string; closed_by: string | null; comments: number }
interface IssueDetail extends Omit<Issue, "comments"> { linked: Array<{ id: string; goal: string; status: string }> }
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const alertCls = "rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive";
const okCls = "rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200";
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "issue";

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className={`${alertCls} flex flex-wrap items-center justify-between gap-2`}>
      <span className="break-words min-w-0">{message}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
    </div>
  );
}

export function IssuesTab({ projectId, issue }: { projectId: string; issue?: number }) {
  return issue ? <IssueView projectId={projectId} number={issue} /> : <IssueList projectId={projectId} />;
}

function IssueList({ projectId }: { projectId: string }) {
  const [state, setState] = useState<"open" | "closed">("open");
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setIssues(null);
    setLoadError(null);
    try {
      setIssues(await apiJson<Issue[]>(`/p/${projectId}/issues?state=${state}`));
    } catch (e) {
      setLoadError(errText(e, "Could not load issues"));
    }
  }, [projectId, state]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setError(null);
    setSaving(true);
    try {
      const created = await apiJson<Issue>(`/p/${projectId}/issues`, { method: "POST", json: { title, body } });
      navigate(`/p/${projectId}/issues?n=${created.number}`);
    } catch (e) {
      setError(errText(e, "Issue not saved"));
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 min-w-0">
      <h2 className="sr-only">Issues</h2>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 text-sm" role="tablist" aria-label="Issue state">
          {(["open", "closed"] as const).map((s) => (
            <button key={s} role="tab" aria-selected={state === s} className={`px-3 py-1 rounded-md capitalize ${state === s ? "bg-muted font-medium" : "text-muted-foreground"}`} onClick={() => setState(s)}>{s}</button>
          ))}
        </div>
        <Button size="sm" variant="orange" aria-expanded={composing} aria-controls="new-issue" onClick={() => setComposing((v) => !v)}><Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden /> New issue</Button>
      </div>
      {composing && (
        <form id="new-issue" className="rounded-lg border border-border p-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (title.trim() && !saving) void create(); }}>
          <h3 className="text-sm font-semibold">New issue</h3>
          <label className="block text-sm"><span className="font-medium">Title</span>
            <input className={field} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block text-sm"><span className="font-medium">Description</span>
            <textarea className={field} rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What should change, and why? Agents working on a linked change read this." />
          </label>
          {error && <div role="alert" className={alertCls}>{error}</div>}
          <Button type="submit" size="sm" disabled={saving || !title.trim()}>{saving ? "Opening…" : "Open issue"}</Button>
        </form>
      )}
      {loadError && <LoadError message={loadError} onRetry={() => void load()} />}
      {!issues && !loadError && <p role="status" className="text-sm text-muted-foreground">Loading issues…</p>}
      {issues && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {issues.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No {state} issues.</li>}
          {issues.map((i) => (
            <li key={i.number}>
              <button className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-muted/40" onClick={() => navigate(`/p/${projectId}/issues?n=${i.number}`)}>
                {i.state === "open" ? <CircleDot className="h-4 w-4 mt-0.5 text-emerald-400 shrink-0" aria-label="open" /> : <CircleCheck className="h-4 w-4 mt-0.5 text-purple-400 shrink-0" aria-label="closed" />}
                <span className="min-w-0">
                  <span className="block text-sm font-medium break-words">{i.title}</span>
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "toggle" | "change" | "agent">(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setIssue(await apiJson<IssueDetail>(`/p/${projectId}/issues/${number}`));
    } catch (e) {
      setLoadError(errText(e, "Could not load the issue"));
    }
  }, [projectId, number]);
  useEffect(() => { void load(); }, [load]);

  const toggle = async () => {
    if (!issue) return;
    const next = issue.state === "open" ? "closed" : "open";
    setBusy("toggle");
    setError(null);
    setNotice(null);
    try {
      await apiJson(`/p/${projectId}/issues/${number}`, { method: "PATCH", json: { state: next } });
      setNotice(next === "closed" ? "Issue closed." : "Issue reopened.");
      await load();
    } catch (e) {
      setError(errText(e, "Issue not updated"));
    } finally {
      setBusy(null);
    }
  };
  const startChange = async (agent: boolean) => {
    if (!issue) return;
    setBusy(agent ? "agent" : "change");
    setError(null);
    setNotice(null);
    try {
      const taskId = `${slug(issue.title)}-${Math.random().toString(36).slice(2, 6)}`;
      await apiJson(`/p/${projectId}/tasks`, { method: "POST", json: { taskId, goal: issue.title, issue: number } });
      if (agent) await apiJson(`/p/${projectId}/tasks/${taskId}/agent`, { method: "POST" });
      navigate(`/p/${projectId}/changes`);
    } catch (e) {
      setError(errText(e, "Could not start a change"));
      setBusy(null);
    }
  };

  if (loadError) return <LoadError message={loadError} onRetry={() => void load()} />;
  if (!issue) return <p role="status" className="text-sm text-muted-foreground">Loading issue…</p>;
  return (
    <div className="space-y-4 max-w-3xl min-w-0">
      <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => navigate(`/p/${projectId}/issues`)}>← All issues</button>
      <div>
        <h2 className="text-lg font-semibold break-words">{issue.title} <span className="text-muted-foreground font-normal">#{issue.number}</span></h2>
        <p className="text-xs text-muted-foreground">
          <Badge variant={issue.state === "open" ? "success" : "purple"}>{issue.state}</Badge> opened by {issue.author} {timeAgo(issue.created_at)}
          {issue.closed_by && issue.state === "closed" ? ` · closed by ${issue.closed_by}` : ""}
        </p>
      </div>
      {issue.body && <p className="text-sm whitespace-pre-wrap break-words rounded-md border border-border p-3">{issue.body}</p>}
      {error && <div role="alert" className={alertCls}>{error}</div>}
      {notice && <div role="status" className={okCls}>{notice}</div>}
      <div className="flex flex-wrap gap-2">
        {issue.state === "open" && <Button size="sm" variant="orange" disabled={busy !== null} onClick={() => void startChange(false)}>{busy === "change" ? "Starting…" : "Start a change"}</Button>}
        {issue.state === "open" && <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void startChange(true)}>{busy === "agent" ? "Asking agent…" : "Ask an agent"}</Button>}
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void toggle()}>{busy === "toggle" ? (issue.state === "open" ? "Closing…" : "Reopening…") : issue.state === "open" ? "Close issue" : "Reopen"}</Button>
      </div>
      {issue.linked.length > 0 && (
        <div className="text-sm">
          <h3 className="font-semibold mb-1">Changes for this issue</h3>
          <ul className="space-y-1">{issue.linked.map((t) => <li key={t.id} className="break-words"><button className="hover:underline text-left" onClick={() => navigate(`/p/${projectId}/review?task=${t.id}`)}>{t.goal}</button> <span className="text-xs text-muted-foreground">{t.status}</span></li>)}</ul>
        </div>
      )}
      <Conversation projectId={projectId} subject={`issue:${number}`} title="Conversation" />
    </div>
  );
}
