/** F05 slice: milestones with due dates, open and closed counts, and guarded deletion. */

export interface Milestone {
  readonly id: number;
  readonly title: string;
  /** Calendar date in YYYY-MM-DD form. */
  readonly dueDate?: string;
}

export interface MilestoneIssue {
  readonly number: number;
  readonly state: "open" | "closed";
  readonly milestone?: number;
}

export interface MilestoneProgress {
  readonly open: number;
  readonly closed: number;
}

export type MilestoneResult<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly error: string};

const MAX_TITLE_CHARACTERS = 100;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Creates a milestone with a unique title and an optional valid due date. */
export function createMilestone(existing: readonly Milestone[], title: unknown, dueDate?: string): MilestoneResult<Milestone> {
  if (typeof title !== "string" || title.trim().length === 0) return {ok: false, error: "A milestone needs a title"};
  const name = title.trim();
  if (name.length > MAX_TITLE_CHARACTERS) return {ok: false, error: `Titles are limited to ${MAX_TITLE_CHARACTERS} characters`};
  if (existing.some((milestone) => milestone.title === name)) return {ok: false, error: "A milestone with this title already exists"};
  if (dueDate !== undefined && !validDate(dueDate)) return {ok: false, error: "The due date must be a real YYYY-MM-DD date"};
  const id = existing.reduce((highest, milestone) => Math.max(highest, milestone.id), 0) + 1;
  return {ok: true, value: dueDate === undefined ? {id, title: name} : {id, title: name, dueDate}};
}

/** Counts open and closed issues assigned to a milestone. */
export function milestoneProgress(milestoneId: number, issues: readonly MilestoneIssue[]): MilestoneProgress {
  let open = 0;
  let closed = 0;
  for (const issue of issues) {
    if (issue.milestone !== milestoneId) continue;
    if (issue.state === "open") open += 1;
    else closed += 1;
  }
  return {open, closed};
}

/** A milestone is overdue when it has open issues and its due date is before today (YYYY-MM-DD). */
export function isOverdue(milestone: Milestone, issues: readonly MilestoneIssue[], today: string): boolean {
  if (!milestone.dueDate) return false;
  return milestone.dueDate < today && milestoneProgress(milestone.id, issues).open > 0;
}

export interface DeletionOutcome {
  readonly milestones: readonly Milestone[];
  readonly issues: readonly MilestoneIssue[];
}

/**
 * Deletes a milestone. A milestone with open issues is refused unless the caller names another milestone to move
 * every assigned issue to. Without open issues, closed issues simply lose the milestone.
 */
export function deleteMilestone(
  milestones: readonly Milestone[],
  issues: readonly MilestoneIssue[],
  id: number,
  reassignTo?: number,
): MilestoneResult<DeletionOutcome> {
  if (!milestones.some((milestone) => milestone.id === id)) return {ok: false, error: "Milestone not found"};
  const hasOpen = milestoneProgress(id, issues).open > 0;
  if (hasOpen && reassignTo === undefined) return {ok: false, error: "Milestone has open issues; reassign them explicitly to delete it"};
  if (reassignTo !== undefined) {
    if (reassignTo === id) return {ok: false, error: "Cannot reassign issues to the milestone being deleted"};
    if (!milestones.some((milestone) => milestone.id === reassignTo)) return {ok: false, error: "Reassignment target not found"};
  }
  const moved = issues.map((issue): MilestoneIssue => {
    if (issue.milestone !== id) return issue;
    const {milestone: _milestone, ...rest} = issue;
    return reassignTo === undefined ? rest : {...rest, milestone: reassignTo};
  });
  return {ok: true, value: {milestones: milestones.filter((milestone) => milestone.id !== id), issues: moved}};
}
