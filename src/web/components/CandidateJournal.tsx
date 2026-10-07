import {FrozenAttribution} from './FrozenAttribution';
import {frozenInputAttribution} from '../frozen-contribution-attribution';
import {preservedCandidateSuccessors} from "../candidate-lineage";
import React from "react";
import { GitMerge, Cpu, ShieldCheck } from "lucide-react";
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
  const preserved=preservedCandidateSuccessors(candidates);
  const candidateList = Object.values(candidates).reverse(); // newest first

  return (
    <Card className="h-full flex flex-col border-border/80 bg-card/70 backdrop-blur-sm min-w-0">
      <CardHeader className="pb-3 border-b border-border/60">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-primary" aria-hidden />
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Candidate Generations & CAS Journal
            </CardTitle>
          </div>
          <span className="text-xs text-muted-foreground">
            {candidateList.length} Compositions • {journal.length} CAS Logs
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-3 flex-1 overflow-y-auto">
        {candidateList.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-xs">
            <GitMerge className="h-8 w-8 mx-auto mb-2 opacity-30" aria-hidden />
            <p>No candidate compositions yet.</p>
            <p className="mt-1">No candidate has been prepared yet.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {candidateList.map((cand) => {
              const isSelected = selectedCandidateId === cand.id;
              const historical=cand.status==='accepted'?journal.find(entry=>entry.candidateId===cand.id&&entry.state==='ACCEPTED')?.contributionAttribution:cand.frozenAttribution;
              const hasRepairs = cand.repairAttempts && cand.repairAttempts.length > 0;
              const cls = `block w-full text-left p-3.5 rounded-lg border transition-all ${
                isSelected
                  ? "border-primary bg-primary/5 shadow-md shadow-primary/5"
                  : "border-border/60 bg-muted/30 hover:border-border hover:bg-muted/50"
              }`;
              const body = (
                <>
                  <span className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-foreground">{preserved.has(cand.id)?'Preserved attempt':cand.predecessorCandidateId?'Successor attempt':'Attempt'} #{cand.attemptNumber}</span>
                      <span className="text-[10px] font-mono text-muted-foreground break-all">{cand.id.slice(0, 14)}…</span>
                    </span>
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
                  </span>

                  {preserved.has(cand.id)&&<span className="block mb-2 text-xs text-muted-foreground">Successor {preserved.get(cand.id)!.id}. Original status and evidence retained.</span>}
                  {cand.predecessorCandidateId&&<span className="block mb-2 text-xs text-muted-foreground break-all">Original attempt {cand.predecessorCandidateId}</span>}
                  <span className="flex flex-wrap items-center gap-x-2 text-xs mb-2">
                    <span className="text-muted-foreground">Method:</span>
                    <span className="font-semibold text-foreground">
                      {cand.compositionMethod === "repaired_merge"
                        ? "Repaired 3-Way Merge (Workers AI)"
                        : cand.compositionMethod === "clean_git_merge"
                        ? "Clean Native Git Merge"
                        : "Direct Rebase"}
                    </span>
                  </span>

                  <div className="space-y-1 mb-2 text-xs">{cand.participatingTaskIds.map(taskId=><div key={taskId}><FrozenAttribution snapshot={frozenInputAttribution(historical,taskId,cand.participatingCommits[taskId])}/></div>)}</div>
                  {hasRepairs && (
                    <span className="block mb-2 p-2 rounded bg-amber-950/20 border border-amber-500/20 text-[11px] text-amber-200">
                      <span className="flex items-center gap-1 font-semibold mb-1">
                        <Cpu className="h-3 w-3 text-orange-400" aria-hidden />
                        <span>{cand.repairAttempts.length} Autonomous Repair Rounds:</span>
                      </span>
                      {cand.repairAttempts.map((rep, idx) => (
                        <span key={idx} className="block text-xs text-amber-300/80 break-all">
                          • Round {rep.round}: {rep.patch.slice(0, 60)}…
                        </span>
                      ))}
                    </span>
                  )}

                  {cand.candidateCommit && (
                    <span className="pt-2 border-t border-border/40 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground font-mono">
                      <span className="flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
                        <span>Commit: {cand.candidateCommit.slice(0, 7)}</span>
                      </span>
                      {cand.evidenceId && <span className="text-[10px] text-muted-foreground break-all">{cand.evidenceId}</span>}
                    </span>
                  )}
                </>
              );
              return (
                <li key={cand.id}>
                  {onSelectCandidate ? (
                    <button type="button" aria-pressed={isSelected} onClick={() => onSelectCandidate(cand.id)} className={`${cls} cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}>
                      {body}
                    </button>
                  ) : (
                    <div className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
