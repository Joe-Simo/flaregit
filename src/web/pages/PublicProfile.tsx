import { useEffect, useState } from "react";
import { ArrowRight, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CloudflareBadge } from "../components/CloudflareBadge";
import { ThemeSelector } from "../ThemeProvider";
import type { PublicContribution } from "@/server/public-profile";
interface PublishedProfile { profile: { handle: string; displayName: string; bio: string; joinedAt: string; identityVerification: "self-described" }; contributions: PublicContribution[]; contributionScope: string }
export function PublicProfile({ handle }: { handle: string }) {
  const [data, setData] = useState<PublishedProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/profiles/${encodeURIComponent(handle)}`, { credentials: "omit", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 404 ? "This profile is private or unavailable." : response.status === 409 ? "Public profile state changed while loading. Retry to read its current state." : response.status === 429 ? "Too many profile requests. Please wait before retrying." : "Public profile could not be loaded.");
        const result = await response.json() as PublishedProfile;
        if (!controller.signal.aborted) setData(result);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Profile could not be loaded."); }
    })();
    return () => controller.abort();
  }, [handle, attempt]);
  useEffect(() => { document.title = `@${handle} · FlareGit`; }, [handle]);
  return <div className="min-h-screen bg-background text-foreground"><header className="border-b border-border"><div className="mx-auto max-w-[1100px] flex flex-wrap items-center justify-between gap-4 px-6 py-4"><a href="/" className="inline-flex items-center gap-2 text-sm font-semibold"><GitBranch className="h-5 w-5 text-orange-600" aria-hidden />FlareGit</a><div className="flex items-center gap-4"><a href="/docs" className="text-xs text-muted-foreground">Docs</a><ThemeSelector compact /><a href="/#/" className="text-xs">Dashboard</a></div></div></header><main className="mx-auto max-w-[900px] px-6 py-12 sm:py-16">
    {error && <div className="space-y-4"><h1 className="text-2xl font-medium tracking-tight">Profile unavailable</h1><p role="alert" className="text-sm text-muted-foreground">{error}</p><Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry</Button></div>}
    {!data && !error && <p role="status" className="text-sm text-muted-foreground">Loading public profile…</p>}
    {data && <><div className="border-b border-border pb-9"><p className="font-mono text-xs text-muted-foreground mb-4">@{data.profile.handle}</p><h1 className="text-3xl font-medium tracking-tight break-words">{data.profile.displayName}</h1>{data.profile.bio && <p className="mt-5 max-w-xl text-sm leading-7 text-muted-foreground whitespace-pre-wrap break-words">{data.profile.bio}</p>}<div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground"><span>Joined {new Date(data.profile.joinedAt).toLocaleDateString()}</span><a href={`/#/report?kind=impersonation&target=${encodeURIComponent(`/#/profile/${data.profile.handle}`)}&signin=1`} className="underline underline-offset-4">Report impersonation</a></div></div><section aria-labelledby="public-contributions-title" className="pt-9"><h2 id="public-contributions-title" className="text-lg font-medium tracking-tight">Accepted contributions</h2><p className="mt-3 mb-6 text-xs leading-6 text-muted-foreground">{data.contributionScope}</p>{data.contributions.length ? <ul className="divide-y divide-border border-y border-border">{data.contributions.map(contribution => <li key={`${contribution.repository.id}:${contribution.commit}:${contribution.acceptedAt}`} className="py-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><a href={`/#/public/${contribution.repository.id}?view=code&commit=${encodeURIComponent(contribution.commit)}`} className="inline-flex items-center gap-2 text-sm font-medium break-all">{contribution.repository.name}<ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden /></a><div className="text-xs text-muted-foreground flex flex-wrap gap-3"><code title={contribution.commit}>{contribution.commit.slice(0, 12)}</code><span>Accepted {new Date(contribution.acceptedAt).toLocaleDateString()}</span></div></li>)}</ul> : <p className="text-sm text-muted-foreground py-6 border-y border-border">No accepted contributions are available in this public view.</p>}</section><p className="mt-10 text-xs leading-6 text-muted-foreground">Profile names and biographies are supplied by the account holder. FlareGit has not verified the person’s identity.</p></>}
  </main><footer className="border-t border-border"><div className="mx-auto max-w-[1100px] flex flex-wrap items-center gap-5 px-6 py-6 text-xs text-muted-foreground"><a href="/status">Status</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><CloudflareBadge className="ml-auto" /></div></footer></div>;
}
