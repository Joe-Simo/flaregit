import React, { useCallback, useEffect, useState } from "react";
import { FolderGit2, Search, Plus, ArrowUpRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiJson } from "../api";
import { navigate, timeAgo } from "../router";

interface Repository { id: string; name: string; role: "owner" | "member"; kind: string; created_at: string }
interface WorkItem { id: number; project_id: string; project_name: string; type: string; title: string; created_at: string }
interface LoadState<T> { data: T[] | null; error: string | null }
const initial = { data: null, error: null };

export function Home() {
  const [repositories, setRepositories] = useState<LoadState<Repository>>(initial);
  const [review, setReview] = useState<LoadState<WorkItem>>(initial);
  const [recent, setRecent] = useState<LoadState<WorkItem>>(initial);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    const results = await Promise.allSettled([
      apiJson<{ projects: Repository[] }>("/account"),
      apiJson<{ items: WorkItem[] }>("/inbox?filter=direct"),
      apiJson<{ items: WorkItem[] }>("/inbox?filter=activity"),
    ]);
    const [repos, needsReview, activity] = results;
    const message = (cause: unknown) => cause instanceof Error ? cause.message : "Could not load this list";
    if (repos.status === "fulfilled") setRepositories({ data: repos.value.projects, error: null }); else setRepositories((previous) => ({ ...previous, error: message(repos.reason) }));
    if (needsReview.status === "fulfilled") setReview({ data: needsReview.value.items.filter((item) => item.type === "task.ready" || item.type.includes("review") || item.type.startsWith("integration") || item.type.startsWith("decision") || item.type.startsWith("stack")), error: null }); else setReview((previous) => ({ ...previous, error: message(needsReview.reason) }));
    if (activity.status === "fulfilled") setRecent({ data: activity.value.items, error: null }); else setRecent((previous) => ({ ...previous, error: message(activity.reason) }));
    setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const visibleRepositories = repositories.data?.filter((repository) => repository.name.toLowerCase().includes(query.trim().toLowerCase()));
  const status = <T,>(state: LoadState<T>, empty: string) => <>{state.error && <p role="alert" className="text-xs text-destructive py-3">{state.error}{state.data ? " · showing the last loaded rows" : ""}</p>}{state.data === null && !state.error && <p role="status" className="text-sm text-muted-foreground py-3">Loading…</p>}{state.data?.length === 0 && !state.error && <p className="text-sm text-muted-foreground py-3">{empty}</p>}</>;
  const workRows = (items: WorkItem[] | null, reviewList: boolean) => <ul className="divide-y divide-border">{items?.slice(0, 6).map((item) => <li key={item.id}><Button variant="ghost" className="w-full h-auto py-3 px-0 rounded-none whitespace-normal text-left justify-start group" onClick={() => navigate(`/p/${item.project_id}/${reviewList ? item.type === "task.ready" || item.type.startsWith("stack") ? "changes" : "integration" : "activity"}`)}><span className="min-w-0 flex-1"><span className="block text-[13px] leading-5 break-words font-medium">{item.title}</span><span className="block mt-1 text-xs text-muted-foreground font-normal break-words">{item.project_name} · {timeAgo(item.created_at)}</span></span><ArrowUpRight className="ml-3 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" /></Button></li>)}</ul>;
  return <div className="mx-auto max-w-[1320px] px-5 sm:px-8 lg:px-12 py-10 sm:py-14">
    <section className="max-w-[720px] mx-auto text-center mb-12 sm:mb-16">
      <h1 className="text-[28px] leading-9 font-medium tracking-tight">Workspace home</h1>
      <div className="relative mt-6"><Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" /><input aria-label="Search repositories" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your repositories" className="w-full h-12 pl-11 pr-4 text-sm rounded-md border border-input bg-card text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div>
    </section>
    <div className="flex items-center justify-end gap-2 mb-5"><Button size="sm" variant="ghost" disabled={refreshing} onClick={() => void load()}>{refreshing ? "Refreshing…" : "Refresh"}</Button><Button size="sm" variant="outline" onClick={() => navigate("/new")}><Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />New repository</Button></div>
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-3 lg:gap-8">
      <section aria-labelledby="home-repositories" className="min-w-0"><div className="border-b border-border pb-3 mb-1 flex items-center justify-between gap-3"><h2 id="home-repositories" className="text-sm font-semibold">Repositories</h2>{repositories.data && <span className="text-xs text-muted-foreground">{repositories.data.length}</span>}</div>
        {status(repositories, "No repositories yet. Start a repository to bring your work here.")}
        <ul className="divide-y divide-border">{visibleRepositories?.map((repository) => <li key={repository.id}><Button variant="ghost" className="w-full h-auto py-3 px-0 rounded-none text-left justify-start whitespace-normal" onClick={() => navigate(`/p/${repository.id}`)}><FolderGit2 className="h-4 w-4 mr-3 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block text-[13px] font-medium break-words">{repository.name}</span><span className="block text-xs font-normal text-muted-foreground mt-1">{repository.role === "owner" ? "Maintainer" : "Contributor"} · {repository.kind === "demo" ? "Demo repository" : "Git repository"}</span></span><Lock className="h-3 w-3 ml-2 shrink-0 text-muted-foreground" aria-label="Private repository" /></Button></li>)}</ul>
        {repositories.data && repositories.data.length > 0 && visibleRepositories?.length === 0 && <p className="py-3 text-sm text-muted-foreground">No matching repositories.</p>}
      </section>
      <section aria-labelledby="home-review" className="min-w-0"><div className="border-b border-border pb-3 mb-1 flex items-center justify-between gap-3"><h2 id="home-review" className="text-sm font-semibold">Needs review</h2><Button size="sm" variant="link" className="h-auto p-0 text-xs text-muted-foreground" onClick={() => navigate("/inbox")}>Open inbox</Button></div>{status(review, "No review requests in your inbox.")}{workRows(review.data, true)}</section>
      <section aria-labelledby="home-recent" className="min-w-0"><div className="border-b border-border pb-3 mb-1"><h2 id="home-recent" className="text-sm font-semibold">Recent work</h2></div>{status(recent, "No recent activity in your inbox.")}{workRows(recent.data, false)}</section>
    </div>
  </div>;
}
