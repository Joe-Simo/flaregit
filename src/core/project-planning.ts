/** F06 slice: project items reference issues by number; custom fields and status live on the item, never a copy of the issue. */

export type FieldValue = string | number;

export interface ProjectItem {
  readonly issueNumber: number;
  readonly status: string;
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly version: number;
}

export interface Project {
  readonly statuses: readonly string[];
  readonly fieldTypes: Readonly<Record<string, "text" | "number">>;
  readonly items: readonly ProjectItem[];
}

export type PlanResult = {readonly ok: true; readonly project: Project} | {readonly ok: false; readonly error: string};

/** Adds an issue reference once. */
export function addItem(project: Project, issueNumber: number, readableIssues: readonly number[]): PlanResult {
  if (!readableIssues.includes(issueNumber)) return {ok: false, error: "That issue is not accessible"};
  if (project.items.some((item) => item.issueNumber === issueNumber)) return {ok: false, error: "That issue is already in the project"};
  const status = project.statuses[0];
  if (status === undefined) return {ok: false, error: "The project has no statuses"};
  return {ok: true, project: {...project, items: [...project.items, {issueNumber, status, fields: {}, version: 1}]}};
}

/** Updates status and fields. A stale `expectedVersion` is rejected so conflicting edits are detected. */
export function updateItem(
  project: Project,
  issueNumber: number,
  expectedVersion: number,
  change: {readonly status?: string; readonly fields?: Readonly<Record<string, FieldValue>>},
): PlanResult {
  const item = project.items.find((candidate) => candidate.issueNumber === issueNumber);
  if (!item) return {ok: false, error: "That item is not in the project"};
  if (item.version !== expectedVersion) return {ok: false, error: "The item changed since it was read"};
  if (change.status !== undefined && !project.statuses.includes(change.status)) return {ok: false, error: "Unknown status"};
  for (const [name, value] of Object.entries(change.fields ?? {})) {
    const type = project.fieldTypes[name];
    if (type === undefined) return {ok: false, error: `Unknown field ${name}`};
    const expected = type === "text" ? "string" : "number";
    if (typeof value !== expected) return {ok: false, error: `Field ${name} must be ${type}`};
  }
  const next: ProjectItem = {...item, status: change.status ?? item.status, fields: {...item.fields, ...change.fields}, version: item.version + 1};
  return {ok: true, project: {...project, items: project.items.map((candidate) => (candidate === item ? next : candidate))}};
}

/** Progress counts come from stored items only. */
export function progress(project: Project): Readonly<Record<string, number>> {
  const counts: Record<string, number> = Object.fromEntries(project.statuses.map((status) => [status, 0]));
  for (const item of project.items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}
