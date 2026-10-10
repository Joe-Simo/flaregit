import {acceptedCommitLabel} from "../accepted-commit-display";
import {GitCredential} from "../components/GitCredential";
import { StorageReconciliation } from "../components/StorageReconciliation";
import { repositoryRefreshFailure } from "../repository-refresh-error";
import { repositoryDeletionNotice } from "../repository-deletion-notice";
import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Copy, Lock, Globe, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { glossary } from "../lib/glossary";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ApiError, apiJson } from "../api";
import { useRepositoryActivity } from "../repository-activity";
import { useVisiblePolling } from "../use-visible-polling";
import { navigate } from "../router";
import { CodeTab } from "../tabs/Code";
import { CommitsTab } from "../tabs/Commits";
import { ChangesTab } from "../tabs/Changes";
import { IntegrationTab } from "../tabs/Integration";
import { ActivityTab } from "../tabs/Activity";
import { ReviewTab } from "../tabs/Review";
import { IssuesTab } from "../tabs/Issues";
import { PeopleTab } from "../tabs/People";
import { RepositoryDiscussionsTab } from "./Community";
import { SettingsTab } from "../tabs/Settings";
import type { FlareGitProjectState } from "@/core/types";

const AcceptancePolicyPanel=lazy(async()=>({default:(await import("../components/AcceptancePolicyPanel")).AcceptancePolicyPanel}));
const PlanningTab=lazy(async()=>({default:(await import("../tabs/Planning")).PlanningTab}));
const SecurityTab=lazy(async()=>({default:(await import("../tabs/Security")).SecurityTab}));
const WikiTab=lazy(async()=>({default:(await import("../tabs/Wiki")).WikiTab}));
const RepoReleases=lazy(async()=>({default:(await import("../components/RepoReleases")).RepoReleases}));
const PreviewOnboardingPanel=lazy(async()=>({default:(await import("../components/PreviewOnboardingPanel")).PreviewOnboardingPanel}));
const AgentBoard=lazy(async()=>({default:(await import("../components/AgentBoard")).AgentBoard}));

interface Meta { id: string; role: "owner" | "member"; permission?: "read" | "write" | "admin"; inheritedAccess?: boolean; kind: string; name: string; source: string | null; verification: Record<string, unknown>; protectedPaths: string[]; visibility?: "private" | "public" }
type State = FlareGitProjectState & { role: string; permission?: "read" | "write" | "admin"; inheritedAccess?: boolean; writableTaskIds?: string[]; cancellableTaskIds?: string[]; forkPermissions?: Record<string,{enabled:boolean;revision:number;canConfigure:boolean}> };


/** At most five primary sections; everything else lives in the keyboard-operable More menu. */
const PRIMARY_TABS = [
  ["code", "Code", "Files at the merged version."],
  ["changes", "Changes", "Work by people and agents, each in its own isolated copy. Every change shows where it is and the one next step."],
  ["review", "Review", `Ready changes ${glossary.combine}d into a ${glossary.preview}, checked, and waiting for your decision to ${glossary.merge}.`],
  ["issues", "Issues", "Problems and requests; a change can resolve one."],
  ["settings", "Settings", "Repository configuration."],
] as const;
const MORE_TABS = [
  ["commits", "Commits", "History of merged versions."],
  ["releases", "Releases", "Saved version notes and exact Git tag identities."],
  ["planning", "Planning", "Issue-linked work, custom fields, and iterations."],
  ["security", "Security", "Private scanner findings and triage history."],
  ["wiki", "Wiki", "Shared repository documentation with revision history."],
  ["discussions", "Discussions", "Repository-member questions and decisions; separate from public conversations."],
  ["integration", "Merge queue", "Every combine run: what is running, what landed, what failed."],
  ["people", "People", "Who can see and contribute to this repository."],
  ["activity", "Activity", "Everything that happened, newest first."],
] as const;
const TABS = [...PRIMARY_TABS, ...MORE_TABS];

type RepoProps = { projectId: string; tab: string; params: URLSearchParams };
export function Repo(props: RepoProps) { return <RepositoryView key={props.projectId} {...props} />; }
function RepositoryView({ projectId, tab, params }: RepoProps) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clone, setClone] = useState<{ token:string; remote: string } | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [throttled, setThrottled] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);

  const lifetime = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const activeWork = ["changes", "integration", "review"].includes(tab);
  const refresh = useVisiblePolling({
    scope: `${projectId}:${tab}`,
    // Live-board activity refreshes sooner (coalesced below); this is only the fallback cadence.
    intervalMs: activeWork ? 15_000 : 30_000,
    maxBackoffMs: 120_000,
    read: async (signal) => {
      const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
      const [metadata, snapshot] = await Promise.allSettled([
        apiJson<Meta>(`/p/${projectId}`, { signal: boundedSignal }),
        apiJson<State>(`/p/${projectId}/state`, { signal: boundedSignal }),
      ]);
      if (metadata.status === "rejected" && repositoryRefreshFailure(metadata.reason)==="access") throw metadata.reason;
      if (snapshot.status === "rejected" && repositoryRefreshFailure(snapshot.reason)==="access") throw snapshot.reason;
      if (metadata.status === "rejected") throw metadata.reason;
      if (snapshot.status === "rejected") throw snapshot.reason;
      return { meta: metadata.value, state: snapshot.value };
    },
    onValue: (next) => { setMeta(next.meta); setState(next.state); setError(null); setStateError(null); setThrottled(false); },
    onError: (cause) => {
      const failure=repositoryRefreshFailure(cause);
      if(failure==="superseded")return;
      // Rate limiting clears on its own: polling waits for Retry-After and the last state stays authoritative.
      if (meta && state && cause instanceof ApiError && cause.status === 429) { setThrottled(true); return; }
      const message = cause instanceof Error ? cause.message : "Could not refresh repository";
      if (!meta || !state || failure==="access") {
        setMeta(null); setState(null); setError(message); setStateError(null);
      } else setStateError(message);
    },
  });
  const reload = useCallback(() => { void refresh(); }, [refresh]);
  useRepositoryActivity(projectId, reload, activeWork);
  useEffect(() => () => { lifetime.current++; }, [projectId]);
  const refreshManually = async () => {
    const generation = lifetime.current;
    setRefreshing(true);
    try { await refresh(); }
    finally { if (generation === lifetime.current) setRefreshing(false); }
  };

  if (error) {
    const deletion = repositoryDeletionNotice(error);
    return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-4"><p className="text-sm text-destructive" role="alert">{deletion?.detail ?? (error === "Not found" ? "Repository not found, or you don't have access." : error)}</p><Button size="sm" variant="outline" disabled={refreshing} onClick={() => void refreshManually()}>{refreshing ? "Refreshing…" : "Retry refresh"}</Button>{deletion?.canInspectStorage && <StorageReconciliation projectId={projectId} />}</div>;
  }
  if (!meta || !state) {
    if (stateError) return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 text-sm text-destructive" role="alert">Could not load repository state: {stateError}</div>;
    return <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 text-sm text-muted-foreground" role="status">Loading repository…</div>;
  }

  const getClone = async () => {
    const generation = lifetime.current;
    setCloning(true);
    setCloneError(null);
    try {
      const credential = await apiJson<{ token:string; remote: string }>(`/p/${projectId}/clone`, { method: "POST" });
      if (generation === lifetime.current) setClone(credential);
    } catch (e) {
      if (generation === lifetime.current) setCloneError(e instanceof Error ? e.message : "Could not create a clone credential");
    } finally {
      if (generation === lifetime.current) setCloning(false);
    }
  };
  const currentKey = tab==="tags" ? "releases" : tab==="commit" ? "commits" : tab==="agents" ? "changes" : tab;
  const current = TABS.find(([key]) => key === currentKey);
  const moreCurrent = MORE_TABS.find(([key]) => key === currentKey);
  const reviewTarget = ["task", "commit", "candidate", "input"].some(name => params.has(name));
  const ownerActionsAvailable = !stateError && state.role === "owner";
  const canContribute = !stateError && state.lifecycle?.state !== "archived" && (state.permission ?? meta.permission) !== "read";
  const managedActions = canContribute && !(state.inheritedAccess ?? meta.inheritedAccess ?? false);
  const currentMeta = { ...meta, role: ownerActionsAvailable ? "owner" as const : "member" as const };

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
          <span className="text-xs text-muted-foreground hidden sm:inline"><code>{state.acceptedState.currentCommit?`merged ${acceptedCommitLabel(state.acceptedState.currentCommit)}`:acceptedCommitLabel(null)}</code></span>
          <Button size="sm" variant="outline" disabled={cloning} onClick={getClone}>{cloning ? "Preparing…" : "Clone"}</Button>
        </div>
      </div>
      {cloneError && <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{cloneError}</div>}
      {throttled && !stateError && <p role="status" className="mb-4 text-xs text-muted-foreground">Updates are paused for a moment because of request limits; they resume on their own.</p>}
      {stateError && <div role="status" className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200 flex flex-wrap items-center gap-3"><span>Live updates unavailable: {stateError}. Showing the last loaded state; owner actions are paused.</span><Button size="sm" variant="outline" disabled={refreshing} onClick={() => void refreshManually()}>{refreshing ? "Refreshing…" : "Retry refresh"}</Button></div>}

      <nav aria-label="Repository sections" className="-mx-4 sm:mx-0 mb-2">
      <div className="flex gap-1 border-b border-border overflow-x-auto px-4 sm:px-0" >
        {PRIMARY_TABS.map(([key, label]) => (
          <button
            key={key}
            aria-current={currentKey===key ? "page" : undefined}
            id={`tab-${key}`}
            aria-controls="repo-tabpanel"
            onClick={() => navigate(`/p/${projectId}/${key}`)}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px rounded-t focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${currentKey===key ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger
            id={moreCurrent ? `tab-${moreCurrent[0]}` : "tab-more"}
            aria-current={moreCurrent ? "page" : undefined}
            className={`ml-auto sm:ml-0 inline-flex items-center gap-1 px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px rounded-t focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${moreCurrent ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {moreCurrent ? <><span className="sr-only">More sections, current: </span>{moreCurrent[1]}</> : "More"}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {MORE_TABS.map(([key, label]) => (
              <DropdownMenuItem key={key} aria-current={currentKey===key ? "page" : undefined} className={currentKey===key ? "font-semibold" : undefined} onSelect={() => navigate(`/p/${projectId}/${key}`)}>
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </nav>
      {current && <p className="text-xs text-muted-foreground mb-5">{current[2]}</p>}

      <div id="repo-tabpanel" aria-labelledby={current ? `tab-${current[0]}` : undefined} className="min-w-0">
      {tab === "code" && <CodeTab projectId={projectId} params={params} acceptedCommit={state.acceptedState.currentCommit} isOwner={ownerActionsAvailable} />}
      {tab === "commits" && <CommitsTab projectId={projectId} />}
      {(tab==="releases"||tab==="tags")&&<Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading tags and releases…</p>}><RepoReleases key={`releases:${projectId}`} projectId={projectId} isOwner={ownerActionsAvailable} tab={tab}/></Suspense>}
      {(tab === "changes" || tab === "agents") && <div className="mb-4"><Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading agent board…</p>}><AgentBoard key={projectId} projectId={projectId} /></Suspense></div>}
      {tab === "changes" && <ChangesTab projectId={projectId} state={state} reload={reload} taskId={params.get("task")} canContribute={canContribute} managedActions={managedActions} writableTaskIds={state.writableTaskIds} cancellableTaskIds={state.cancellableTaskIds} forkPermissions={state.forkPermissions} isOwner={ownerActionsAvailable} />}
      {tab === "integration" && <IntegrationTab decisionId={params.get("decision")} isOwner={ownerActionsAvailable} projectId={projectId} state={state} reload={reload} kind={meta.kind} />}
      {tab === "activity" && <ActivityTab projectId={projectId} />}
      {tab === "discussions" && <RepositoryDiscussionsTab key={`${projectId}:${params.get("topic") ?? "list"}`} projectId={projectId} owner={ownerActionsAvailable} topic={params.get("topic") ?? undefined} />}
      {tab === "planning" && <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading planning…</p>}><PlanningTab key={projectId} projectId={projectId} owner={ownerActionsAvailable} readOnly={!canContribute}/></Suspense>}
      {tab === "security" && <Suspense fallback={<p role="status" className="text-sm">Loading security…</p>}><SecurityTab key={projectId} projectId={projectId} commit={state.acceptedState.currentCommit} tree={state.acceptedBaseline?.commit===state.acceptedState.currentCommit?state.acceptedBaseline.tree:Object.values(state.evidence).find(evidence=>evidence.status==='passed'&&evidence.candidateCommit===state.acceptedState.currentCommit)?.candidateTree} readOnly={!!stateError || state.lifecycle?.state === "archived"}/></Suspense>}
      {tab === "wiki" && <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading wiki…</p>}><WikiTab key={`${projectId}:${params.get("page") ?? "list"}`} projectId={projectId} slug={params.get("page") ?? undefined} readOnly={!canContribute} /></Suspense>}
      {tab === "issues" && <IssuesTab projectId={projectId} issue={params.get("n") ? Number(params.get("n")) : undefined} />}
      {tab === "people" && <PeopleTab projectId={projectId} />}
      {tab === "review" && (reviewTarget ? <ReviewTab isOwner={ownerActionsAvailable} projectId={projectId} task={params.get("task") ?? undefined} commit={params.get("commit") ?? undefined} baseCommit={params.get("base") ?? undefined} returnTo={params.get("from") === "recovery" ? "integration" : undefined} input={params.get("input") ?? undefined} candidate={params.get("candidate") ? state.candidates[params.get("candidate")!] : undefined} evidence={state} reload={reload} /> : <IntegrationTab decisionId={params.get("decision")} isOwner={ownerActionsAvailable} projectId={projectId} state={state} reload={reload} kind={meta.kind} />)}
      {tab === "commit" && <ReviewTab isOwner={ownerActionsAvailable} projectId={projectId} commit={params.get("hash") ?? undefined} />}
      {tab === "settings" && <div className="space-y-4"><SettingsTab meta={currentMeta} reload={reload} /><Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading acceptance policy…</p>}><AcceptancePolicyPanel key={projectId} projectId={projectId} isOwner={ownerActionsAvailable}/></Suspense><Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading preview setup…</p>}><PreviewOnboardingPanel key={`preview:${projectId}`} projectId={projectId} isOwner={ownerActionsAvailable}/></Suspense></div>}
      </div>

      <Dialog open={clone !== null} onOpenChange={() => setClone(null)}>
        <DialogHeader>
          <DialogTitle>Clone with Git</DialogTitle>
          <DialogDescription>Read-only credential, valid for one hour. To contribute, start a change and push to its own copy.</DialogDescription>
        </DialogHeader>
        {clone&&<CloneCommand key={clone.token} remote={clone.remote}/>}
        {clone&&<GitCredential key={clone.token} token={clone.token}/>}
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="orange" onClick={() => setClone(null)}>Done</Button>
        </div>
      </Dialog>
    </div>
  );
}

function CloneCommand({remote}:{remote:string}) {
  const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false);
  const command=`git clone ${remote}`;
  const copy=async()=>{
    setCopied(false);setCopyError(false);
    try { await navigator.clipboard.writeText(command);setCopied(true); }
    catch { setCopyError(true); }
  };
  return <div className="space-y-2">
    <pre aria-label="Clone command" tabIndex={0} className="text-xs bg-muted/40 rounded-md p-3 overflow-auto whitespace-pre-wrap break-all select-text">{command}</pre>
    <Button variant="outline" onClick={()=>void copy()}>
      <Copy className="h-4 w-4 mr-1.5" aria-hidden="true"/><span aria-live="polite">{copied?"Copied":"Copy command"}</span>
    </Button>
    {copyError&&<p role="alert" className="text-sm text-destructive">Command could not be copied. Select the command above and copy it manually.</p>}
  </div>;
}
