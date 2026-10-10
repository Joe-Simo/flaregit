import React, { createContext, useCallback, useContext, useEffect, useId, useState } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

type Report = (source: string, needsAttention: boolean) => void;
const AttentionContext = createContext<Report | null>(null);

/**
 * Lets a panel inside <NeedsAttention> say whether it has a confirmed problem (failed, blocked,
 * needs recovery). Outside a <NeedsAttention> wrapper the call does nothing.
 */
export function useReportAttention(needsAttention: boolean): void {
  const report = useContext(AttentionContext);
  const source = useId();
  useEffect(() => {
    if (!report) return;
    report(source, needsAttention);
    return () => report(source, false);
  }, [report, source, needsAttention]);
}

/**
 * Shows recovery panels inline while they are healthy. Only when a panel reports a confirmed problem
 * (or the caller passes `attention`) are they gathered behind one "Needs attention · Resolve" alert.
 * Children stay mounted in both states so they keep their loaded state.
 */
export function NeedsAttention({ children, label = "Needs attention", description, attention = false, className }: { children: React.ReactNode; label?: string; description?: string; attention?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [reports, setReports] = useState<Readonly<Record<string, boolean>>>({});
  const report = useCallback<Report>((source, needs) => setReports(previous => previous[source] === needs ? previous : { ...previous, [source]: needs }), []);
  const active = attention || Object.values(reports).some(Boolean);
  const id = useId();
  return (
    <AttentionContext.Provider value={report}>
      <div className={cn(active && "rounded-md border border-amber-500/40 bg-amber-500/10", className)}>
        {active && <div role="alert" className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
          <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0"><span className="font-medium">{label}</span>{description && <span className="block text-xs opacity-90">{description}</span>}</span>
          <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {open ? "Hide" : "Resolve"}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </button>
        </div>}
        <div id={id} hidden={active && !open} className={cn("space-y-3", active && "border-t border-amber-500/30 bg-background p-3")}>{children}</div>
      </div>
    </AttentionContext.Provider>
  );
}
