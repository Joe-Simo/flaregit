import { CloudflareBadgeFooter } from "./components/CloudflareBadge";
import React, { useEffect, useRef, useState } from "react";
import { GitBranch, Search, Menu, X, Inbox as InboxIcon, Settings, FolderGit2, Plus, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchDialog, type SearchLoader } from "./components/SearchDialog";
import { BillingBar } from "./components/BillingBar";
import { Home } from "./pages/Home";
import { PublicParticipation } from "./pages/PublicParticipation";
import { Community, CommunityCompose } from "./pages/Community";
import { NewRepo } from "./pages/NewRepo";
import { Repo } from "./pages/Repo";
import { Join } from "./pages/Join";
import { Account } from "./pages/Account";
import { Inbox } from "./pages/Inbox";
import { OperatorPage, ReportPage } from "./pages/Reports";
import { apiJson } from "./api";
import { navigate, useRoute } from "./router";

const loadSearch: SearchLoader = async (query, signal) => {
  const response = await apiJson<{ results: { id: string; kind: string; title: string; description: string; href: string }[]; incomplete: boolean }>(`/search?q=${encodeURIComponent(query)}`, { signal });
  return { results: response.results.map(result => ({ ...result, group: result.kind.charAt(0).toUpperCase() + result.kind.slice(1) })), incomplete: response.incomplete };
};

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
  const section = route.name === "home" ? "Repositories" : route.name === "repo" ? "Repository" : route.name === "new" ? "New repository" : route.name === "inbox" ? "Inbox" : route.name === "account" ? "Account" : (route.name === "community" || route.name === "community-post") ? "Community" : route.name === "participate" ? "Public participation" : "Workspace";
  const nav = [{ name: "Repositories", path: "/", current: route.name === "home" || route.name === "repo", Icon: FolderGit2 }, { name: "Community", path: "/community", current: route.name === "community" || route.name === "community-post", Icon: MessageSquare }, { name: "Inbox", path: "/inbox", current: route.name === "inbox", Icon: InboxIcon }, { name: "Account", path: "/account", current: route.name === "account", Icon: Settings }];
  return (
    <div className="dashboard-shell min-h-screen bg-background text-foreground">
      <a href="#workspace-content" onClick={(event) => { event.preventDefault(); document.getElementById("workspace-content")?.focus(); }} className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-card focus:px-4 focus:py-2">Skip to content</a>
      <header className="h-14 border-b border-border flex items-center gap-3 px-4 lg:pl-[264px] pr-16 bg-card">
        <Button ref={menuButton} size="icon" variant="ghost" className="lg:hidden" aria-label={sidebarOpen ? "Close navigation" : "Open navigation"} aria-controls="workspace-navigation" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((value) => !value)}>{sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}</Button>
        <span className="text-xs text-muted-foreground hidden sm:inline">Workspace</span><span className="text-border hidden sm:inline">/</span><span className="text-sm font-medium truncate">{section}</span>
        <Button variant="ghost" size="sm" className="ml-auto gap-2 text-muted-foreground" onClick={() => setSearchOpen(true)} aria-label="Search repositories, changes and issues, Command or Control K"><Search className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">Quick search</span><kbd className="hidden sm:inline text-[10px] border border-border rounded px-1.5 py-0.5">⌘ K</kbd></Button>
      </header>
      <aside id="workspace-navigation" className={`dashboard-sidebar border-r border-border lg:fixed lg:inset-y-0 lg:left-0 lg:w-[240px] lg:flex flex-col ${sidebarOpen ? "flex border-b" : "hidden"}`}>
        <button className="h-14 px-5 flex items-center gap-2.5 border-b border-border font-semibold text-lg tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => { navigate("/"); setSidebarOpen(false); }} aria-label="FlareGit repositories"><span className="h-7 w-7 rounded-md bg-primary flex items-center justify-center text-primary-foreground"><GitBranch className="h-4 w-4" aria-hidden="true" /></span>FlareGit</button>
        <nav aria-label="Workspace" className="p-3 space-y-1">{nav.map(({ name, path, current, Icon }) => <Button key={path} variant="ghost" className="dashboard-nav w-full justify-start h-9 text-[13px] font-normal rounded-md" aria-current={current ? "page" : undefined} onClick={() => { navigate(path); setSidebarOpen(false); }}><Icon className="h-4 w-4 mr-2.5 text-muted-foreground" aria-hidden="true" />{name}{name === "Inbox" && unread > 0 && <span className="ml-auto text-[11px] rounded bg-primary/10 text-primary px-1.5">{unread}</span>}</Button>)}<Button variant="ghost" className="w-full justify-start h-9 text-[13px] font-normal text-muted-foreground" onClick={() => { navigate("/new"); setSidebarOpen(false); }}><Plus className="h-4 w-4 mr-2.5" aria-hidden="true" />New repository</Button></nav>
        <div className="lg:mt-auto p-4 border-t border-border space-y-4"><div className="flex flex-wrap gap-x-3 gap-y-2 text-[11px] text-muted-foreground"><a href="/docs" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Docs</a><a href="/status" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Status</a><a href="#/report" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Report abuse</a><a href="mailto:support@flaregit.com" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Support</a></div></div>
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
        {route.name === "participate" && <PublicParticipation key={route.projectId} projectId={route.projectId} />}
        {route.name === "community" && <Community workspace />}
        {route.name === "community-post" && <CommunityCompose key={`${route.params.get("repo") ?? "help"}:${route.params.get("topic") ?? "new"}`} repository={route.params.get("repo") ?? undefined} topic={route.params.get("topic") ?? undefined} />}
        {route.name === "new" && <NewRepo />}
        {route.name === "account" && <Account />}
        {route.name === "inbox" && <Inbox onCount={setUnread} />}
        {route.name === "report" && <ReportPage key={route.params.get("target") ?? "report"} initialTarget={route.params.get("target")} initialKind={route.params.get("kind")} />}
        {route.name === "operator" && <OperatorPage />}
        {route.name === "join" && <Join projectId={route.projectId} token={route.token} />}
        {route.name === "repo" && <Repo projectId={route.projectId} tab={route.tab} params={route.params} />}
      </main>
      <footer className="px-4 sm:px-6 py-3 text-xs text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border">
        <a href="/terms" className="hover:underline">Terms</a>
        <a href="/privacy" className="hover:underline">Privacy</a>
        <CloudflareBadgeFooter />
      </footer>
      </div>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} load={loadSearch} onNavigate={href => { setSidebarOpen(false); if (href.startsWith("/#/")) navigate(href.slice(2)); else window.location.assign(href); }} />
    </div>
  );
}
