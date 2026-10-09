/** F10 slice: minimal workflow definition parsing. Unknown triggers, dangling needs, duplicate jobs and cycles are refused; jobs come back in dependency order. */

export const WORKFLOW_TRIGGERS = ["push", "pull_request", "schedule", "workflow_dispatch"] as const;
export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export interface WorkflowJob {
  readonly name: string;
  readonly needs: readonly string[];
}

export interface Workflow {
  readonly name: string;
  readonly triggers: readonly WorkflowTrigger[];
  /** Jobs in topological order: every job appears after all jobs it needs. */
  readonly jobs: readonly WorkflowJob[];
}

export type WorkflowParseResult = {readonly ok: true; readonly workflow: Workflow} | {readonly ok: false; readonly error: string};

const fail = (error: string): WorkflowParseResult => ({ok: false, error});
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function parseWorkflow(input: unknown): WorkflowParseResult {
  if (!isRecord(input)) return fail("A workflow must be an object");
  if (!isName(input.name)) return fail("A workflow needs a name");
  if (!Array.isArray(input.triggers) || input.triggers.length === 0) return fail("A workflow needs at least one trigger");
  const triggers: WorkflowTrigger[] = [];
  for (const trigger of input.triggers) {
    if (!WORKFLOW_TRIGGERS.includes(trigger as WorkflowTrigger)) return fail(`Unknown trigger ${String(trigger)}`);
    if (!triggers.includes(trigger as WorkflowTrigger)) triggers.push(trigger as WorkflowTrigger);
  }
  if (!Array.isArray(input.jobs) || input.jobs.length === 0) return fail("A workflow needs at least one job");

  const jobs = new Map<string, WorkflowJob>();
  for (const raw of input.jobs) {
    if (!isRecord(raw) || !isName(raw.name)) return fail("Every job needs a name");
    if (jobs.has(raw.name)) return fail(`Duplicate job ${raw.name}`);
    const needs = raw.needs ?? [];
    if (!Array.isArray(needs) || needs.some((need) => typeof need !== "string")) return fail(`Job ${raw.name} needs must be a list of job names`);
    jobs.set(raw.name, {name: raw.name, needs: [...new Set(needs as string[])]});
  }
  for (const job of jobs.values()) {
    for (const need of job.needs) {
      if (!jobs.has(need)) return fail(`Job ${job.name} needs missing job ${need}`);
      if (need === job.name) return fail(`Dependency cycle at ${job.name}`);
    }
  }

  const ordered: WorkflowJob[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (job: WorkflowJob): string | undefined => {
    const seen = state.get(job.name);
    if (seen === "done") return undefined;
    if (seen === "visiting") return job.name;
    state.set(job.name, "visiting");
    for (const need of job.needs) {
      const cycle = visit(jobs.get(need) as WorkflowJob);
      if (cycle !== undefined) return cycle;
    }
    state.set(job.name, "done");
    ordered.push(job);
    return undefined;
  };
  for (const job of jobs.values()) {
    const cycle = visit(job);
    if (cycle !== undefined) return fail(`Dependency cycle at ${cycle}`);
  }
  return {ok: true, workflow: {name: input.name, triggers, jobs: ordered}};
}
