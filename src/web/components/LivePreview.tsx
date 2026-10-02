import React, { useEffect, useState } from "react";
import { Monitor, ShieldCheck } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface LivePreviewProps {
  currentCommit: string;
  /** Origin that serves previews; must differ from the app origin. */
  previewBase: string;
}

/** Renders the real application built from the accepted commit (never a re-implementation). */
export function LivePreview({ currentCommit, previewBase }: LivePreviewProps) {
  const src = `${previewBase}/preview/${currentCommit}/`;
  const [ready, setReady] = useState(false);

  // The build for a commit is created on demand; poll until it exists instead of showing a blank pane.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    setReady(false);
    const check = async () => {
      try {
        const res = await fetch(src, { method: "GET" });
        if (res.ok) {
          if (!cancelled) setReady(true);
          return;
        }
      } catch {
        /* retry */
      }
      if (!cancelled && ++attempts < 90) setTimeout(check, 4000);
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <Card className="h-full flex flex-col border-border/80 bg-card/70 backdrop-blur-sm overflow-hidden">
      <CardHeader className="py-3 px-5 border-b border-border/60 bg-muted/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Accepted application</CardTitle>
            <Badge variant="success" className="text-[11px] gap-1">
              <ShieldCheck className="h-3 w-3" />
              <span>Built from {currentCommit.slice(0, 7)}</span>
            </Badge>
          </div>
          <span className="text-xs font-mono text-muted-foreground">/preview/{currentCommit.slice(0, 7)}</span>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 bg-background/30">
        {ready ? (
          <iframe
            key={currentCommit}
            title={`Accepted build ${currentCommit.slice(0, 7)}`}
            src={src}
            sandbox="allow-scripts allow-same-origin"
            className="w-full h-full min-h-[560px] border-0 bg-white"
          />
        ) : (
          <div className="flex h-full min-h-[560px] items-center justify-center text-sm text-muted-foreground">
            Building your preview… this takes about a minute the first time.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
