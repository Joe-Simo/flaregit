import { Check, X } from "lucide-react";
import type { CandidateGeneration } from "@/core/types";

/** True when the saved requirement checks block accepting this exact commit (the server refuses it too). */
export function requirementChecksBlock(candidate: CandidateGeneration): boolean {
  const run = candidate.requirementChecks;
  return Boolean(run && (run.commit !== candidate.candidateCommit || run.checks.some((check) => !check.passed)));
}

/** Requirement examples run on the candidate commit, shown next to the protected and connected checks. */
export function RequirementCheckRows({ candidate }: { candidate: CandidateGeneration }) {
  const run = candidate.requirementChecks;
  if (!run || !run.checks.length) return null;
  const stale = run.commit !== candidate.candidateCommit;
  const passed = run.checks.filter((check) => check.passed).length;
  return <section aria-label="Requirement checks" className="space-y-2">
    <h4 className="text-sm font-medium">Requirement checks <span className="font-normal text-muted-foreground">· {passed} of {run.checks.length} passed</span></h4>
    {stale && <p role="alert" className="text-xs text-destructive">These checks ran on another commit. Acceptance is paused until they run on this one.</p>}
    <ul className="space-y-1 text-sm">
      {run.checks.map((check) => <li key={`${check.requirementId}:${check.assertionId}`} className="flex items-start gap-2">
        {check.passed ? <Check className="mt-0.5 size-4 shrink-0 text-green-600" aria-label="Passed" /> : <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />}
        <span className="break-words">
          <span className="font-medium">{check.requirementTitle}</span>{check.decided && <span className="text-xs text-muted-foreground"> · decided</span>}
          {!check.passed && check.reason && <span className="block text-xs text-destructive">{check.reason}</span>}
        </span>
      </li>)}
    </ul>
  </section>;
}
