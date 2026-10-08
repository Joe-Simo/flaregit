import {Snippets} from './pages/Snippets';
import { FlareGitBrand } from "./components/Brand";
import { InvitationSignIn } from "./pages/InvitationSignIn";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ClerkProvider, SignIn, UserButton, useAuth, useSession } from "@clerk/clerk-react";
import { RefreshCw, Sun, ArrowUpRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { bindApiSession,clearVerifiedApiSession } from "./api";
import { Landing } from "./pages/Landing";
import { AppearanceDialog, useTheme } from "./ThemeProvider";
import { PublicRepo } from "./pages/PublicRepo";
import { Docs } from "./pages/Docs";
import { PublicProfile } from "./pages/PublicProfile";
import { Pricing } from "./pages/Pricing";
import { About } from "./pages/About";
import { Community } from "./pages/Community";
import { CloudflareBadgeFooter } from "./components/CloudflareBadge";
import { safeSignInReturn, explicitSignInReturn, initialSignInReturn, isSignInCallback, callbackSignInReturn, initialSignInActive } from "./sign-in-return";
import { authTransition, authRecoveryPending, authWorkspaceIntent, recoverSignIn } from "./auth-transition";
import { loadAuthConfiguration } from "./auth-configuration";
import { navigate, useRoute } from "./router";

const RETURN_KEY = "flaregit.signInReturn";
function rememberedReturn(): string | null { try { const value = sessionStorage.getItem(RETURN_KEY); return value ? safeSignInReturn(value) : null; } catch { return null; } }
function restoreReturn(destination: string | null) { try { sessionStorage.removeItem(RETURN_KEY); } catch { /* Session storage is optional. */ } if (destination) navigate(destination); }
function SignInReturn({ destination }: { destination: string | null }) {
  useEffect(() => { restoreReturn(destination); }, [destination]);
  return null;
}
export function AuthTransitionSurface({snapshot,signingIn,workspaceIntent=false,onRetry,signedOut,signedIn,landing}:{snapshot:Parameters<typeof authTransition>[0];signingIn:boolean;workspaceIntent?:boolean;onRetry:()=>void;signedOut:React.ReactNode;signedIn:React.ReactNode;landing:React.ReactNode}){
  const phase=authTransition(snapshot),securePending=authRecoveryPending(snapshot,signingIn,workspaceIntent);
  const [expired,setExpired]=useState(false);
  useEffect(()=>{setExpired(false);if(!securePending)return;const timer=setTimeout(()=>setExpired(true),15_000);return()=>clearTimeout(timer);},[securePending]);
  if(phase==="signed-out")return signedOut;
  if(phase==="signed-in")return signedIn;
  if(!securePending)return landing;
  return <Entry><h2 className="text-xl font-semibold">{expired?"Sign-in needs another try":"Opening your workspace"}</h2><p role={expired?"alert":"status"} className="mt-4 text-sm text-muted-foreground">{expired?"The authentication service has not finished connecting. Your repository history is preserved.":"Waiting for your secure session…"}</p><Button variant="outline" className="mt-5" onClick={onRetry}>Retry sign-in</Button></Entry>;
}
function AuthSessionController({signingIn,workspaceIntent,destination,signedOut,landing,children}:{signingIn:boolean;workspaceIntent:boolean;destination:string;signedOut:React.ReactNode;landing:React.ReactNode;children:React.ReactNode}){
  const auth=useAuth(),{isLoaded,session}=useSession();
  const snapshot={authLoaded:auth.isLoaded,sessionLoaded:isLoaded,signedIn:auth.isSignedIn,userId:auth.userId,sessionId:session?.id,sessionUserId:session?.user?.id,sessionStatus:session?.status};
  const phase=authTransition(snapshot);
  useLayoutEffect(()=>{if(phase==="signed-out")clearVerifiedApiSession();},[phase]);
  return <AuthTransitionSurface snapshot={snapshot} signingIn={signingIn} workspaceIntent={workspaceIntent} onRetry={()=>recoverSignIn(destination,{replace:url=>window.history.replaceState(null,"",url),reload:()=>window.location.reload()})} signedOut={signedOut} landing={landing} signedIn={session&&auth.userId?<SessionWorkspace key={`${auth.userId}:${session.id}`} principal={`${auth.userId}:${session.id}`} session={session}>{children}</SessionWorkspace>:null}/>;
}
function SessionWorkspace({ principal, session, children }: { principal: string; session: NonNullable<ReturnType<typeof useSession>["session"]>; children: React.ReactNode }) {
  useLayoutEffect(() => bindApiSession(principal, () => session.getToken()), [principal, session]);
  return <>{children}</>;
}

function Entry({ children }: { children: React.ReactNode }) {
  return <div className="entry-shell min-h-screen grid grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-2">
    <section className="flex min-w-0 flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-7 sm:px-8">
        <a href="/" className="inline-flex items-center gap-2 text-base font-semibold tracking-tight rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <FlareGitBrand size={32} />
        </a>
        <a href="/docs" className="rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Documentation</a>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-12 sm:px-10">
        <div className="entry-auth w-full max-w-[450px] min-w-0">{children}</div>
      </main>
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
    <footer className="col-span-full flex flex-wrap items-center justify-between gap-x-4 gap-y-4 px-6 py-6 sm:px-8 text-xs text-muted-foreground">
        <a href="/status" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Service status</a>
        <nav aria-label="Legal" className="flex items-center gap-5"><a href="/terms" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Terms</a><a href="/privacy" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Privacy</a></nav>
        <CloudflareBadgeFooter />
    </footer>
  </div>;
}

/** Signed-out visitors see Clerk's sign-in; signed-in users get the app with their session token attached to API calls. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const docsPage = window.location.pathname === "/docs" || window.location.pathname.startsWith("/docs/");
  const pricingPage = window.location.pathname === "/pricing";
  const aboutPage = window.location.pathname === "/about";
  const communityPage = window.location.pathname === "/community";
  const route = useRoute();
  const workspaceIntent = authWorkspaceIntent(window.location.hash);
  const explicitReturn = explicitSignInReturn(window.location.hash);
  const callbackEntry = isSignInCallback(window.location.hash);
  const [signingIn, setSigningIn] = useState(() => initialSignInActive(window.location.hash, rememberedReturn()));
  const [returnTo, setReturnTo] = useState(() => initialSignInReturn(window.location.hash, rememberedReturn()));
  const beginSignIn = (intent = safeSignInReturn(window.location.hash) ?? "/") => { const destination = safeSignInReturn(intent) ?? "/"; setReturnTo(destination); try { sessionStorage.setItem(RETURN_KEY, destination); } catch { /* In-memory return still supports nonredirect sign-in. */ } setSigningIn(true); };
  const beginInvitationSignIn = (destination: string) => { window.history.replaceState(null, "", `/#${destination}`); window.dispatchEvent(new HashChangeEvent("hashchange")); beginSignIn(destination); };
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const configurationRequest = useRef<AbortController | null>(null);
  const retryConfiguration = () => { configurationRequest.current?.abort(); setError(null); setAttempt(value => value + 1); };

  useLayoutEffect(() => {
    if (!explicitReturn && !callbackEntry) return;
    setSigningIn(true);
    if (!explicitReturn) { setReturnTo(current => callbackSignInReturn(rememberedReturn(), current)); return; }
    setReturnTo(explicitReturn);
    try { sessionStorage.setItem(RETURN_KEY, explicitReturn); } catch { /* In-memory return remains valid. */ }
  }, [explicitReturn, callbackEntry]);

  useEffect(() => {
    if (key || docsPage || pricingPage || aboutPage || communityPage || route.name === "public" || route.name === "profile") return;
    let active = true; const controller = new AbortController();
    configurationRequest.current?.abort(); configurationRequest.current = controller;
    setError(null);
    void loadAuthConfiguration(controller.signal)
      .then(value => { if (active && !controller.signal.aborted) setKey(value); })
      .catch((failure: unknown) => { if (active && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Could not load sign-in. Please retry."); });
    return () => { active = false; controller.abort(); if (configurationRequest.current === controller) configurationRequest.current = null; };
  }, [attempt, route.name, docsPage, pricingPage, aboutPage, communityPage, key]);

  if (docsPage) return <Docs />;
  if (pricingPage) return <Pricing onSignIn={() => window.location.assign("/#/?signin=1")} />;
  if (aboutPage) return <About onSignIn={() => window.location.assign("/#/?signin=1")} />;
  if (communityPage) return <Community onSignIn={() => {
    const hash = window.location.hash.slice(1);
    const query = hash.startsWith("/") ? hash.split("?")[1] ?? "" : hash;
    const destination = safeSignInReturn(`/community${query ? `?${query}` : ""}`) ?? "/community";
    window.location.assign(`/#${destination}${destination.includes("?") ? "&" : "?"}signin=1`);
  }} />;
  if(route.name==="snippets"&&route.accountKey&&route.id)return <Snippets key={`${route.accountKey}:${route.id}`} accountKey={route.accountKey} id={route.id}/>;
  if (route.name === "profile") return <PublicProfile key={route.handle} handle={route.handle} />;
  if (route.name === "public") return <PublicRepo key={route.projectId} projectId={route.projectId} params={route.params} onSignIn={() => { beginSignIn(`/participate/${route.projectId}`); navigate(`/participate/${route.projectId}`); }} />;

  if (!key && !signingIn && !workspaceIntent) return <Landing onSignIn={() => beginSignIn()} />;
  if (error) return <Entry><div className="rounded-xl border border-border bg-card p-6 sm:p-8">
    <h2 className="text-xl font-semibold tracking-tight">Sign in to your workspace</h2>
    <p role="alert" className="mt-4 text-sm leading-relaxed text-destructive">{error}</p>
    <Button className="mt-5" variant="outline" onClick={retryConfiguration}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Retry sign-in</Button>
  </div></Entry>;
  if (!key) return <Entry><div className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground"><p role="status">Loading sign-in…</p><Button variant="outline" className="mt-5" onClick={retryConfiguration}>Retry sign-in setup</Button></div></Entry>;

  const invitationResumeLanding = route.name === "join-resume" ? <Entry><div className="space-y-4 text-sm"><h1 className="text-2xl font-semibold">Sign in to review your saved invitation</h1><p className="text-muted-foreground">FlareGit will recover this invitation after sign-in. Joining still requires your decision.</p><Button onClick={() => beginSignIn(`/join-resume?context=${route.nonce}`)}>Continue to sign in</Button><Button variant="ghost" onClick={() => navigate("/")}>Go to your repositories</Button></div></Entry> : <Landing onSignIn={() => beginSignIn()} />;
  return (
    <ClerkProvider publishableKey={key}>
      <AuthSessionController signingIn={signingIn} workspaceIntent={workspaceIntent} destination={returnTo} landing={route.name === "join" ? <Entry><InvitationSignIn projectId={route.projectId} token={route.token} onPrepared={beginInvitationSignIn} onCancel={()=>{window.history.replaceState(null,"","/#/");window.dispatchEvent(new HashChangeEvent("hashchange"));}} /></Entry> : invitationResumeLanding} signedOut={
        !signingIn ? route.name === "join" ? <Entry><InvitationSignIn projectId={route.projectId} token={route.token} onPrepared={beginInvitationSignIn} onCancel={()=>{window.history.replaceState(null,"","/#/");window.dispatchEvent(new HashChangeEvent("hashchange"));}} /></Entry> : invitationResumeLanding : <Entry>
          <Button variant="ghost" className="mb-6 -ml-3 text-muted-foreground" onClick={() => { try { sessionStorage.removeItem(RETURN_KEY); } catch { /* No stored return. */ } setSigningIn(false); }}>Back to FlareGit</Button>
          <SignIn routing="hash" forceRedirectUrl={`/#${returnTo}`} signUpForceRedirectUrl={`/#${returnTo}`} appearance={{
            variables: { colorPrimary: "#e85412", colorBackground: resolvedTheme === "dark" ? "#151515" : "#ffffff", colorText: resolvedTheme === "dark" ? "#f4f4f4" : "#202020", colorTextSecondary: resolvedTheme === "dark" ? "#a3a3a3" : "#666666", colorInputBackground: resolvedTheme === "dark" ? "#0a0a0a" : "#ffffff", colorInputText: resolvedTheme === "dark" ? "#f4f4f4" : "#202020", borderRadius: "0.5rem", fontFamily: "Inter, sans-serif", fontSize: "1rem" },
            elements: { rootBox: "w-full", cardBox: "w-full shadow-none border-0 rounded-none", card: "shadow-none border-0 bg-transparent p-0", headerTitle: "text-[30px] leading-tight font-semibold tracking-tight", headerSubtitle: "text-muted-foreground", socialButtonsBlockButton: "h-12 border border-border text-foreground shadow-none", formFieldInput: "h-12 border border-border shadow-none", formButtonPrimary: "h-12 shadow-none normal-case font-medium", footer: "bg-transparent shadow-none p-0 pt-6", footerAction: "justify-center", dividerLine: "bg-border" },
          }} />
          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">By continuing you agree to the <a className="underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/terms">Terms</a> and <a className="underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/privacy">Privacy Policy</a>.</p>
        </Entry>
      }>
        <SignInReturn destination={explicitReturn ?? rememberedReturn()} />
        <div className="fixed right-4 top-3 z-50">
          <UserButton><UserButton.MenuItems><UserButton.Action label="Appearance" labelIcon={<Sun className="h-4 w-4" aria-hidden />} onClick={() => setAppearanceOpen(true)} /></UserButton.MenuItems></UserButton>
        </div>
        <AppearanceDialog open={appearanceOpen} onOpenChange={setAppearanceOpen} />
        {children}
      </AuthSessionController>
    </ClerkProvider>
  );
}
