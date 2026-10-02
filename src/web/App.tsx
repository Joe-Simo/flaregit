import React, { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
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

export function App() {
  const route = useRoute();
  const [degraded, setDegraded] = useState<string[]>([]);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const poll = () => apiJson<{ unread: { direct: number } }>("/inbox?filter=direct").then((r) => setUnread(r.unread.direct)).catch(() => undefined);
    void poll();
    const t = setInterval(poll, 60_000);
    return () => clearInterval(t);
  }, []);

  // Warn people before they hit "integrate" if a subsystem they depend on is currently failing.
  useEffect(() => {
    const check = () =>
      fetch("/status.json")
        .then((r) => r.json() as Promise<{ degraded: string[] }>)
        .then((s) => setDegraded(s.degraded))
        .catch(() => undefined);
    void check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground font-sans">
      <header className="border-b border-border bg-card/60 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <button className="flex items-center gap-2 font-bold rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => navigate("/")} aria-label="FlareGit home">
          <span className="h-8 w-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white" aria-hidden="true"><GitBranch className="h-5 w-5" /></span>
          FlareGit
        </button>
        <span className="hidden md:block text-xs text-muted-foreground">Work in parallel. Review what comes together.</span>
        <nav aria-label="Account" className="flex items-center gap-4 sm:mr-14">
          <button className="text-sm text-muted-foreground hover:text-foreground rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => navigate("/inbox")} aria-label={unread > 0 ? `Inbox, ${unread} need you` : "Inbox"}>
            Inbox{unread > 0 && <span className="ml-1 rounded-full bg-orange-500 px-1.5 text-xs text-white" aria-hidden="true">{unread}</span>}
          </button>
          <button className="text-sm text-muted-foreground hover:text-foreground rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => navigate("/account")}>Account</button>
        </nav>
      </header>
      {degraded.length > 0 && (
        <div role="status" className="px-4 sm:px-6 py-2 text-sm bg-amber-500/15 border-b border-amber-500/30 text-amber-200">
          Degraded right now: {degraded.join(", ")}. Integrations may be delayed. <a className="underline" href="/status">Details</a>
        </div>
      )}
      <BillingBar refreshKey={0} />
      <main className="flex-1 min-w-0 overflow-x-clip">
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
        <a href="/status" className="hover:underline">Status</a>
        <a href="#/report" className="hover:underline">Report abuse</a>
        <a href="mailto:support@flaregit.com" className="hover:underline">Support</a>
      </footer>
    </div>
  );
}
