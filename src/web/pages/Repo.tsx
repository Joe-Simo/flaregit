import React, { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Lock, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { apiJson } from "../api";
import { navigate } from "../router";
import { CodeTab } from "../tabs/Code";
import { CommitsTab } from "../tabs/Commits";
import { ChangesTab } from "../tabs/Changes";
import { IntegrationTab } from "../tabs/Integration";
import { ActivityTab } from "../tabs/Activity";
import { ReviewTab } from "../tabs/Review";
import { IssuesTab } from "../tabs/Issues";
import { PeopleTab } from "../tabs/People";
import { SettingsTab } from "../tabs/Settings";
import type { FlareGitProjectState } from "@/core/types";

interface Meta { id: string; role: "owner" | "member"; kind: string; name: string; source: string | null; verification: Record<string, unknown>; protectedPaths: string[]; visibility?: "private" | "public" }
type State = FlareGitProjectState & { role: string };

const TABS = [
  ["code", "Code", "Files at the accepted version."],
  ["commits", "Commits", "History of accepted versions."],
  ["issues", "Issues", "Problems and requests; a change can resolve one."],
  ["changes", "Changes", "Work in progress by people and agents, each in its own isolated copy. Mark one ready, then integrate."],
  ["integration", "Integration", "Ready changes being combined and verified: what needs your review, what is running, what landed, what failed."],
  ["people", "People", "Who can see and contribute to this repository."],
  ["activity", "Activity", "Everything that happened, newest first."],
  ["settings", "Settings", "Repository configuration."],
] as const;

type RepoProps = { projectId: string; tab: string; params: URLSearchParams };
export function Repo(props: RepoProps) { return <RepositoryView key={props.projectId} {...props} />; }
function RepositoryView({ projectId, tab, params }: RepoProps) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clone, setClone] = useState<{ command: string; remote: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [stateError, setStateError] = useState<string | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);

  const metaRequest = useRef(0);
  const stateRequest = useRef(0);
  const lifetime = useRef(0);
  const loadState = useCallback(() => {
    const sequence = ++stateRequest.current;
    void apiJson<State>(`/p/${projectId}/state`).then((next) => { if (sequence === stateRequest.current) { setState(next); setStateError(null); } }).catch((cause: Error) => { if (sequence === stateRequest.current) setStateError(cause.message); });
  }, [projectId]);
  const reload = useCallback(() => {
    const sequence = ++metaRequest.current;
    void apiJson<Meta>(`/p/${projectId}`).then((next) => { if (sequence === metaRequest.current) { setMeta(next); setError(null); } }).catch((cause: Error) => { if (sequence === metaRequest.current) setError(cause.message); });
    loadState();
  }, [projectId, loadState]);

  useEffect(() => {
    setMeta(null);
    setState(null);
    setError(null);
    setStateError(null);
    reload();
    const t = setInterval(loadState, 6000);
    return () => { clearInterval(t); metaRequest.current++; stateRequest.current++; lifetime.current++; };
  }, [projectId, reload, loadState]);

  if (error) return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 text-sm text-destructive" role="alert">{error === "Not found" ? "Repository not found, or you don't have access." : error}</div>;
  if (!meta || !state) {
    if (stateError) return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 text-sm text-destructive" role="alert">Could not load repository state: {stateError}</div>;
    return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 text-sm text-muted-foreground" role="status">Loading repository…</div>;
  }

  const getClone = async () => {
    const generation = lifetime.current;
    setCloning(true);
    setCloneError(null);
    try {
      const credential = await apiJson<{ command: string; remote: string }>(`/p/${projectId}/clone`, { method: "POST" });
      if (generation === lifetime.current) setClone(credential);
    } catch (e) {
      if (generation === lifetime.current) setCloneError(e instanceof Error ? e.message : "Could not create a clone credential");
    } finally {
      if (generation === lifetime.current) setCloning(false);
    }
  };
  const current = TABS.find(([key]) => key === tab);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div className="flex items-center gap-3 min-w-0">
          {meta.visibility === "public" ? <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <h1 className="text-lg font-bold truncate min-w-0">{meta.name}</h1>
          <Badge variant="outline">{meta.visibility ?? "private"}</Badge>
          {meta.role === "member" && <Badge variant="secondary">collaborator</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:inline">accepted <code>{state.acceptedState.currentCommit.slice(0, 7)}</code></span>
          <Button size="sm" variant="outline" disabled={cloning} onClick={getClone}>{cloning ? "Preparing…" : "Clone"}</Button>
        </div>
      </div>
      {cloneError && <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{cloneError}</div>}
      {stateError && <div role="status" className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">Live updates paused: {stateError}. Showing the last loaded state.</div>}

      <nav aria-label="Repository sections" className="-mx-4 sm:mx-0 mb-2">
      <div className="flex gap-1 border-b border-border overflow-x-auto px-4 sm:px-0" >
        {TABS.map(([key, label]) => (
          <button
            key={key}
            aria-current={tab === key ? "page" : undefined}
            id={`tab-${key}`}
            aria-controls="repo-tabpanel"
            onClick={() => navigate(`/p/${projectId}/${key}`)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px rounded-t focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === key ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      </nav>
      {current && <p className="text-xs text-muted-foreground mb-5">{current[2]}</p>}

      <div id="repo-tabpanel" aria-labelledby={current ? `tab-${current[0]}` : undefined} className="min-w-0">
      {tab === "code" && <CodeTab projectId={projectId} />}
      {tab === "commits" && <CommitsTab projectId={projectId} />}
      {tab === "changes" && <ChangesTab projectId={projectId} state={state} reload={reload} />}
      {tab === "integration" && <IntegrationTab isOwner={meta.role === "owner"} projectId={projectId} state={state} reload={reload} kind={meta.kind} />}
      {tab === "activity" && <ActivityTab projectId={projectId} />}
      {tab === "issues" && <IssuesTab projectId={projectId} issue={params.get("n") ? Number(params.get("n")) : undefined} />}
      {tab === "people" && <PeopleTab projectId={projectId} />}
      {tab === "review" && <ReviewTab isOwner={meta.role === "owner"} projectId={projectId} task={params.get("task") ?? undefined} candidate={params.get("candidate") ? state.candidates[params.get("candidate")!] : undefined} evidence={state} reload={reload} />}
      {tab === "commit" && <ReviewTab isOwner={meta.role === "owner"} projectId={projectId} commit={params.get("hash") ?? undefined} />}
      {tab === "settings" && <SettingsTab meta={meta} reload={reload} />}
      </div>

      <Dialog open={clone !== null} onOpenChange={() => setClone(null)}>
        <DialogHeader>
          <DialogTitle>Clone with Git</DialogTitle>
          <DialogDescription>Read-only credential, valid for one hour. To contribute, start a change and push to its own copy.</DialogDescription>
        </DialogHeader>
        <pre aria-label="Clone command" className="text-xs bg-muted/40 rounded-md p-3 overflow-auto whitespace-pre-wrap break-all">{clone?.command}</pre>
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(clone?.command ?? ""); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            <Copy className="h-4 w-4 mr-1.5" aria-hidden="true" /> <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
          </Button>
          <Button variant="orange" onClick={() => setClone(null)}>Done</Button>
        </div>
      </Dialog>
    </div>
  );
}
