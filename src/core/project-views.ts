/** F06 slice: iterations, saved views, status automation, bulk status edits and export, layered over project-planning without changing it. */
import {addItem, updateItem, type FieldValue, type Project, type ProjectItem} from "./project-planning";

export const MAX_BULK_ITEMS = 100;

export type Outcome<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly error: string};

export interface BulkError {
  /** Issue number the error applies to, or undefined for a request-level error. */
  readonly issueNumber?: number;
  readonly error: string;
}

export type BulkOutcome = {readonly ok: true; readonly value: ProjectPlan} | {readonly ok: false; readonly errors: readonly BulkError[]};

export interface Iteration {
  readonly id: string;
  readonly title: string;
  /** Calendar date in YYYY-MM-DD form. */
  readonly start: string;
  /** Calendar date in YYYY-MM-DD form, on or after start. */
  readonly end: string;
}

export interface IterationAssignment {
  readonly issueNumber: number;
  readonly iterationId: string;
}

export interface AutomationRule {
  readonly when: {readonly toStatus: string};
  readonly then: {readonly setField: string; readonly value: FieldValue};
}

/** The base project plus the planning data it does not carry: iterations, item assignments and automation rules. */
export interface ProjectPlan {
  readonly project: Project;
  readonly iterations: readonly Iteration[];
  readonly assignments: readonly IterationAssignment[];
  readonly rules: readonly AutomationRule[];
}

export const VIEW_LAYOUTS = ["board", "table", "timeline"] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];
const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export interface ProjectView {
  readonly name: string;
  readonly layout: ViewLayout;
  readonly filter: {readonly status?: readonly string[]; readonly iteration?: string};
  /** A field declared in fieldTypes, or "issueNumber". */
  readonly sortBy: string;
  readonly direction: SortDirection;
}

export interface ExportedItem {
  readonly issueNumber: number;
  readonly status: string;
  readonly version: number;
  readonly fields: Readonly<Record<string, FieldValue>>;
}

export interface ProjectExport {
  readonly statuses: readonly string[];
  readonly fieldTypes: Readonly<Record<string, "text" | "number">>;
  readonly items: readonly ExportedItem[];
  readonly iterations: readonly Iteration[];
  readonly assignments: readonly IterationAssignment[];
  readonly rules: readonly AutomationRule[];
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function fail(error: string): {readonly ok: false; readonly error: string} {
  return {ok: false, error};
}

function bulkFail(error: string, issueNumber?: number): {readonly ok: false; readonly errors: readonly BulkError[]} {
  return {ok: false, errors: [{issueNumber, error}]};
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNumbers(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // setUTCFullYear avoids the Date.UTC mapping of years 0-99 onto 1900-1999.
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Starts a plan around an existing project with no iterations or rules. */
export function startPlan(project: Project): ProjectPlan {
  return {project, iterations: [], assignments: [], rules: []};
}

/** Adds an issue reference through the base engine. Adding does not fire automation, because the first status is not a change. */
export function addPlanItem(plan: ProjectPlan, issueNumber: number, readableIssues: readonly number[]): Outcome<ProjectPlan> {
  const result = addItem(plan.project, issueNumber, readableIssues);
  if (!result.ok) return fail(result.error);
  return {ok: true, value: {...plan, project: result.project}};
}

/** Adds an iteration with a unique id, a title, and real calendar dates where end is on or after start. */
export function createIteration(plan: ProjectPlan, iteration: Iteration): Outcome<ProjectPlan> {
  const {id, start, end} = iteration;
  if (typeof id !== "string" || id.length === 0 || id !== id.trim()) return fail("An iteration needs an id with no surrounding spaces");
  const title = typeof iteration.title === "string" ? iteration.title.trim() : "";
  if (title.length === 0) return fail("An iteration needs a title");
  if (!isCalendarDate(start) || !isCalendarDate(end)) return fail("Iteration dates must be real YYYY-MM-DD dates");
  if (end < start) return fail("An iteration cannot end before it starts");
  if (plan.iterations.some((existing) => existing.id === id)) return fail("An iteration with this id already exists");
  return {ok: true, value: {...plan, iterations: [...plan.iterations, {id, title, start, end}]}};
}

/** Puts an item in one iteration. Membership lives on the plan, so the item version does not change. Assigning again moves the item. */
export function assignIteration(plan: ProjectPlan, issueNumber: number, iterationId: string): Outcome<ProjectPlan> {
  if (!plan.project.items.some((item) => item.issueNumber === issueNumber)) return fail("That item is not in the project");
  if (!plan.iterations.some((iteration) => iteration.id === iterationId)) return fail("Unknown iteration");
  const others = plan.assignments.filter((assignment) => assignment.issueNumber !== issueNumber);
  return {ok: true, value: {...plan, assignments: [...others, {issueNumber, iterationId}]}};
}

/** Returns why a rule cannot run against this project, or undefined when it is valid. */
function ruleProblem(project: Project, rule: AutomationRule): string | undefined {
  if (!project.statuses.includes(rule.when.toStatus)) return "it targets an unknown status";
  const field = rule.then.setField;
  const type = Object.hasOwn(project.fieldTypes, field) ? project.fieldTypes[field] : undefined;
  if (type === undefined) return `it sets undeclared field ${field}`;
  const value = rule.then.value;
  const matches = type === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === "string";
  if (!matches) return `its value for ${field} must match type ${type}`;
  return undefined;
}

/** Replaces the automation rules. Each rule must target a known status and set a declared field to a value of that field's type. */
export function setAutomation(plan: ProjectPlan, rules: readonly AutomationRule[]): Outcome<ProjectPlan> {
  for (const [index, rule] of rules.entries()) {
    const problem = ruleProblem(plan.project, rule);
    if (problem !== undefined) return fail(`Rule ${index + 1} is refused because ${problem}`);
  }
  return {ok: true, value: {...plan, rules: [...rules]}};
}

/** Field values that valid rules add when an item moves into toStatus. A later rule wins over an earlier one for the same field. */
function firedFields(plan: ProjectPlan, toStatus: string): Record<string, FieldValue> {
  const fields: Record<string, FieldValue> = {};
  for (const rule of plan.rules) {
    if (rule.when.toStatus !== toStatus || ruleProblem(plan.project, rule) !== undefined) continue;
    fields[rule.then.setField] = rule.then.value;
  }
  return fields;
}

/**
 * Updates an item through the base engine. Automation runs only when the status really changes, and its values are written
 * in the same update so the item version moves once. Values set explicitly in this edit win over rule values.
 */
export function updatePlanItem(
  plan: ProjectPlan,
  issueNumber: number,
  expectedVersion: number,
  change: {readonly status?: string; readonly fields?: Readonly<Record<string, FieldValue>>},
): Outcome<ProjectPlan> {
  const status = change.status;
  const current = plan.project.items.find((item) => item.issueNumber === issueNumber);
  const fired = status !== undefined && current !== undefined && status !== current.status ? firedFields(plan, status) : {};
  const result = updateItem(plan.project, issueNumber, expectedVersion, {status, fields: {...fired, ...change.fields}});
  if (!result.ok) return fail(result.error);
  return {ok: true, value: {...plan, project: result.project}};
}

/**
 * Moves up to MAX_BULK_ITEMS distinct items to one status, all or nothing. expectedVersions lines up with issueNumbers.
 * Every item is checked, and if any check fails the plan is not changed and every failure is reported.
 */
export function setStatusBulk(
  plan: ProjectPlan,
  issueNumbers: readonly number[],
  status: string,
  expectedVersions: readonly number[],
): BulkOutcome {
  if (issueNumbers.length === 0) return bulkFail("Select at least one item");
  if (issueNumbers.length > MAX_BULK_ITEMS) return bulkFail(`Bulk status changes are limited to ${MAX_BULK_ITEMS} items`);
  if (expectedVersions.length !== issueNumbers.length) return bulkFail("Each item needs exactly one expected version");
  if (!plan.project.statuses.includes(status)) return bulkFail("Unknown status");
  const seen = new Set<number>();
  for (const issueNumber of issueNumbers) {
    if (seen.has(issueNumber)) return bulkFail("Item is selected more than once", issueNumber);
    seen.add(issueNumber);
  }
  let next = plan;
  const errors: BulkError[] = [];
  for (const [index, issueNumber] of issueNumbers.entries()) {
    const expectedVersion = expectedVersions[index];
    const result =
      expectedVersion === undefined ? fail("Each item needs an expected version") : updatePlanItem(next, issueNumber, expectedVersion, {status});
    if (result.ok) next = result.value;
    else errors.push({issueNumber, error: result.error});
  }
  if (errors.length > 0) return {ok: false, errors};
  return {ok: true, value: next};
}

function sortValue(item: ProjectItem, sortBy: string): FieldValue | undefined {
  if (sortBy === "issueNumber") return item.issueNumber;
  const value = Object.hasOwn(item.fields, sortBy) ? item.fields[sortBy] : undefined;
  return typeof value === "number" && Number.isNaN(value) ? undefined : value;
}

/** Items without a value sort last in both directions. Ties fall back to ascending issue number. */
function compareItems(a: ProjectItem, b: ProjectItem, sortBy: string, direction: SortDirection): number {
  const left = sortValue(a, sortBy);
  const right = sortValue(b, sortBy);
  if (left === undefined || right === undefined) {
    if (left === right) return a.issueNumber - b.issueNumber;
    return left === undefined ? 1 : -1;
  }
  const order =
    typeof left === "number" && typeof right === "number" ? compareNumbers(left, right) : compareText(String(left), String(right));
  if (order !== 0) return direction === "asc" ? order : -order;
  return a.issueNumber - b.issueNumber;
}

/** Filters and sorts items for a view. Unknown layouts, directions, sort fields, statuses or iterations are refused. */
export function applyView(plan: ProjectPlan, view: ProjectView): Outcome<readonly ProjectItem[]> {
  const {project} = plan;
  if (view.name.trim().length === 0) return fail("A view needs a name");
  if (!VIEW_LAYOUTS.includes(view.layout)) return fail("Unknown view layout");
  if (!SORT_DIRECTIONS.includes(view.direction)) return fail("Sort direction must be asc or desc");
  if (view.sortBy !== "issueNumber" && !Object.hasOwn(project.fieldTypes, view.sortBy)) return fail(`Unknown sort field ${view.sortBy}`);
  const statuses = view.filter.status;
  if (statuses !== undefined) {
    if (statuses.length === 0) return fail("A status filter needs at least one status");
    const unknown = statuses.find((status) => !project.statuses.includes(status));
    if (unknown !== undefined) return fail(`Unknown status ${unknown} in filter`);
  }
  const iterationId = view.filter.iteration;
  if (iterationId !== undefined && !plan.iterations.some((iteration) => iteration.id === iterationId)) {
    return fail("Unknown iteration in filter");
  }
  const inIteration =
    iterationId === undefined
      ? undefined
      : new Set(plan.assignments.filter((assignment) => assignment.iterationId === iterationId).map((assignment) => assignment.issueNumber));
  const items = project.items.filter(
    (item) => (statuses === undefined || statuses.includes(item.status)) && (inIteration === undefined || inIteration.has(item.issueNumber)),
  );
  return {ok: true, value: items.sort((a, b) => compareItems(a, b, view.sortBy, view.direction))};
}

function sortedByKey<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => compareText(a, b)));
}

/**
 * Builds the export manifest object. Items are ordered by issue number, field and fieldTypes keys are sorted, iterations are
 * ordered by start date, end date and id, and statuses and rules keep their declared order because that order carries meaning.
 */
export function exportProject(plan: ProjectPlan): ProjectExport {
  const items = [...plan.project.items]
    .sort((a, b) => a.issueNumber - b.issueNumber)
    .map((item) => ({issueNumber: item.issueNumber, status: item.status, version: item.version, fields: sortedByKey(item.fields)}));
  const iterations = [...plan.iterations]
    .sort((a, b) => compareText(a.start, b.start) || compareText(a.end, b.end) || compareText(a.id, b.id))
    .map((iteration) => ({id: iteration.id, title: iteration.title, start: iteration.start, end: iteration.end}));
  const assignments = [...plan.assignments]
    .sort((a, b) => a.issueNumber - b.issueNumber)
    .map((assignment) => ({issueNumber: assignment.issueNumber, iterationId: assignment.iterationId}));
  const rules = plan.rules.map((rule) => ({
    when: {toStatus: rule.when.toStatus},
    then: {setField: rule.then.setField, value: rule.then.value},
  }));
  return {
    statuses: [...plan.project.statuses],
    fieldTypes: sortedByKey(plan.project.fieldTypes),
    items,
    iterations,
    assignments,
    rules,
  };
}
