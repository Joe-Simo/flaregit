import { CloudflareBadgeFooter } from "../components/CloudflareBadge";
import { PublicSearchButton } from "../components/SearchDialog";
import { ArrowRight, ArrowUpRight, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeSelector } from "../ThemeProvider";

function ContributionGraphic() {
  const blocks = [
    [45, 270], [95, 270], [145, 270], [195, 270], [245, 270], [295, 270], [345, 270],
    [95, 220], [145, 220], [245, 220], [295, 220],
    [95, 170], [245, 170], [295, 170],
    [95, 120], [145, 120], [245, 120], [145, 70], [245, 70], [245, 20],
  ] as const;
  return <figure className="mx-auto w-full max-w-[470px] lg:self-end lg:translate-y-[100px]">
    <svg viewBox="0 0 470 320" className="w-full" role="img" aria-labelledby="work-title work-description">
      <title id="work-title">Parallel work, a shared foundation</title>
      <desc id="work-description">An original abstract illustration of separate contributions: fine orange, yellow and turquoise strokes form independent modular columns that join a shared lower row. This illustrates the collaboration workflow, not actual repository activity.</desc>
      {blocks.map(([x, y], index) => {
        const color = index === 18 ? '#14b8a6' : index === 2 || index === 13 ? '#f3bd22' : '#f36a16';
        const height = index % 3 === 0 ? 43 : index % 3 === 1 ? 38 : 45;
        return <g key={index} stroke={color} strokeWidth="1.25">{Array.from({ length: 10 }, (_, stripe) => <line key={stripe} x1={x + stripe * 4.5} x2={x + stripe * 4.5} y1={y} y2={y + height} />)}</g>;
      })}
    </svg>
  </figure>;
}

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  return <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: 'var(--font-sans)' }}>
    <header className="border-b border-border/60">
      <div className="mx-auto flex min-h-[60px] max-w-[1100px] flex-wrap items-center justify-between gap-3 px-6 py-2.5 lg:px-0">
        <a href="#/" className="flex items-center gap-2 text-base font-semibold tracking-tight" aria-label="FlareGit home"><GitBranch className="h-5 w-5 text-[#d04400]" aria-hidden />FlareGit</a>
        <nav aria-label="Primary" className="flex flex-wrap items-center gap-3 sm:gap-6"><a href="#how-it-works" className="hidden text-xs text-muted-foreground hover:text-foreground sm:block">How it works</a><a href="/docs" className="text-xs text-muted-foreground hover:text-foreground">Docs</a><a href="/community" className="text-xs text-muted-foreground hover:text-foreground">Community</a><a href="/pricing" className="text-xs text-muted-foreground hover:text-foreground">Pricing</a><a href="/about" className="text-xs text-muted-foreground hover:text-foreground">About</a><PublicSearchButton /><ThemeSelector compact /><Button variant="ghost" size="sm" onClick={onSignIn}>Sign in <ArrowUpRight className="ml-1 h-3 w-3" aria-hidden /></Button></nav>
      </div>
    </header>
    <main className="relative">
      <div className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(hsl(var(--muted-foreground) / .4) .6px, transparent .6px)', backgroundSize: '12px 12px' }} aria-hidden />
      <div className="relative mx-auto max-w-[1100px] border-x border-border/50 bg-background">
        <section className="grid min-h-[520px] items-center gap-9 px-6 py-16 sm:px-12 lg:grid-cols-[1fr_1fr] lg:gap-12 lg:px-14 lg:py-[100px]">
          <div className="max-w-[355px]">
            <p className="mb-5 text-[11px] text-muted-foreground">Git collaboration for people and agents</p>
            <h1 className="text-[32px] font-medium leading-[1.18] tracking-[-.025em] sm:text-[34px]">Git for parallel work.</h1>
            <p className="mt-5 max-w-[330px] text-base leading-[1.6] text-muted-foreground">Independent workspaces. Visible overlaps. A shared conversation and a human decision about what lands.</p>
            <Button variant="orange" onClick={onSignIn} className="mt-7 h-10 rounded-full bg-none bg-[#d04400] px-5 text-[13px] font-medium text-white shadow-none hover:bg-[#bb3d00]">Start collaborating <ArrowRight className="ml-3 h-3.5 w-3.5" aria-hidden /></Button>
            <p className="mt-4 text-[11px] text-muted-foreground">Working prototype · Cloudflare Workers & Artifacts</p>
          </div>
          <ContributionGraphic />
        </section>
        <section id="how-it-works" className="border-t border-border/60">
          <div className="px-6 pb-10 pt-12 text-center sm:px-12"><h2 className="text-[28px] font-medium tracking-[-.025em]">One project. Room to contribute.</h2><p className="mx-auto mt-3 max-w-[440px] text-sm leading-6 text-muted-foreground">Keep the people, context and original work behind every change.</p></div>
          <div className="grid border-t border-border/60 md:grid-cols-3">
            {[
              { number: '01', title: 'Work independently', body: 'Each contribution has an isolated Git workspace. Use your own editor or agent while others keep working.' },
              { number: '02', title: 'See what overlaps', body: 'Follow checkpoints, decisions and conversations. Surface conflicts and stale bases before changes become shared history.' },
              { number: '03', title: 'Choose what lands', body: 'Review the composed diff and checks. A person accepts the exact commit, with original contributions preserved.' },
            ].map(({ number, title, body }) => <article key={number} className="border-b border-border/60 px-6 py-9 last:border-b-0 sm:px-9 md:border-b-0 md:border-r md:last:border-r-0"><p className="mb-6 text-[11px] text-muted-foreground">{number}</p><h3 className="mb-3 text-base font-medium">{title}</h3><p className="text-sm leading-6 text-muted-foreground">{body}</p></article>)}
          </div>
        </section>
        <section className="flex flex-col justify-between gap-5 border-t border-border/60 px-6 py-8 sm:px-9 md:flex-row md:items-center"><p className="max-w-[640px] text-xs leading-6 text-muted-foreground">Core collaboration and basic private repositories are free. Bring your own editor and agents. Integrations run in FlareGit containers with daily limits; connected checks supplement repository verification.</p><a href="https://github.com/Joe-Simo/flaregit" className="flex shrink-0 items-center gap-2 text-xs">View source <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /></a></section>
      </div>
    </main>
    <footer className="border-t border-border/60"><div className="mx-auto flex max-w-[1100px] flex-wrap justify-between gap-4 px-6 py-6 text-[11px] text-muted-foreground lg:px-0"><span>FlareGit</span><div className="flex flex-wrap gap-5"><a href="/status">Status</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:support@flaregit.com">Support</a></div><CloudflareBadgeFooter /></div></footer>
  </div>;
}
