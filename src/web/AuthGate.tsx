import React, { useEffect, useLayoutEffect, useState } from "react";
import { ClerkProvider, ClerkLoading, ClerkFailed, SignedIn, SignedOut, SignIn, UserButton, useAuth, useSession } from "@clerk/clerk-react";
import { GitBranch, RefreshCw, Sun, ArrowUpRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { bindApiSession } from "./api";
import { Landing } from "./pages/Landing";
import { AppearanceDialog, useTheme } from "./ThemeProvider";
import { PublicRepo } from "./pages/PublicRepo";
import { Docs } from "./pages/Docs";
import { PublicProfile } from "./pages/PublicProfile";
import { Pricing } from "./pages/Pricing";
import { About } from "./pages/About";
import { Community } from "./pages/Community";
import { CloudflareBadge } from "./components/CloudflareBadge";
import { safeSignInReturn } from "./sign-in-return";
import { navigate, useRoute } from "./router";

const RETURN_KEY = "flaregit.signInReturn";
function rememberedReturn(): string | null { try { const value = sessionStorage.getItem(RETURN_KEY); return value ? safeSignInReturn(value) : null; } catch { return null; } }
function restoreReturn(destination: string | null) { try { sessionStorage.removeItem(RETURN_KEY); } catch { /* Session storage is optional. */ } if (destination) navigate(destination); }
function SignInReturn({ destination }: { destination: string | null }) {
  useEffect(() => { restoreReturn(destination); }, [destination]);
  return null;
}
function SignedInWorkspace({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const { session } = useSession();
  const principal = userId && session ? `${userId}:${session.id}` : null;
  if (!principal || !session) return <p role="status">Loading secure workspace…</p>;
  return <SessionWorkspace key={principal} principal={principal} session={session}>{children}</SessionWorkspace>;
}
function SessionWorkspace({ principal, session, children }: { principal: string; session: NonNullable<ReturnType<typeof useSession>["session"]>; children: React.ReactNode }) {
  useLayoutEffect(() => bindApiSession(principal, () => session.getToken()), [principal, session]);
  return <>{children}</>;
}

function Entry({ children }: { children: React.ReactNode }) {
  return <div className="entry-shell min-h-screen grid lg:grid-cols-2">
    <section className="flex min-h-screen min-w-0 flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-7 sm:px-8">
        <a href="/" className="inline-flex items-center gap-2 text-base font-semibold tracking-tight rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <GitBranch className="h-7 w-7 text-primary" aria-hidden="true" />FlareGit
        </a>
        <a href="/docs" className="rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Documentation</a>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
        <div className="entry-auth w-full max-w-[450px] min-w-0">{children}</div>
      </main>
      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-4 px-6 py-6 sm:px-8 text-xs text-muted-foreground">
        <a href="/status" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Service status</a>
        <nav aria-label="Legal" className="flex items-center gap-5"><a href="/terms" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Terms</a><a href="/privacy" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Privacy</a></nav>
        <CloudflareBadge className="basis-full sm:basis-auto" />
      </footer>
    </section>
    <aside className="hidden min-w-0 bg-muted/30 lg:flex lg:flex-col" aria-labelledby="entry-story">
      <div className="relative min-h-[58vh] overflow-hidden bg-[#ef510c] text-white">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-30 [background-image:repeating-linear-gradient(135deg,transparent_0px,transparent_7px,white_8px,transparent_9px)] [mask-image:linear-gradient(to_right,transparent,black)]" />
        <div className="relative z-10 px-12 py-10 xl:px-20 xl:py-16">
          <p className="font-mono text-sm tracking-wide">Independent work. Shared direction.</p>
          <h1 id="entry-story" className="mt-6 max-w-md text-4xl leading-[1.18] font-semibold tracking-tight">A place for people<br />and agents to build.</h1>
          <p className="mt-6 max-w-sm text-base leading-relaxed">Keep the purpose and people behind each contribution, from the first checkpoint to human review.</p>
          <a href="/docs" className={`${buttonVariants({ variant: "secondary" })} mt-7 h-11 bg-white text-[#202020] hover:bg-white/90`}>Explore FlareGit <ArrowUpRight className="ml-2 h-4 w-4" aria-hidden="true" /></a>
        </div>
      </div>
    </aside>
  </div>;
}

/** Signed-out visitors see Clerk's sign-in; signed-in users get the app with their session token attached to API calls. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const docsPage = window.location.pathname === "/docs" || window.location.pathname.startsWith("/docs/");
  const pricingPage = window.location.pathname === "/pricing";
  const aboutPage = window.location.pathname === "/about";
  const communityPage = window.location.pathname === "/community";
  const route = useRoute();
  const [signingIn, setSigningIn] = useState(() => new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("signin") === "1");
  const [returnTo, setReturnTo] = useState(() => rememberedReturn() ?? safeSignInReturn(window.location.hash) ?? "/");
  const beginSignIn = (intent = safeSignInReturn(window.location.hash) ?? "/") => { const destination = safeSignInReturn(intent) ?? "/"; setReturnTo(destination); try { sessionStorage.setItem(RETURN_KEY, destination); } catch { /* In-memory return still supports nonredirect sign-in. */ } setSigningIn(true); };
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (signingIn && !rememberedReturn()) { const destination = safeSignInReturn(window.location.hash); if (destination) { setReturnTo(destination); try { sessionStorage.setItem(RETURN_KEY, destination); } catch { /* In-memory return remains valid. */ } } }
  }, [signingIn]);

  useEffect(() => {
    if (key || docsPage || pricingPage || aboutPage || communityPage || route.name === "public" || route.name === "profile") return;
    let active = true; const controller = new AbortController();
    setError(null);
    fetch("/auth-config", { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ publishableKey?: string }>) : Promise.reject(new Error(String(r.status)))))
      .then((config) => { if (active) { if (config.publishableKey) setKey(config.publishableKey); else setError("Sign-in is not configured yet."); } })
      .catch(() => { if (active) setError("Could not load sign-in. Please retry."); });
    return () => { active = false; controller.abort(); };
  }, [attempt, route.name, docsPage, pricingPage, aboutPage, communityPage, key]);

  if (docsPage) return <Docs />;
  if (pricingPage) return <Pricing onSignIn={() => window.location.assign("/#/?signin=1")} />;
  if (aboutPage) return <About onSignIn={() => window.location.assign("/#/?signin=1")} />;
  if (communityPage) return <Community onSignIn={() => window.location.assign("/#/community-post?signin=1")} />;
  if (route.name === "profile") return <PublicProfile key={route.handle} handle={route.handle} />;
  if (route.name === "public") return <PublicRepo key={route.projectId} projectId={route.projectId} params={route.params} onSignIn={() => { beginSignIn(`/participate/${route.projectId}`); navigate(`/participate/${route.projectId}`); }} />;

  if (!key && !signingIn) return <Landing onSignIn={() => beginSignIn()} />;
  if (error) return <Entry><div className="rounded-xl border border-border bg-card p-6 sm:p-8">
    <h2 className="text-xl font-semibold tracking-tight">Sign in to your workspace</h2>
    <p role="alert" className="mt-4 text-sm leading-relaxed text-destructive">{error}</p>
    <Button className="mt-5" variant="outline" onClick={() => setAttempt((value) => value + 1)}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Retry sign-in</Button>
  </div></Entry>;
  if (!key) return <Entry><div role="status" className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">Loading sign-in…</div></Entry>;

  return (
    <ClerkProvider publishableKey={key}>
      <ClerkLoading>{signingIn ? <Entry><p role="status" className="text-sm text-muted-foreground">Loading secure sign-in…</p></Entry> : <Landing onSignIn={() => beginSignIn()} />}</ClerkLoading>
      <ClerkFailed><Entry><h2 className="text-xl font-semibold">Sign-in is unavailable</h2><p role="alert" className="mt-4 text-sm text-muted-foreground">The authentication service could not load. Retry to reconnect.</p><Button variant="outline" className="mt-5" onClick={() => window.location.reload()}>Retry sign-in</Button></Entry></ClerkFailed>
      <SignedOut>
        {!signingIn ? <Landing onSignIn={() => beginSignIn()} /> : <Entry>
          <Button variant="ghost" className="mb-6 -ml-3 text-muted-foreground" onClick={() => { try { sessionStorage.removeItem(RETURN_KEY); } catch { /* No stored return. */ } setSigningIn(false); }}>Back to FlareGit</Button>
          <SignIn routing="hash" forceRedirectUrl={`/#${returnTo}`} signUpForceRedirectUrl={`/#${returnTo}`} appearance={{
            variables: { colorPrimary: "#e85412", colorBackground: resolvedTheme === "dark" ? "#151515" : "#ffffff", colorText: resolvedTheme === "dark" ? "#f4f4f4" : "#202020", colorTextSecondary: resolvedTheme === "dark" ? "#a3a3a3" : "#666666", colorInputBackground: resolvedTheme === "dark" ? "#0a0a0a" : "#ffffff", colorInputText: resolvedTheme === "dark" ? "#f4f4f4" : "#202020", borderRadius: "0.5rem", fontFamily: "Inter, sans-serif", fontSize: "1rem" },
            elements: { rootBox: "w-full", cardBox: "w-full shadow-none border-0 rounded-none", card: "shadow-none border-0 bg-transparent p-0", headerTitle: "text-[30px] leading-tight font-semibold tracking-tight", headerSubtitle: "text-muted-foreground", socialButtonsBlockButton: "h-12 border border-border text-foreground shadow-none", formFieldInput: "h-12 border border-border shadow-none", formButtonPrimary: "h-12 shadow-none normal-case font-medium", footer: "bg-transparent shadow-none p-0 pt-6", footerAction: "justify-center", dividerLine: "bg-border" },
          }} />
          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">By continuing you agree to the <a className="underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/terms">Terms</a> and <a className="underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/privacy">Privacy Policy</a>.</p>
        </Entry>}
      </SignedOut>
      <SignedIn>
        <SignedInWorkspace>
        <SignInReturn destination={rememberedReturn()} />
        <div className="fixed right-4 top-3 z-50">
          <UserButton><UserButton.MenuItems><UserButton.Action label="Appearance" labelIcon={<Sun className="h-4 w-4" aria-hidden />} onClick={() => setAppearanceOpen(true)} /></UserButton.MenuItems></UserButton>
        </div>
        <AppearanceDialog open={appearanceOpen} onOpenChange={setAppearanceOpen} />
        {children}
        </SignedInWorkspace>
      </SignedIn>
    </ClerkProvider>
  );
}
