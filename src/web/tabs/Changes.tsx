import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Input } from "@/components/ui/input";
import { changeCreationFollowup, type ChangeCreationResponse } from "../change-creation-followup";
import { Bot, Check, Copy, GitPullRequestArrow, Layers, Plus, User, X, GitBranch, AlertTriangle, ShieldCheck, Pause, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AgentRecoveryPanel } from "../components/AgentRecoveryPanel";
import { apiFetch, apiJson } from "../api";
import { navigate, timeAgo } from "../router";
import type { FlareGitProjectState, Task, TaskStatus } from "@/core/types";

const STATUS: Record<TaskStatus, { label: string; variant: "secondary" | "info" | "warning" | "success" | "purple" | "destructive" | "outline" }> = {
  working: { label: "Working", variant: "secondary" },
  checkpointed: { label: "Working · pushed", variant: "secondary" },
  ready: { label: "Ready", variant: "info" },
  integrating: { label: "Integrating", variant: "warning" },
  verifying: { label: "Verifying", variant: "warning" },
  accepted: { label: "Accepted", variant: "success" },
  needs_decision: { label: "Needs decision", variant: "purple" },
  blocked: { label: "Blocked", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

const slug = (goal: string) => goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "change";

interface WorkflowObservation { instanceId: string; kind: string; status: string; action: string; changed: boolean }
const WORKFLOW_LABELS: Record<string, string> = { paused: "Paused", waitingForPause: "Pause pending", running: "Running", waiting: "Waiting", queued: "Queued", complete: "Completed", errored: "Failed", terminated: "Terminated", unknown: "Unknown" };

function AgentRunControls({ projectId, instanceId, canRetry, retrying, onRetry, onChange }: { projectId: string; instanceId: string; canRetry: boolean; retrying: boolean; onRetry: () => void; onChange: () => void }) {
  const [observation, setObservation] = useState<{ run: WorkflowObservation; at: string } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const request = async (action: "status" | "pause" | "resume") => {
    setLoading(action);
    setError(null);
    setActionMessage(null);
    try {
      const response = await apiFetch(`/api/p/${projectId}/workflows/${instanceId}${action === "status" ? "" : `/${action}`}`, { method: action === "status" ? "GET" : "POST" });
      if (!response.ok) {
        setUnavailable(response.status === 404);
        throw new Error(await response.text() || "Could not read the agent run");
      }
      const run = await response.json() as WorkflowObservation;
      setObservation({ run, at: new Date().toISOString() });
      setUnavailable(false);
      if (action !== "status") {
        setActionMessage(run.changed ? `${action === "pause" ? "Pause" : "Resume"} requested. Observed state: ${WORKFLOW_LABELS[run.status] ?? run.status}.` : `No new transition requested. Observed state: ${WORKFLOW_LABELS[run.status] ?? run.status}.`);
        onChange();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the agent run");
    } finally { setLoading(null); }
  };
  const status = observation?.run.status;
  return <div className="mt-3 border-t border-border pt-2 space-y-2">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-xs text-muted-foreground">Agent run{status ? ` · ${WORKFLOW_LABELS[status] ?? status}` : " · status not checked"}{observation ? ` · checked ${timeAgo(observation.at)}` : ""}</span>
      <Button size="sm" variant="ghost" disabled={loading !== null} onClick={() => void request("status")}><RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />{loading === "status" ? "Checking…" : "Check run"}</Button>
      {!error && status && ["running", "waiting", "queued"].includes(status) && <Button size="sm" variant="outline" disabled={loading !== null} onClick={() => void request("pause")}><Pause className="mr-1 h-3 w-3" aria-hidden="true" />{loading === "pause" ? "Requesting…" : "Pause agent"}</Button>}
      {!error && status === "paused" && <Button size="sm" variant="outline" disabled={loading !== null} onClick={() => void request("resume")}><Play className="mr-1 h-3 w-3" aria-hidden="true" />{loading === "resume" ? "Requesting…" : "Resume agent"}</Button>}
      {canRetry && (status === "errored" || unavailable) && <Button size="sm" variant="outline" disabled={loading !== null || retrying} onClick={onRetry}>{retrying ? "Starting…" : "Start new agent run"}</Button>}
    </div>
    {status === "waitingForPause" && <p className="text-xs text-amber-200">Pause is pending. The provider has not confirmed a paused state; check the run again.</p>}
    {status === "paused" && <p className="text-xs text-muted-foreground">Resume continues this durable run. Saved checkpoints remain available above.</p>}
    {actionMessage && <p role="status" className="text-xs text-sky-200">{actionMessage}</p>}
    {error && <p role="alert" className="text-xs text-destructive">Run status unavailable: {error}. Saved checkpoints remain available.</p>}
    {canRetry && (status === "errored" || unavailable) && <p className="text-xs text-muted-foreground">Starting a new run retries this change; it does not resume the previous run.</p>}
  </div>;
}

type ChangesProps = { projectId: string; state: FlareGitProjectState; reload: () => void };
export function ChangesTab(props: ChangesProps) {
  const { userId } = useAuth();
  return <ChangesPanel key={`${props.projectId}:${userId ?? "signed-out"}`} {...props} />;
}
function ChangesPanel({ projectId, state, reload }: ChangesProps) {
  const [goal, setGoal] = useState("");
  const creationIntent = useRef<{ signature: string; taskId: string } | null>(null);
  const [relationships, setRelationships] = useState(false);
  const [dependsOn, setDependsOn] = useState<string | null>(null);
  const [issue, setIssue] = useState<{ number: number; title: string } | null>(null);
  const [picker, setPicker] = useState<"change" | "issue" | null>(null);
  const [search, setSearch] = useState("");
  const [issues, setIssues] = useState<Array<{ number: number; title: string }> | null>(null);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const lifetime = useRef(0);
  const issueRequest = useRef(0);
  useEffect(() => () => { lifetime.current++; issueRequest.current++; }, []);
  const loadIssues = async () => {
    const request = ++issueRequest.current;
    setIssuesLoading(true); setIssuesError(null);
    try {
      const result = await apiJson<Array<{ number: number; title: string }>>(`/p/${projectId}/issues?state=open`);
      if (request === issueRequest.current) setIssues(result);
    } catch (cause) {
      if (request === issueRequest.current) setIssuesError(cause instanceof Error ? cause.message : "Could not load issues");
    } finally { if (request === issueRequest.current) setIssuesLoading(false); }
  };
  const [useAgent, setUseAgent] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [instructions, setInstructions] = useState<{ commands: string[]; task: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const tasks = Object.values(state.tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = tasks.filter((task) => task.status !== "accepted" && task.status !== "cancelled");
  const integrationSelection = selected.filter((id) => { const task = state.tasks[id]; return task?.status === "ready" || task?.status === "blocked"; });
  const paths = new Map<string, Task[]>();
  for (const task of active) {
    for (const file of new Set(task.checkpoints.flatMap((checkpoint) => checkpoint.filesChanged))) {
      paths.set(file, [...(paths.get(file) ?? []), task]);
    }
  }
  const overlaps = [...paths.entries()].filter(([, contributors]) => contributors.length > 1);
  const stale = active.filter((task) => task.baseCommit !== state.acceptedState.currentCommit && !task.dependsOn);


  const run = async (label: string, fn: () => Promise<void>) => {
    const generation = lifetime.current;
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      if (generation === lifetime.current) setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      if (generation === lifetime.current) { setBusy(null); reload(); }
    }
  };

  const create = () =>
    run("create", async () => {
      const generation = lifetime.current;
      if (dependsOn && (!state.tasks[dependsOn] || state.tasks[dependsOn]?.status === "cancelled")) throw new Error("The selected base change is no longer available. Choose another change or clear it.");
      const signature = JSON.stringify({ goal, dependsOn, issue: issue?.number ?? null });
      if (creationIntent.current?.signature !== signature) creationIntent.current = { signature, taskId: `${slug(goal)}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}` };
      const taskId = creationIntent.current.taskId;
      const created = await apiJson<ChangeCreationResponse>(`/p/${projectId}/tasks`, { method: "POST", json: { taskId, goal, ...(dependsOn ? { dependsOn } : {}), ...(issue ? { issue: issue.number } : {}) } });
      if (generation !== lifetime.current) return;
      const followup = changeCreationFollowup(created, useAgent);
      creationIntent.current = null;
      setInstructions(null);
      if (followup === "terminal") {
        setNotice(`Change already ${created.status === "accepted" ? "accepted" : "cancelled"}. Its saved history is preserved; no new agent run was started.`);
      } else if (followup === "existing-agent") {
        setNotice("Change saved. Its existing agent run and checkpoints are available below; no new run was started.");
      } else if (followup === "start-agent") {
        try {
          await apiJson(`/p/${projectId}/tasks/${taskId}/agent`, { method: "POST" });
          if (generation !== lifetime.current) return;
          setNotice("Agent run started. Its checkpoints and progress will appear on the change.");
        } catch (cause) {
          if (generation !== lifetime.current) return;
          setInstructions({ commands: created.commands, task: taskId });
          setError(`Change saved, but the agent could not start: ${cause instanceof Error ? cause.message : "Unknown error"}. Resume from the change below or use its Git commands.`);
        }
      } else {
        setInstructions({ commands: created.commands, task: taskId });
      }
      setGoal(""); setDependsOn(null); setIssue(null); setRelationships(false);
    });

  const act = (task: Task, action: "ready" | "cancel" | "agent") =>
    run(`${action}-${task.id}`, async () => {
      await apiJson(`/p/${projectId}/tasks/${task.id}/${action}`, { method: "POST" });
      if (action === "agent") setNotice("Agent run requested. Check its durable run status below.");
    });

  const integrate = () =>
    run("integrate", async () => {
      await apiJson(`/p/${projectId}/integrations`, { method: "POST", json: { taskIds: integrationSelection } });
      setSelected([]);
      setNotice("Integration requested. Review the candidate, checks, and any conflict decisions in Integration before accepting repository history.");
    });

  const toggle = (id: string) => setSelected(() => (integrationSelection.includes(id) ? integrationSelection.filter((value) => value !== id) : integrationSelection.length >= 8 ? integrationSelection : [...integrationSelection, id]));

  return (
    <div className="space-y-5">
      <section aria-labelledby="coordination-heading" className="rounded-xl border border-border bg-gradient-to-br from-orange-500/10 via-card to-card p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-primary font-semibold">Concurrent work</p>
            <h2 id="coordination-heading" className="mt-1 text-xl font-semibold tracking-tight">One repository. Independent contributions.</h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-2xl">Follow each purpose and saved checkpoint, then review how the work comes together.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" /><span>Accepted <code>{state.acceptedState.currentCommit.slice(0, 8)}</code></span></div>
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">
          {[["Active changes", active.length], ["Shared files", overlaps.length], ["Older bases", stale.length]].map(([label, count]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{count}</dd></div>)}
        </dl>
        {overlaps.length > 0 && <div className="mt-4 border-t border-border pt-4">
          <h3 className="text-sm font-medium flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden="true" />Overlapping saved changes</h3>
          <p className="mt-1 text-xs text-muted-foreground">Shared files need attention; an overlap alone does not establish a Git conflict.</p>
          <ul className="mt-3 space-y-2">{overlaps.slice(0, 6).map(([file, contributors]) => <li key={file} className="text-xs"><code className="break-all text-amber-200">{file}</code><span className="block mt-0.5 text-muted-foreground">{contributors.map((task) => task.goal).join(" · ")}</span></li>)}</ul>
          {overlaps.length > 6 && <p className="mt-2 text-xs text-muted-foreground">{overlaps.length - 6} more shared files in saved checkpoints.</p>}
        </div>}
      </section>
      <Card>
        <CardContent className="py-4 space-y-3">
          <h2 className="text-sm font-semibold"><label htmlFor="new-change-goal">Start a change</label></h2>
          <textarea
            id="new-change-goal"
            disabled={busy !== null}
            value={goal}
            onChange={(e) => { creationIntent.current = null; setGoal(e.target.value); }}
            rows={2}
            maxLength={300}
            placeholder="Describe what should change, e.g. “Add input validation to the signup form”"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button size="sm" variant="ghost" aria-expanded={relationships} aria-controls="change-relationships" disabled={busy !== null} onClick={() => setRelationships(value => !value)}>{relationships ? "Hide relationships" : dependsOn || issue ? "Edit relationships" : "Add relationships"}</Button>
          {relationships && <div id="change-relationships" className="space-y-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">Build on an existing change or link an issue this change will resolve.</p>
            <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy !== null} onClick={() => { setSearch(""); setPicker("change"); }}>{dependsOn ? `Builds on: ${state.tasks[dependsOn]?.goal ?? dependsOn}` : "Choose base change"}</Button>{dependsOn && <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => { creationIntent.current = null; setDependsOn(null); }}>Clear base</Button>}</div>
            <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={busy !== null} onClick={() => { setSearch(""); setPicker("issue"); void loadIssues(); }}>{issue ? `Resolves #${issue.number}: ${issue.title}` : "Choose issue"}</Button>{issue && <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => { creationIntent.current = null; setIssue(null); }}>Clear issue</Button>}</div>
          </div>}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={busy !== null} checked={useAgent} onChange={(e) => setUseAgent(e.target.checked)} />
              <Bot className="h-4 w-4" aria-hidden="true" /> Let an AI agent do the work
            </label>
            <Button variant="orange" disabled={!goal.trim() || busy !== null} onClick={create}>
              <Plus className="h-4 w-4 mr-1.5" aria-hidden="true" /> {busy === "create" ? "Creating…" : useAgent ? "Start with an agent" : "Create and get git commands"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Each change gets its own isolated copy of the repository. Anyone can also push with plain Git; saved commits stay separate until a candidate passes checks and receives human acceptance.</p>
        </CardContent>
      </Card>

      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      {notice && <div role="status" className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">{notice}</div>}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">Changes ({tasks.length})</h2>
          <p className="text-xs text-muted-foreground">Select up to 8 ready or blocked changes to prepare a review candidate.</p>
        </div>
        <Button variant="outline" size="sm" disabled={integrationSelection.length < 1 || integrationSelection.length > 8 || busy !== null} onClick={integrate}>
          <GitPullRequestArrow className="h-4 w-4 mr-1.5" aria-hidden="true" /> {busy === "integrate" ? "Starting…" : integrationSelection.length <= 1 ? "Integrate" : `Integrate ${integrationSelection.length} together`}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 divide-y divide-border">
          {tasks.length === 0 && <p className="p-4 text-sm text-muted-foreground">No changes yet. Start one above.</p>}
          {tasks.map((t) => {
            const st = STATUS[t.status];
            const latestCheckpoint = t.checkpoints.at(-1);
            const canSelect = t.status === "ready" || t.status === "blocked";
            return (
              <div key={t.id} className="px-4 py-4 flex items-start gap-3 flex-wrap sm:flex-nowrap">
                <input type="checkbox" className="mt-1.5" disabled={!canSelect} checked={integrationSelection.includes(t.id)} onChange={() => toggle(t.id)} aria-label={canSelect ? `Select “${t.goal}” for integration` : `“${t.goal}” is not ready to integrate`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-medium break-words min-w-0">{t.goal}</h3>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    {t.contributor.type === "agent" ? (
                      <Badge variant="purple" className="gap-1"><Bot className="h-3 w-3" aria-hidden="true" />{t.contributor.name} · AI</Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1"><User className="h-3 w-3" aria-hidden="true" />{t.contributor.name}</Badge>
                    )}
                    {t.initiatedBy?.type === "human" && t.initiatedBy.id !== t.contributor.id && <span>Requested by {t.initiatedBy.name}</span>}
                    {t.dependsOn && (
                      <span className="inline-flex items-center gap-1 min-w-0">
                        <Layers className="h-3 w-3 shrink-0" aria-hidden="true" />Stacked on <span className="break-all">{state.tasks[t.dependsOn]?.goal ?? t.dependsOn}</span>
                        {state.tasks[t.dependsOn] && state.tasks[t.dependsOn]!.status !== "accepted" ? ` (${STATUS[state.tasks[t.dependsOn]!.status].label.toLowerCase()})` : ""}
                      </span>
                    )}
                    {t.issue !== undefined && (
                      <a className="underline hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/p/${projectId}/issues?n=${t.issue}`} onClick={(e) => { e.preventDefault(); navigate(`/p/${projectId}/issues?n=${t.issue}`); }}>Resolves #{t.issue}</a>
                    )}
                    <code className="break-all">{t.id}</code>
                    <span>{timeAgo(t.createdAt)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" aria-hidden="true" />Base <code>{t.baseCommit.slice(0, 8)}</code></span>
                    {t.checkpoints.length > 0 ? <span>Saved <code>{t.currentCommit.slice(0, 8)}</code> · {t.checkpoints.length} checkpoint{t.checkpoints.length === 1 ? "" : "s"}</span> : <span>No pushed checkpoint yet</span>}
                    {stale.some((task) => task.id === t.id) && <span className="text-amber-200">Accepted history advanced · candidate must use the latest base</span>}
                  </div>
                  {latestCheckpoint && <p className="mt-1 text-xs text-muted-foreground break-words">Latest checkpoint: {latestCheckpoint.message} · {timeAgo(latestCheckpoint.timestamp)}</p>}
                  {t.checkpoints.some((checkpoint) => checkpoint.filesChanged.length > 0) && <details className="mt-2 text-xs text-muted-foreground">
                    <summary className="cursor-pointer rounded w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Files touched in saved checkpoints</summary>
                    <ul className="mt-2 space-y-1">{[...new Set(t.checkpoints.flatMap((checkpoint) => checkpoint.filesChanged))].map((file) => <li key={file}><code className="break-all">{file}</code>{(paths.get(file)?.length ?? 0) > 1 && <span className="ml-2 text-amber-200">shared with another active change</span>}</li>)}</ul>
                  </details>}
                  {t.agentRunId && <AgentRecoveryPanel key={`${projectId}:${t.id}:${t.agentRunId}`} projectId={projectId} taskId={t.id} runId={t.agentRunId} canResume={["working", "checkpointed", "blocked", "needs_decision"].includes(t.status)} busy={busy !== null} onStarted={reload} />}
                  {t.agentWorkflowInstanceId && <AgentRunControls key={t.agentWorkflowInstanceId} projectId={projectId} instanceId={t.agentWorkflowInstanceId} canRetry={["working", "checkpointed", "blocked", "needs_decision"].includes(t.status)} retrying={busy !== null} onRetry={() => void act(t, "agent")} onChange={reload} />}
                  {t.status === "blocked" && (
                    <p className="mt-1.5 text-xs text-destructive">Blocked: {t.blockedReason ?? "no reason was recorded"}</p>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0 flex-wrap justify-end ml-auto">
                  {t.checkpoints.length > 0 && (
                    <Button size="sm" variant="outline" onClick={() => navigate(`/p/${projectId}/review?task=${t.id}`)} aria-label={`View diff of “${t.goal}”`}>Diff</Button>
                  )}
                  {(t.status === "working" || t.status === "checkpointed") && (
                    <>
                      <Button size="sm" variant="outline" disabled={busy !== null} title="Verify the pushed Git branch and mark this change ready" onClick={() => act(t, "ready")}><Check className="h-3.5 w-3.5 mr-1" aria-hidden="true" />{busy === `ready-${t.id}` ? "Verifying…" : "Mark ready"}</Button>
                      {!t.agentWorkflowInstanceId && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(t, "agent")}><Bot className="h-3.5 w-3.5 mr-1" aria-hidden="true" />{busy === `agent-${t.id}` ? "Starting…" : "Hand to agent"}</Button>}
                    </>
                  )}
                  {t.status !== "accepted" && t.status !== "cancelled" && t.status !== "integrating" && t.status !== "verifying" && (
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(t, "cancel")} aria-label={`Cancel “${t.goal}”`} title="Cancel change"><X className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={picker !== null} onOpenChange={open => { if (!open) setPicker(null); }}>
        <DialogHeader><DialogTitle>{picker === "change" ? "Build on a change" : "Link an issue"}</DialogTitle><DialogDescription>{picker === "change" ? "The new workspace starts from this change’s saved Git state." : "The issue closes when this change is accepted."}</DialogDescription></DialogHeader>
        <Input aria-label={picker === "change" ? "Find a base change" : "Find an issue"} placeholder="Search" value={search} onChange={event => setSearch(event.target.value)} />
        <div className="mt-3 max-h-72 overflow-auto space-y-1">
          {picker === "change" && tasks.filter(task => task.status !== "cancelled" && `${task.goal} ${task.id}`.toLowerCase().includes(search.toLowerCase())).map(task => <Button key={task.id} variant="ghost" className="w-full h-auto justify-start whitespace-normal text-left" onClick={() => { if (dependsOn !== task.id) creationIntent.current = null; setDependsOn(task.id); setPicker(null); }}>{task.goal} · {STATUS[task.status].label}</Button>)}
          {picker === "change" && !tasks.some(task => task.status !== "cancelled" && `${task.goal} ${task.id}`.toLowerCase().includes(search.toLowerCase())) && <p className="text-sm text-muted-foreground">No matching changes.</p>}
          {picker === "issue" && issuesLoading && <p role="status" className="text-sm text-muted-foreground">Loading open issues…</p>}
          {picker === "issue" && issuesError && <div role="alert" className="text-sm text-destructive"><p>{issuesError}</p><Button variant="outline" size="sm" onClick={() => void loadIssues()}>Retry</Button></div>}
          {picker === "issue" && issues?.filter(item => `${item.number} ${item.title}`.toLowerCase().includes(search.toLowerCase())).map(item => <Button key={item.number} variant="ghost" className="w-full h-auto justify-start whitespace-normal text-left" onClick={() => { if (issue?.number !== item.number) creationIntent.current = null; setIssue(item); setPicker(null); }}>#{item.number} {item.title}</Button>)}
          {picker === "issue" && !issuesLoading && !issuesError && issues && !issues.some(item => `${item.number} ${item.title}`.toLowerCase().includes(search.toLowerCase())) && <p className="text-sm text-muted-foreground">No matching open issues.</p>}
        </div>
      </Dialog>

      <Dialog open={instructions !== null} onOpenChange={() => setInstructions(null)}>
        <DialogHeader>
          <DialogTitle>Work on it with Git</DialogTitle>
          <DialogDescription>Your credential works only for this change and expires in one hour. Push your commits, then press “Ready”.</DialogDescription>
        </DialogHeader>
        <pre aria-label="Git commands" className="text-xs bg-muted/40 rounded-md p-3 overflow-auto whitespace-pre-wrap break-all">{instructions?.commands.join("\n")}</pre>
        <div className="flex justify-end gap-2 mt-3">
          <Button
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(instructions?.commands.join("\n") ?? "");
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Copy className="h-4 w-4 mr-1.5" aria-hidden="true" /> <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
          </Button>
          <Button variant="orange" onClick={() => setInstructions(null)}>Done</Button>
        </div>
      </Dialog>
    </div>
  );
}
