import React, { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * Collapses recovery panels behind one "Needs attention · Resolve" alert. Panels stay mounted
 * so they keep reading their real state; the alert only appears once a panel renders something.
 */
export function NeedsAttention({ children, label = "Needs attention", className }: { children: React.ReactNode; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const element = content.current;
    if (!element) return;
    const observe = () => setPresent(element.childElementCount > 0 && (element.textContent ?? "").trim().length > 0);
    observe();
    const observer = new MutationObserver(observe);
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn(present ? "rounded-md border border-amber-500/40 bg-amber-500/10" : "hidden", className)}>
      <div role="alert" className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
        <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="font-medium">{label}</span>
        <CollapsibleTrigger aria-controls={id} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {open ? "Hide" : "Resolve"}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent forceMount id={id} className="space-y-3 border-t border-amber-500/30 bg-background p-3 data-[state=closed]:hidden">
        <div ref={content} className="space-y-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
