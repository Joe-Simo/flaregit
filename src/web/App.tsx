import React, { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { BillingBar } from "./components/BillingBar";
import { Home } from "./pages/Home";
import { NewRepo } from "./pages/NewRepo";
import { Repo } from "./pages/Repo";
import { Join } from "./pages/Join";
import { Account } from "./pages/Account";
import { Inbox } from "./pages/Inbox";
import { apiJson } from "./api";
import { navigate, useRoute } from "./router";

export function App() {
  const route = useRoute();
  const [previewBase, setPreviewBase] = useState("");
  const [degraded, setDegraded] = useState<string[]>([]);
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const poll = () => apiJson<{ unread: { direct: number } }>("/inbox?filter=direct").then((r) => setUnread(r.unread.direct)).catch(() => undefined);
    void poll();
    const t = setInterval(poll, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    apiJson<{ previewBase: string }>("/config").then((c) => setPreviewBase(c.previewBase)).catch(() => undefined);
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
      <header className="border-b border-border bg-card/60 px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <button className="flex items-center gap-2 font-bold" onClick={() => navigate("/")} aria-label="FlareGit home">
          <span className="h-8 w-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white"><GitBranch className="h-5 w-5" /></span>
          FlareGit
        </button>
        <span className="hidden md:block text-xs text-muted-foreground">Work in parallel. Integration happens automatically.</span>
        <div className="flex items-center gap-4 mr-14">
          <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => navigate("/inbox")}>
            Inbox{unread > 0 && <span className="ml-1 rounded-full bg-orange-500 px-1.5 text-xs text-white" aria-label={`${unread} need you`}>{unread}</span>}
          </button>
          <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => navigate("/account")}>Account</button>
        </div>
      </header>
      {degraded.length > 0 && (
        <div role="status" className="px-6 py-2 text-sm bg-amber-500/15 border-b border-amber-500/30 text-amber-200">
          Degraded right now: {degraded.join(", ")}. Integrations may be delayed. <a className="underline" href="/status">Details</a>
        </div>
      )}
      <BillingBar refreshKey={0} />
      <main className="flex-1">
        {route.name === "home" && <Home />}
        {route.name === "new" && <NewRepo />}
        {route.name === "account" && <Account />}
        {route.name === "inbox" && <Inbox onCount={setUnread} />}
        {route.name === "join" && <Join projectId={route.projectId} token={route.token} />}
        {route.name === "repo" && <Repo projectId={route.projectId} tab={route.tab} previewBase={previewBase} params={route.params} />}
      </main>
      <footer className="px-6 py-3 text-xs text-muted-foreground flex gap-4 border-t border-border">
        <a href="/terms" className="hover:underline">Terms</a>
        <a href="/privacy" className="hover:underline">Privacy</a>
        <a href="/status" className="hover:underline">Status</a>
        <a href="mailto:support@flaregit.com" className="hover:underline">Support</a>
      </footer>
    </div>
  );
}
