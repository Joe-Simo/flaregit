import React from "react";
import { CheckCircle2, AlertTriangle, RefreshCw, Cpu, ShieldCheck, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type PipelineStage =
  | "idle"
  | "analyzing"
  | "composing"
  | "repairing"
  | "verifying"
  | "accepted"
  | "decision_needed"
  | "failed";

interface StatusBannerProps {
  stage: PipelineStage;
  message: string;
  detail?: string;
  lastAcceptedCommit: string;
}

export function StatusBanner({
  stage,
  message,
  detail,
  lastAcceptedCommit,
}: StatusBannerProps) {
  const getStageConfig = () => {
    switch (stage) {
      case "analyzing":
      case "composing":
        return {
          icon: <RefreshCw className="h-4 w-4 animate-spin text-amber-400" />,
          badgeVariant: "warning" as const,
          badgeText: "INTEGRATING",
          bg: "bg-amber-950/20 border-amber-500/30",
          textColor: "text-amber-200",
        };
      case "repairing":
        return {
          icon: <Cpu className="h-4 w-4 animate-pulse text-orange-400" />,
          badgeVariant: "default" as const,
          badgeText: "WORKERS AI REPAIR",
          bg: "bg-orange-950/20 border-orange-500/40",
          textColor: "text-orange-200",
        };
      case "verifying":
        return {
          icon: <ShieldCheck className="h-4 w-4 animate-bounce text-blue-400" />,
          badgeVariant: "info" as const,
          badgeText: "PROTECTED VERIFICATION",
          bg: "bg-blue-950/20 border-blue-500/30",
          textColor: "text-blue-200",
        };
      case "decision_needed":
        return {
          icon: <AlertTriangle className="h-4 w-4 text-purple-400" />,
          badgeVariant: "purple" as const,
          badgeText: "DECISION REQUIRED",
          bg: "bg-purple-950/20 border-purple-500/40",
          textColor: "text-purple-200",
        };
      case "failed":
        return {
          icon: <AlertTriangle className="h-4 w-4 text-red-400" />,
          badgeVariant: "destructive" as const,
          badgeText: "INTEGRATION BLOCKED",
          bg: "bg-red-950/20 border-red-500/40",
          textColor: "text-red-200",
        };
      case "accepted":
      case "idle":
      default:
        return {
          icon: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
          badgeVariant: "success" as const,
          badgeText: "ALL SYSTEMS STABLE",
          bg: "bg-emerald-950/20 border-emerald-500/30",
          textColor: "text-emerald-200",
        };
    }
  };

  const config = getStageConfig();

  return (
    <div className={`border-b px-6 py-3 transition-colors duration-200 ${config.bg}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-md bg-background/50 border border-border/50">
            {config.icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Badge variant={config.badgeVariant}>{config.badgeText}</Badge>
              <span className={`text-sm font-semibold ${config.textColor}`}>
                {message}
              </span>
            </div>
            {detail && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {detail}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground self-start sm:self-center">
          <span>Protected canonical HEAD:</span>
          <span className="font-mono text-foreground font-semibold px-2 py-0.5 rounded bg-background/80 border border-border">
            {lastAcceptedCommit.slice(0, 7)}
          </span>
        </div>
      </div>
    </div>
  );
}
