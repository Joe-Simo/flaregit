import React, { useState } from "react";
import { Check, FlaskConical, Scale, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProductDecision, Task } from "@/core/types";
import { plainValue, type ProofView, type RevisionView } from "../coordination";

const VERDICT: Record<ProofView["verdict"], { label: string; variant: "success" | "warning" | "destructive" }> = {
  proven: { label: "Proven by running both changes", variant: "success" },
  not_reproduced: { label: "Requirements disagree; code does not show it yet", variant: "warning" },
  execution_failed: { label: "Code could not be run; requirements still disagree", variant: "destructive" },
};

const REVISION: Record<RevisionView["status"], string> = {
  planned: "Agent revision is about to start",
  dispatched: "Agent is revising this change to match the chosen requirement",
  revised: "Revised to match the chosen requirement",
  needs_author: "The author needs to update this change",
  failed: "Agent revision did not start",
};

function Outcome({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 ${ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>
      {ok ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * A requirement conflict between two changes: both requirements side by side, what the platform ran to
 * show they conflict, and (for the repository owner) the choice of which requirement wins.
 */
export function RequirementDecision({ decision, proof, revisions, tasks, isOwner, resolving, onResolve }: {
  decision: ProductDecision;
  proof: ProofView | null;
  revisions: RevisionView[];
  tasks: Record<string, Task>;
  isOwner: boolean;
  resolving: boolean;
  onResolve: (decisionId: string, optionId: string) => void;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const pending = decision.status === "pending";
  const titleId = `requirement-decision-${decision.id}`;
  const sideFor = (optionId: string) => proof?.sides.find((side) => side.requirementId === optionId);
  const taskFor = (optionId: string) => {
    const fromScope = decision.scope?.participants.find((participant) => participant.conflictingRequirements.some((requirement) => requirement.id === optionId))?.taskId;
    return (fromScope ? tasks[fromScope] : undefined) ?? Object.values(tasks).find((task) => task.requirements.some((requirement) => requirement.id === optionId));
  };
  const options = decision.options.slice(0, 2);
  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-border p-4 space-y-4 min-w-0">
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Scale className="h-4 w-4 text-purple-600 dark:text-purple-400" aria-hidden="true" />
          <Badge variant={pending ? "purple" : "success"}>{pending ? "Choose a requirement" : "Decided"}</Badge>
          {proof ? <Badge variant={VERDICT[proof.verdict].variant}>{VERDICT[proof.verdict].label}</Badge> : pending && <Badge variant="outline">Running both changes…</Badge>}
        </div>
        <h3 id={titleId} className="text-sm font-semibold break-words">{decision.question}</h3>
        <p className="text-xs text-muted-foreground">Two changes ask for different results from the same input. Only one can be right; the accepted version stays as it is until you choose.</p>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        {options.map((option) => {
          const side = sideFor(option.id), task = taskFor(option.id), chosen = decision.selectedOptionId === option.id, selected = choice === option.id;
          const revision = revisions.find((value) => value.taskId === task?.id);
          return (
            <div key={option.id} className={`rounded-md border p-3 space-y-2 min-w-0 ${chosen ? "border-emerald-500/50 bg-emerald-500/5" : selected ? "border-primary bg-primary/5" : "border-border"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold break-words">{option.label}</p>
                  <p className="text-xs text-muted-foreground break-words">{option.description}</p>
                </div>
                {chosen && <Badge variant="success">Chosen</Badge>}
                {!pending && !chosen && <Badge variant="outline">Not chosen</Badge>}
              </div>
              {task && <p className="text-xs text-muted-foreground break-words">From change “{task.goal}” by {task.contributor.name}</p>}
              <dl className="text-xs space-y-1">
                <div className="flex flex-wrap gap-1"><dt className="text-muted-foreground">Expects:</dt><dd className="font-medium">{side ? plainValue(side.expected) : option.concreteExample}</dd></div>
                {side && (side.error !== undefined
                  ? <div className="flex flex-wrap gap-1"><dt className="text-muted-foreground">When run:</dt><dd className="text-destructive break-words">{side.error}</dd></div>
                  : <>
                      <div className="flex flex-wrap gap-1"><dt className="text-muted-foreground">Its code returns:</dt><dd className="font-medium">{plainValue(side.actual)}</dd></div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <Outcome ok={side.meetsOwnRequirement}>{side.meetsOwnRequirement ? "Meets its own requirement" : "Misses its own requirement"}</Outcome>
                        <Outcome ok={side.meetsOtherRequirement}>{side.meetsOtherRequirement ? "Also meets the other one" : "Breaks the other requirement"}</Outcome>
                      </div>
                    </>)}
                {side && <div className="flex flex-wrap gap-1"><dt className="text-muted-foreground">Commit run:</dt><dd><code>{side.commit.slice(0, 8)}</code></dd></div>}
              </dl>
              {revision && <p role="status" className={`text-xs ${revision.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{REVISION[revision.status]}{revision.reason ? `: ${revision.reason}` : ""}</p>}
              {pending && isOwner && (
                <Button type="button" size="sm" variant={selected ? "default" : "outline"} aria-pressed={selected} disabled={resolving} onClick={() => setChoice(option.id)} className="w-full">
                  {selected ? "Selected" : "This one is right"}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {proof && (
        <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1">
          <p className="flex items-center gap-1.5 font-medium"><FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />What FlareGit ran</p>
          <p className="text-muted-foreground break-words">Input: {plainValue(proof.input)} → <code>{proof.probe.export}</code> in <code className="break-all">{proof.probe.module}</code></p>
          <p className="break-words">{proof.summary}</p>
        </div>
      )}

      {pending && (isOwner ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p className="text-xs text-muted-foreground mr-auto">The change whose requirement is not chosen is sent back to its agent to match the chosen one, then both land through the merge queue.</p>
          <Button type="button" size="sm" disabled={!choice || resolving} onClick={() => choice && onResolve(decision.id, choice)}>{resolving ? "Saving…" : "Apply choice"}</Button>
        </div>
      ) : <p className="text-xs text-muted-foreground">Only the repository owner can choose which requirement wins.</p>)}
    </section>
  );
}
