import React from "react";
import { cn } from "@/lib/utils";

/**
 * Collapsed home for low-level diagnostics (raw ids, ref reads, record logs, method names) so the
 * surrounding panel can speak in plain language while the exact values stay one click away.
 */
export function TechnicalDetails({ children, summary = "Technical details", className }: { children: React.ReactNode; summary?: string; className?: string }) {
  return (
    <details className={cn("text-xs text-muted-foreground", className)}>
      <summary className="cursor-pointer w-fit rounded font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{summary}</summary>
      <div className="mt-2 space-y-1 break-all font-mono">{children}</div>
    </details>
  );
}
