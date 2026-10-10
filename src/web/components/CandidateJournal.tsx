import {FrozenAttribution} from './FrozenAttribution';
import {frozenInputAttribution} from '../frozen-contribution-attribution';
import {preservedCandidateSuccessors} from "../candidate-lineage";
import React from "react";
import {CommitSignature} from './CommitSignature';
import { GitMerge, Cpu, ShieldCheck } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { CandidateGeneration, PublicationJournalEntry } from "@/core/types";
import { combinedHow, statusLabel } from "../lib/glossary";
import { TechnicalDetails } from "./TechnicalDetails";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

interface CandidateJournalProps {
  projectId?:string;
  candidates: Record<string, CandidateGeneration>;
  journal: PublicationJournalEntry[];
  onSelectCandidate?: (candidateId: string) => void;
  selectedCandidateId?: string;
}

export function CandidateJournal({
  projectId,
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
            <CardTitle className="text-sm font-semibold">Combine history</CardTitle>
          </div>
          <span className="text-xs text-muted-foreground">
            {plural(candidateList.length, "attempt")} · {plural(journal.filter(entry => entry.state === "ACCEPTED").length, "merge")}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">Every time changes were combined and checked, newest first, with how they were combined and what happened.</p>
      </CardHeader>

      <CardContent className="p-3 flex-1 overflow-y-auto">
        {candidateList.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-xs">
            <GitMerge className="h-8 w-8 mx-auto mb-2 opacity-30" aria-hidden />
            <p>Nothing has been combined yet.</p>
            <p className="mt-1">Combine a ready change to build a preview and run its checks.</p>
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
                    </span>
                    {cand.status === "accepted" ? (
                      <Badge variant="success">Merged</Badge>
                    ) : cand.status === "verified" ? (
                      <Badge variant="info">Checks passed</Badge>
                    ) : cand.status === "repairing" ? (
                      <Badge variant="warning">AI repairing conflicts</Badge>
                    ) : cand.status === "failed" ? (
                      <Badge variant="destructive">Failed</Badge>
                    ) : (
                      <Badge variant="secondary">{statusLabel(cand.status)}</Badge>
                    )}
                  </span>

                  {preserved.has(cand.id)&&<span className="block mb-2 text-xs text-muted-foreground">Rerun as a newer attempt. This one keeps its original result and checks.</span>}
                  {cand.predecessorCandidateId&&<span className="block mb-2 text-xs text-muted-foreground">Rerun of an earlier attempt with the same saved changes.</span>}
                  {cand.compositionMethod&&<span className="block text-xs mb-2 text-foreground">{combinedHow[cand.compositionMethod]}</span>}

                  <span className="block space-y-1 mb-2 text-xs">{cand.participatingTaskIds.map(taskId=><span key={taskId} className="block"><FrozenAttribution snapshot={frozenInputAttribution(historical,taskId,cand.participatingCommits[taskId])}/></span>)}</span>
                  {hasRepairs && (
                    <span className="block mb-2 p-2 rounded bg-amber-950/20 border border-amber-500/20 text-[11px] text-amber-200">
                      <span className="flex items-center gap-1 font-semibold mb-1">
                        <Cpu className="h-3 w-3 text-orange-400" aria-hidden />
                        <span>AI repaired conflicts {plural(cand.repairAttempts.length, "time")}</span>
                      </span>
                    </span>
                  )}

                  {cand.candidateCommit && (
                    <span className="pt-2 border-t border-border/40 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground font-mono">
                      <span className="flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
                        <span>Commit {cand.candidateCommit.slice(0, 7)}</span>
                      </span>
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
                  <TechnicalDetails className="mt-1 px-1">
                    <p>Attempt id {cand.id}</p>
                    {cand.compositionMethod&&<p>Method {cand.compositionMethod}</p>}
                    {cand.predecessorCandidateId&&<p>Earlier attempt {cand.predecessorCandidateId}</p>}
                    {preserved.has(cand.id)&&<p>Newer attempt {preserved.get(cand.id)!.id}</p>}
                    {cand.candidateCommit&&<p>Commit {cand.candidateCommit}</p>}
                    {cand.evidenceId&&<p>Check record {cand.evidenceId}</p>}
                    {cand.repairAttempts.map(rep=><p key={rep.round}>Repair round {rep.round}: {rep.patch.slice(0, 120)}</p>)}
                  </TechnicalDetails>
                  {projectId&&cand.candidateCommit&&<CommitSignature projectId={projectId} commit={cand.candidateCommit} candidate={cand.id}/>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
