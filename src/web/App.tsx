import React, { useEffect, useRef, useState } from "react";
import { GitBranch, Search, Menu, X, Inbox as InboxIcon, Settings, FolderGit2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { BillingBar } from "./components/BillingBar";
import { Home } from "./pages/Home";
import { NewRepo } from "./pages/NewRepo";
import { Repo } from "./pages/Repo";
import { Join } from "./pages/Join";
import { Account } from "./pages/Account";
import { Inbox } from "./pages/Inbox";
import { OperatorPage, ReportPage } from "./pages/Reports";
import { apiJson } from "./api";
import { navigate, useRoute } from "./router";

interface SearchRepository { id: string; name: string }
function RepositorySearch({ open, close }: { open: boolean; close: () => void }) {
  const [repositories, setRepositories] = useState<SearchRepository[] | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const previous = document.activeElement;
    setRepositories(null); setQuery(""); setError(null);
    void apiJson<{ projects: SearchRepository[] }>("/account").then((response) => { if (active) setRepositories(response.projects); }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load repositories"); });
    const frame = requestAnimationFrame(() => input.current?.focus());
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = panel.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input,a[href]");
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { active = false; cancelAnimationFrame(frame); document.removeEventListener("keydown", trap); if (previous instanceof HTMLElement) previous.focus(); };
  }, [open]);
  const results = repositories?.filter((repository) => repository.name.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <Dialog open={open} onOpenChange={close}><div ref={panel} role="dialog" aria-modal="true" aria-labelledby="repository-search-title">
    <DialogClose onClick={close} /><DialogHeader><DialogTitle id="repository-search-title">Find a repository</DialogTitle></DialogHeader>
    <input ref={input} aria-label="Search your repositories" className="w-full border border-input rounded-md bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="Repository name" value={query} onChange={(event) => setQuery(event.target.value)} />
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {!repositories && !error && <p role="status" className="mt-3 text-sm text-muted-foreground">Loading repositories…</p>}
    {repositories && <ul className="mt-3 max-h-72 overflow-auto divide-y divide-border">{results.map((repository) => <li key={repository.id}><Button variant="ghost" className="w-full justify-start h-auto py-3 text-left break-all whitespace-normal" onClick={() => { navigate(`/p/${repository.id}`); close(); }}><FolderGit2 className="h-4 w-4 mr-2 shrink-0" aria-hidden="true" />{repository.name}</Button></li>)}{results.length === 0 && <li className="py-3 text-sm text-muted-foreground">{repositories.length === 0 ? "No repositories yet." : "No matching repositories."}</li>}</ul>}
  </div></Dialog>;
}

export function App() {
  const route = useRoute();
  const [degraded, setDegraded] = useState<string[]>([]);
  const [unread, setUnread] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen((value) => !value); }
      if (event.key === "Escape") { setSidebarOpen(false); menuButton.current?.focus(); }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, []);
  useEffect(() => setSidebarOpen(false), [route.name]);
  useEffect(() => {
    const poll = () => apiJson<{ unread: { direct: number } }>("/inbox?filter=direct").then((response) => setUnread(response.unread.direct)).catch(() => undefined);
    void poll(); const timer = setInterval(poll, 60_000); return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const check = () => fetch("/status.json").then((response) => response.json() as Promise<{ degraded: string[] }>).then((response) => setDegraded(response.degraded)).catch(() => undefined);
    void check(); const timer = setInterval(check, 60_000); return () => clearInterval(timer);
  }, []);
  const section = route.name === "home" ? "Repositories" : route.name === "repo" ? "Repository" : route.name === "new" ? "New repository" : route.name === "inbox" ? "Inbox" : route.name === "account" ? "Account" : "Workspace";
  const nav = [{ name: "Repositories", path: "/", current: route.name === "home" || route.name === "repo", Icon: FolderGit2 }, { name: "Inbox", path: "/inbox", current: route.name === "inbox", Icon: InboxIcon }, { name: "Account", path: "/account", current: route.name === "account", Icon: Settings }];
  return (
    <div className="dashboard-shell min-h-screen bg-background text-foreground">
      <a href="#workspace-content" onClick={(event) => { event.preventDefault(); document.getElementById("workspace-content")?.focus(); }} className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-card focus:px-4 focus:py-2">Skip to content</a>
      <header className="h-14 border-b border-border flex items-center gap-3 px-4 lg:pl-[264px] pr-16 bg-card">
        <Button ref={menuButton} size="icon" variant="ghost" className="lg:hidden" aria-label={sidebarOpen ? "Close navigation" : "Open navigation"} aria-controls="workspace-navigation" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((value) => !value)}>{sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}</Button>
        <span className="text-xs text-muted-foreground hidden sm:inline">Workspace</span><span className="text-border hidden sm:inline">/</span><span className="text-sm font-medium truncate">{section}</span>
        <Button variant="ghost" size="sm" className="ml-auto gap-2 text-muted-foreground" onClick={() => setSearchOpen(true)} aria-label="Search repositories, Command or Control K"><Search className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">Quick search</span><kbd className="hidden sm:inline text-[10px] border border-border rounded px-1.5 py-0.5">⌘ K</kbd></Button>
      </header>
      <aside id="workspace-navigation" className={`dashboard-sidebar border-r border-border lg:fixed lg:inset-y-0 lg:left-0 lg:w-[240px] lg:flex flex-col ${sidebarOpen ? "flex border-b" : "hidden"}`}>
        <button className="h-14 px-5 flex items-center gap-2.5 border-b border-border font-semibold text-lg tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => { navigate("/"); setSidebarOpen(false); }} aria-label="FlareGit repositories"><span className="h-7 w-7 rounded-md bg-primary flex items-center justify-center text-primary-foreground"><GitBranch className="h-4 w-4" aria-hidden="true" /></span>FlareGit</button>
        <nav aria-label="Workspace" className="p-3 space-y-1">{nav.map(({ name, path, current, Icon }) => <Button key={path} variant="ghost" className="dashboard-nav w-full justify-start h-9 text-[13px] font-normal rounded-md" aria-current={current ? "page" : undefined} onClick={() => { navigate(path); setSidebarOpen(false); }}><Icon className="h-4 w-4 mr-2.5 text-muted-foreground" aria-hidden="true" />{name}{name === "Inbox" && unread > 0 && <span className="ml-auto text-[11px] rounded bg-primary/10 text-primary px-1.5">{unread}</span>}</Button>)}<Button variant="ghost" className="w-full justify-start h-9 text-[13px] font-normal text-muted-foreground" onClick={() => { navigate("/new"); setSidebarOpen(false); }}><Plus className="h-4 w-4 mr-2.5" aria-hidden="true" />New repository</Button></nav>
        <div className="lg:mt-auto p-4 border-t border-border space-y-4"><div className="flex flex-wrap gap-x-3 gap-y-2 text-[11px] text-muted-foreground"><a href="/status" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Status</a><a href="#/report" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Report abuse</a><a href="mailto:support@flaregit.com" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Support</a></div></div>
      </aside>
      <div className="lg:ml-[240px] min-w-0 flex flex-col min-h-[calc(100vh-3.5rem)]">
      {degraded.length > 0 && (
        <div role="status" className="px-4 sm:px-6 py-2 text-sm bg-amber-500/15 border-b border-amber-500/30 text-amber-200">
          Degraded right now: {degraded.join(", ")}. Integrations may be delayed. <a className="underline" href="/status">Details</a>
        </div>
      )}
      <BillingBar refreshKey={0} />
      <main id="workspace-content" tabIndex={-1} className="flex-1 min-w-0">
        {route.name === "home" && <Home />}
        {route.name === "new" && <NewRepo />}
        {route.name === "account" && <Account />}
        {route.name === "inbox" && <Inbox onCount={setUnread} />}
        {route.name === "report" && <ReportPage />}
        {route.name === "operator" && <OperatorPage />}
        {route.name === "join" && <Join projectId={route.projectId} token={route.token} />}
        {route.name === "repo" && <Repo projectId={route.projectId} tab={route.tab} params={route.params} />}
      </main>
      <footer className="px-4 sm:px-6 py-3 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 border-t border-border">
        <a href="/terms" className="hover:underline">Terms</a>
        <a href="/privacy" className="hover:underline">Privacy</a>

      </footer>
      </div>
      <RepositorySearch open={searchOpen} close={() => { setSearchOpen(false); setSidebarOpen(false); }} />
    </div>
  );
}
