/** F05 slice: issue triage rules. Labels, assignees, closing through accepted work, and tombstones for deleted or transferred issues. */

export type IssueState = "open" | "closed";

export interface Issue {
  readonly number: number;
  readonly state: IssueState;
  readonly labels: readonly string[];
  readonly assignees: readonly string[];
  /** The accepted change that closed this issue, if any. */
  readonly closedByChange?: string;
  readonly tombstone?: {readonly kind: "deleted"} | {readonly kind: "transferred"; readonly to: string};
}

export type TriageResult = {readonly ok: true; readonly issue: Issue} | {readonly ok: false; readonly error: string};

const MAX_LABEL_CHARACTERS = 50;

function writable(issue: Issue): string | undefined {
  return issue.tombstone ? "A deleted or transferred issue cannot be changed" : undefined;
}

/** Adds a label once. Labels are trimmed, non-empty and limited to 50 characters. */
export function addLabel(issue: Issue, label: unknown): TriageResult {
  const blocked = writable(issue);
  if (blocked) return {ok: false, error: blocked};
  if (typeof label !== "string" || label.trim().length === 0) return {ok: false, error: "A label needs a name"};
  const name = label.trim();
  if (name.length > MAX_LABEL_CHARACTERS) return {ok: false, error: `Labels are limited to ${MAX_LABEL_CHARACTERS} characters`};
  if (issue.labels.includes(name)) return {ok: true, issue};
  return {ok: true, issue: {...issue, labels: [...issue.labels, name]}};
}

/** Assigns only a repository member; the caller supplies the member list so privacy boundaries stay with the permission layer. */
export function assign(issue: Issue, assignee: string, members: readonly string[]): TriageResult {
  const blocked = writable(issue);
  if (blocked) return {ok: false, error: blocked};
  if (!members.includes(assignee)) return {ok: false, error: "Only repository members can be assigned"};
  if (issue.assignees.includes(assignee)) return {ok: true, issue};
  return {ok: true, issue: {...issue, assignees: [...issue.assignees, assignee]}};
}

/** Closes an issue through an accepted change exactly once. A second closure by any change is a no-op that keeps the original record. */
export function closeThroughAcceptedChange(issue: Issue, change: string): TriageResult {
  const blocked = writable(issue);
  if (blocked) return {ok: false, error: blocked};
  if (issue.state === "closed") return {ok: true, issue};
  return {ok: true, issue: {...issue, state: "closed", closedByChange: change}};
}

/** Reopening clears the closing change and never invents history. */
export function reopen(issue: Issue): TriageResult {
  const blocked = writable(issue);
  if (blocked) return {ok: false, error: blocked};
  if (issue.state === "open") return {ok: true, issue};
  const {closedByChange: _closedByChange, ...rest} = issue;
  return {ok: true, issue: {...rest, state: "open"}};
}

/** Transfers leave a tombstone that redirects to the new location. */
export function transfer(issue: Issue, to: string): TriageResult {
  const blocked = writable(issue);
  if (blocked) return {ok: false, error: blocked};
  if (!to.trim()) return {ok: false, error: "A transfer needs a destination"};
  return {ok: true, issue: {...issue, tombstone: {kind: "transferred", to}}};
}
