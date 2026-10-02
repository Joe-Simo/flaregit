import React, { useEffect, useState } from "react";
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useAuth } from "@clerk/clerk-react";
import { GitBranch, RefreshCw, GitCommitHorizontal, GitMerge, GitPullRequestArrow, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setTokenGetter } from "./api";
import { Landing } from "./pages/Landing";
import { AppearanceDialog, useTheme } from "./ThemeProvider";
import { PublicRepo } from "./pages/PublicRepo";
import { navigate, useRoute } from "./router";

function TokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setTokenGetter(() => getToken());
  }, [getToken]);
  return null;
}

function Entry({ children }: { children: React.ReactNode }) {
  return <div className="entry-shell min-h-screen flex flex-col">
    <header className="mx-auto w-full max-w-7xl px-6 sm:px-10 py-7 flex items-center justify-between gap-5">
      <a href="/" className="inline-flex items-center gap-2.5 rounded-md text-lg font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><GitBranch className="h-5 w-5" aria-hidden="true" /></span>FlareGit
      </a>
      <a href="/status" className="text-xs text-muted-foreground hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Service status</a>
    </header>
    <main className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-10 px-6 py-8 sm:px-10 sm:py-14 lg:grid-cols-[1.25fr_1fr] lg:items-center lg:gap-20">
      <section aria-labelledby="entry-heading" className="min-w-0">
        <h1 id="entry-heading" className="max-w-lg text-3xl leading-tight font-semibold tracking-tight">Bring your work together.</h1>
        <p className="mt-6 max-w-lg text-base sm:text-lg leading-relaxed text-muted-foreground">Git collaboration for people and coding agents. Give each contribution its own workspace and bring the work together through human review.</p>
        <div className="mt-10 sm:mt-14 border-t border-border pt-7">
          <h2 className="text-sm font-medium">Independent work. Deliberate integration.</h2>
          <ol className="entry-workflow mt-6 grid grid-cols-4 gap-2" aria-label="Contribution workflow">
            {[
              { label: "Work", detail: "Isolated branches", Icon: GitBranch },
              { label: "Save", detail: "Git checkpoints", Icon: GitCommitHorizontal },
              { label: "Review", detail: "Diffs & decisions", Icon: GitPullRequestArrow },
              { label: "Accept", detail: "Repository history", Icon: GitMerge },
            ].map(({ label, detail, Icon }) => <li key={label} className="relative min-w-0">
              <span className="entry-node relative z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background"><Icon className="h-4 w-4 text-primary" aria-hidden="true" /></span>
              <h3 className="mt-3 text-xs sm:text-sm font-medium">{label}</h3>
              <p className="mt-1 text-[10px] sm:text-xs leading-relaxed text-muted-foreground">{detail}</p>
            </li>)}
          </ol>
          <p className="mt-6 max-w-lg text-xs leading-relaxed text-muted-foreground">Keep the purpose, conversations, and contributor behind each change alongside the code.</p>
        </div>
      </section>
      <section aria-label="Sign in" className="entry-auth min-w-0 w-full max-w-md justify-self-center lg:justify-self-end">
        {children}
      </section>
    </main>
    <footer className="mx-auto w-full max-w-7xl px-6 sm:px-10 py-6 flex flex-wrap items-center justify-between gap-3 border-t border-border text-xs text-muted-foreground">
      <p>Work in parallel. Review what comes together.</p>
      <nav aria-label="Legal" className="flex items-center gap-5"><a href="/terms" className="hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Terms</a><a href="/privacy" className="hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Privacy</a></nav>
    </footer>
  </div>;
}

/** Signed-out visitors see Clerk's sign-in; signed-in users get the app with their session token attached to API calls. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const route = useRoute();
  const [signingIn, setSigningIn] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (route.name === "public") return;
    setError(null);
    fetch("/auth-config")
      .then((r) => (r.ok ? (r.json() as Promise<{ publishableKey?: string }>) : Promise.reject(new Error(String(r.status)))))
      .then((c) => (c.publishableKey ? setKey(c.publishableKey) : setError("Sign-in is not configured yet.")))
      .catch(() => setError("Could not load sign-in. Please retry."));
  }, [attempt, route.name]);

  if (route.name === "public") return <PublicRepo key={route.projectId} projectId={route.projectId} params={route.params} onSignIn={() => { setSigningIn(true); navigate("/"); }} />;

  if (!key && !signingIn) return <Landing onSignIn={() => setSigningIn(true)} />;
  if (error) return <Entry><div className="rounded-xl border border-border bg-card p-6 sm:p-8">
    <h2 className="text-xl font-semibold tracking-tight">Sign in to your workspace</h2>
    <p role="alert" className="mt-4 text-sm leading-relaxed text-destructive">{error}</p>
    <Button className="mt-5" variant="outline" onClick={() => setAttempt((value) => value + 1)}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Retry sign-in</Button>
  </div></Entry>;
  if (!key) return <Entry><div role="status" className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">Loading sign-in…</div></Entry>;

  return (
    <ClerkProvider publishableKey={key}>
      <SignedOut>
        {!signingIn ? <Landing onSignIn={() => setSigningIn(true)} /> : <Entry>
          <Button variant="ghost" className="mb-4" onClick={() => setSigningIn(false)}>Back to FlareGit</Button>
          <SignIn routing="hash" appearance={{
            variables: { colorPrimary: "#e85412", colorBackground: resolvedTheme === "dark" ? "#151515" : "#ffffff", colorText: resolvedTheme === "dark" ? "#f4f4f4" : "#202020", colorTextSecondary: resolvedTheme === "dark" ? "#a3a3a3" : "#666666", colorInputBackground: resolvedTheme === "dark" ? "#0a0a0a" : "#ffffff", colorInputText: resolvedTheme === "dark" ? "#f4f4f4" : "#202020", borderRadius: "0.5rem" },
            elements: { rootBox: "w-full", cardBox: "w-full shadow-none border border-border", card: "shadow-none", socialButtonsBlockButton: "border border-border text-foreground", footer: "bg-card" },
          }} />
          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">By continuing you agree to the <a className="underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/terms">Terms</a> and <a className="underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/privacy">Privacy Policy</a>.</p>
        </Entry>}
      </SignedOut>
      <SignedIn>
        <TokenBridge />
        <div className="fixed right-4 top-3 z-50">
          <UserButton><UserButton.MenuItems><UserButton.Action label="Appearance" labelIcon={<Sun className="h-4 w-4" aria-hidden />} onClick={() => setAppearanceOpen(true)} /></UserButton.MenuItems></UserButton>
        </div>
        <AppearanceDialog open={appearanceOpen} onOpenChange={setAppearanceOpen} />
        {children}
      </SignedIn>
    </ClerkProvider>
  );
}
