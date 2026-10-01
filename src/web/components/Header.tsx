import React from "react";
import { GitBranch, GitCommit, Play, FileText, CheckCircle2, ShieldCheck, Sparkles, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface HeaderProps {
  currentCommit: string;
  onRunScenario: (act: "act1" | "act2" | "act3") => void;
  onOpenEvidence: () => void;
  isRunningScenario: boolean;
  activeAct: string | null;
}

export function Header({
  currentCommit,
  onRunScenario,
  onOpenEvidence,
  isRunningScenario,
  activeAct,
}: HeaderProps) {
  return (
    <header className="border-b border-border bg-card/60 backdrop-blur-md sticky top-0 z-40 px-6 py-3.5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left: Branding & Core Identity */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-amber-500 via-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20 text-white font-bold text-xl">
            <GitBranch className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xl tracking-tight text-foreground">FlareGit</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-mono font-medium">
                flaregit.com
              </span>
              <Badge variant="outline" className="hidden sm:inline-flex text-[11px] text-muted-foreground border-border/80">
                Next-Gen Git Platform
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <span>Work in parallel.</span>
              <span className="text-primary font-semibold">Integration happens automatically.</span>
            </p>
          </div>
        </div>

        {/* Center: Authoritative Canonical State */}
        <div className="hidden lg:flex items-center gap-3 px-3 py-1.5 rounded-lg bg-muted/60 border border-border/60 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium">canonical/main</span>
          </div>
          <span className="text-border">|</span>
          <div className="flex items-center gap-1.5">
            <GitCommit className="h-3.5 w-3.5 text-emerald-400" />
            <span className="font-mono text-emerald-400 font-semibold">{currentCommit.slice(0, 7)}</span>
          </div>
          <span className="text-border">|</span>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Layers className="h-3 w-3 text-orange-400" />
            <span>Artifacts + Workers AI</span>
          </div>
        </div>

        {/* Right: Quick Scenario Launchers & Evidence */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRunScenario("act1")}
            disabled={isRunningScenario}
            className={activeAct === "act1" ? "border-primary text-primary" : ""}
          >
            <Play className="h-3.5 w-3.5 mr-1.5 text-amber-500" />
            <span>Act I: Text Conflict</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => onRunScenario("act2")}
            disabled={isRunningScenario}
            className={activeAct === "act2" ? "border-primary text-primary" : ""}
          >
            <Play className="h-3.5 w-3.5 mr-1.5 text-blue-500" />
            <span>Act II: Semantic Conflict</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={() => onRunScenario("act3")}
            disabled={isRunningScenario}
            className={activeAct === "act3" ? "border-primary text-primary" : ""}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5 text-purple-500" />
            <span>Act III: Contradiction</span>
          </Button>

          <Button
            size="sm"
            variant="orange"
            onClick={onOpenEvidence}
          >
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            <span>Audit Evidence</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
