/** F05 slice: bulk issue actions built on the triage functions. All-or-nothing, with a per-issue error for every failure. */
import {addLabel, assign, closeThroughAcceptedChange, type Issue, type TriageResult} from "./issue-triage";

export const MAX_BULK_ISSUES = 100;

export type BulkAction =
  | {readonly kind: "label"; readonly label: string}
  | {readonly kind: "assign"; readonly assignee: string; readonly members: readonly string[]}
  | {readonly kind: "close"; readonly change: string};

export interface BulkError {
  /** Issue number the error applies to, or undefined for a request-level error. */
  readonly number?: number;
  readonly error: string;
}

export type BulkResult = {readonly ok: true; readonly issues: readonly Issue[]} | {readonly ok: false; readonly errors: readonly BulkError[]};

function applyOne(issue: Issue, action: BulkAction): TriageResult {
  switch (action.kind) {
    case "label":
      return addLabel(issue, action.label);
    case "assign":
      return assign(issue, action.assignee, action.members);
    case "close":
      return closeThroughAcceptedChange(issue, action.change);
  }
}

/** Applies one action to up to 100 distinct issues. If any issue fails, none are changed and every failure is reported. */
export function applyBulk(issues: readonly Issue[], action: BulkAction): BulkResult {
  if (issues.length === 0) return {ok: false, errors: [{error: "Select at least one issue"}]};
  if (issues.length > MAX_BULK_ISSUES) return {ok: false, errors: [{error: `Bulk actions are limited to ${MAX_BULK_ISSUES} issues`}]};
  const seen = new Set<number>();
  for (const issue of issues) {
    if (seen.has(issue.number)) return {ok: false, errors: [{number: issue.number, error: "Issue is selected more than once"}]};
    seen.add(issue.number);
  }
  const updated: Issue[] = [];
  const errors: BulkError[] = [];
  for (const issue of issues) {
    const result = applyOne(issue, action);
    if (result.ok) updated.push(result.issue);
    else errors.push({number: issue.number, error: result.error});
  }
  return errors.length > 0 ? {ok: false, errors} : {ok: true, issues: updated};
}
