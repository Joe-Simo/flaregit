import React, { useEffect, useState } from "react";
import { ClerkProvider, SignedIn, SignedOut, SignIn, UserButton, useAuth } from "@clerk/clerk-react";
import { setTokenGetter } from "./api";

function TokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setTokenGetter(() => getToken());
  }, [getToken]);
  return null;
}

/** Signed-out visitors see Clerk's sign-in; signed-in users get the app with their session token attached to API calls. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/auth-config")
      .then((r) => (r.ok ? (r.json() as Promise<{ publishableKey?: string }>) : Promise.reject(new Error(String(r.status)))))
      .then((c) => (c.publishableKey ? setKey(c.publishableKey) : setError("Sign-in is not configured yet.")))
      .catch(() => setError("Could not load sign-in. Please retry."));
  }, []);

  if (error) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">{error}</div>;
  if (!key) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;

  return (
    <ClerkProvider publishableKey={key}>
      <SignedOut>
        <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold">FlareGit</h1>
            <p className="text-sm text-muted-foreground mt-1">Work in parallel. Integration happens automatically.</p>
          </div>
          <SignIn routing="hash" />
          <p className="text-xs text-muted-foreground">
            By continuing you agree to the <a className="underline" href="/terms">Terms</a> and <a className="underline" href="/privacy">Privacy Policy</a>.
          </p>
        </div>
      </SignedOut>
      <SignedIn>
        <TokenBridge />
        <div className="fixed right-4 top-3 z-50">
          <UserButton />
        </div>
        {children}
      </SignedIn>
    </ClerkProvider>
  );
}
