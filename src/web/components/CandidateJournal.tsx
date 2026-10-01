import React from "react";
import { GitMerge, Cpu, CheckCircle2, ShieldCheck, Clock, FileCheck, ArrowRight, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CandidateGeneration, PublicationJournalEntry } from "@/core/types";

interface CandidateJournalProps {
  candidates: Record<string, CandidateGeneration>;
  journal: PublicationJournalEntry[];
  onSelectCandidate?: (candidateId: string) => void;
  selectedCandidateId?: string;
}

export function CandidateJournal({
  candidates,
  journal,
  onSelectCandidate,
  selectedCandidateId,
}: CandidateJournalProps) {
  const candidateList = Object.values(candidates).reverse(); // newest first

  return (
    <Card className="h-full flex flex-col border-border/80 bg-card/70 backdrop-blur-sm">
      <CardHeader className="pb-3 border-b border-border/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Candidate Generations & CAS Journal
            </CardTitle>
          </div>
          <span className="text-xs text-muted-foreground">
            {candidateList.length} Compositions
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-3 flex-1 overflow-y-auto space-y-3">
        {candidateList.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-xs">
            <GitMerge className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No candidate compositions yet.</p>
            <p className="mt-1">Candidates are generated automatically when contributors checkpoint work.</p>
          </div>
        ) : (
          candidateList.map((cand) => {
            const isSelected = selectedCandidateId === cand.id;
            const hasRepairs = cand.repairAttempts && cand.repairAttempts.length > 0;

            return (
              <div
                key={cand.id}
                onClick={() => onSelectCandidate?.(cand.id)}
                className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? "border-primary bg-primary/5 shadow-md shadow-primary/5"
                    : "border-border/60 bg-muted/30 hover:border-border hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground">
                      Gen #{cand.attemptNumber}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {cand.id.slice(0, 14)}...
                    </span>
                  </div>

                  {cand.status === "accepted" ? (
                    <Badge variant="success">✓ CAS Accepted</Badge>
                  ) : cand.status === "verified" ? (
                    <Badge variant="info">Verified</Badge>
                  ) : cand.status === "repairing" ? (
                    <Badge variant="warning">Repairing (AI)</Badge>
                  ) : cand.status === "failed" ? (
                    <Badge variant="destructive">Failed</Badge>
                  ) : (
                    <Badge variant="secondary">{cand.status}</Badge>
                  )}
                </div>

                {/* Composition Method */}
                <div className="flex items-center gap-2 text-xs mb-2">
                  <span className="text-muted-foreground">Method:</span>
                  <span className="font-semibold text-foreground">
                    {cand.compositionMethod === "repaired_merge"
                      ? "Repaired 3-Way Merge (Workers AI)"
                      : cand.compositionMethod === "clean_git_merge"
                      ? "Clean Native Git Merge"
                      : "Direct Rebase"}
                  </span>
                </div>

                {/* Repairs Applied */}
                {hasRepairs && (
                  <div className="mb-2 p-2 rounded bg-amber-950/20 border border-amber-500/20 text-[11px] text-amber-200">
                    <div className="flex items-center gap-1 font-semibold mb-1">
                      <Cpu className="h-3 w-3 text-orange-400" />
                      <span>{cand.repairAttempts.length} Autonomous Repair Rounds:</span>
                    </div>
                    {cand.repairAttempts.map((rep, idx) => (
                      <div key={idx} className="text-xs text-amber-300/80">
                        • Round {rep.round}: {rep.patch.slice(0, 60)}...
                      </div>
                    ))}
                  </div>
                )}

                {/* Verification Evidence Footprint */}
                {cand.candidateCommit && (
                  <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                    <div className="flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Commit: {cand.candidateCommit.slice(0, 7)}</span>
                    </div>
                    {cand.evidenceId && (
                      <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                        {cand.evidenceId}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
