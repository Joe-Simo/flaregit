/** F10 slice: local CI run engine. Jobs run in dependency waves through an injected runner; a failed dependency skips its dependents; cancel requests runner abort and stops new waves; a finished run never changes. */
import type {CheckRun} from "./ci-gate";
import {parseWorkflow, type WorkflowJob} from "./workflow-parser";

export type CiConclusion = "success" | "failure" | "cancelled";
export type CiJobConclusion = CiConclusion | "skipped";

/** Runners must propagate abort to their process/container and release resources. Engine settlement alone does not terminate external work. */
export type CiJobRunner = (job: WorkflowJob, commit: string, signal: AbortSignal) => Promise<{readonly conclusion: CiConclusion}>;

export interface CiJobRecord {
  readonly name: string;
  readonly needs: readonly string[];
  /** Null while the job is pending or running. */
  readonly conclusion: CiJobConclusion | null;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  /** Runner exception message, capped at 500 characters. */
  readonly error: string | null;
  /** Whether runner completion was observed before engine settlement. Unconfirmed aborts require runtime cleanup. */
  readonly termination: "pending" | "settled" | "unconfirmed";
}

export interface CiRunRecord {
  readonly runId: string;
  readonly workflow: string;
  readonly commit: string;
  readonly status: "in_progress" | "completed";
  readonly conclusion: CiConclusion | null;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  /** Jobs in dependency order. */
  readonly jobs: readonly CiJobRecord[];
}

export type CiStartResult = {readonly ok: true; readonly run: CiRunRecord; readonly done: Promise<CiRunRecord>} | {readonly ok: false; readonly error: string};
export type CiCancelResult = {readonly ok: true} | {readonly ok: false; readonly error: string};

export interface CiEngine {
  /** Starts a run for a workflow definition at an exact commit. Execution continues in the background; `done` settles with the final record. */
  start(definition: unknown, commit: string): CiStartResult;
  /** Requests abort and stops scheduling. Completion records expose unconfirmed termination until a runtime proves cleanup. */
  cancel(runId: string): CiCancelResult;
  get(runId: string): CiRunRecord | undefined;
}

export interface CiEngineOptions {
  readonly runner: CiJobRunner;
  /** Maximum wall-clock duration of each job. Defaults to 30 minutes. */
  readonly jobTimeoutMs?: number;
  /** Clock for job and run timestamps. Defaults to Date.now. */
  readonly now?: () => number;
}

const COMMIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const MAX_ERROR_LENGTH = 500;

const isConclusion = (value: unknown): value is CiConclusion => value === "success" || value === "failure" || value === "cancelled";

interface LiveJob {
  readonly spec: WorkflowJob;
  readonly controller: AbortController;
  conclusion: CiJobConclusion | null;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  termination: "pending" | "settled" | "unconfirmed";
}

interface LiveRun {
  readonly runId: string;
  readonly workflow: string;
  readonly commit: string;
  readonly startedAt: number;
  readonly jobs: readonly LiveJob[];
  readonly jobsByName: ReadonlyMap<string, LiveJob>;
  finishedAt: number | null;
  conclusion: CiConclusion | null;
  cancelRequested: boolean;
}

const conclusionOf = (run: LiveRun, name: string): CiJobConclusion | null => run.jobsByName.get(name)?.conclusion ?? null;

/** Builds a fresh, frozen copy so callers can never reach the engine's mutable state. */
const snapshot = (run: LiveRun): CiRunRecord =>
  Object.freeze({
    runId: run.runId,
    workflow: run.workflow,
    commit: run.commit,
    status: run.finishedAt === null ? "in_progress" : "completed",
    conclusion: run.conclusion,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    jobs: Object.freeze(
      run.jobs.map((job) =>
        Object.freeze({
          name: job.spec.name,
          needs: Object.freeze([...job.spec.needs]),
          conclusion: job.conclusion,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
          error: job.error,
          termination: job.termination,
        }),
      ),
    ),
  });

const overallConclusion = (run: LiveRun): CiConclusion => {
  const conclusions = run.jobs.map((job) => job.conclusion);
  if (conclusions.every((conclusion) => conclusion === "success")) return "success";
  if (run.cancelRequested && !conclusions.includes("failure")) return "cancelled";
  return "failure";
};

export function createCiEngine(options: CiEngineOptions): CiEngine {
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.jobTimeoutMs ?? 30 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 24 * 60 * 60_000) throw new Error("Job timeout must be between 1 ms and 24 hours");
  const runs = new Map<string, LiveRun>();

  const runJob = async (run: LiveRun, job: LiveJob): Promise<void> => {
    job.startedAt = now();
    let conclusion: CiConclusion = "failure";
    let error: string | null = null;
    let timedOut = false;
    let runnerSettled = false;
    const onTimeout = setTimeout(() => {
      timedOut = true;
      job.controller.abort();
    }, timeoutMs);
    let removeAbortListener = () => {};
    const aborted = new Promise<{readonly conclusion: CiConclusion}>((resolve) => {
      const onAbort = () => resolve({conclusion: timedOut ? "failure" : "cancelled"});
      job.controller.signal.addEventListener("abort", onAbort, {once: true});
      removeAbortListener = () => job.controller.signal.removeEventListener("abort", onAbort);
    });
    try {
      // Racing also bounds an unresponsive runner; its late result never mutates the completed record.
      const result = await Promise.race([options.runner(job.spec, run.commit, job.controller.signal).finally(() => { runnerSettled = true; }), aborted]);
      if (isConclusion(result.conclusion)) conclusion = result.conclusion;
      else error = "The runner returned an unknown conclusion";
    } catch (caught) {
      error = (caught instanceof Error ? caught.message : String(caught)).slice(0, MAX_ERROR_LENGTH);
    }
    clearTimeout(onTimeout);
    removeAbortListener();
    if (timedOut) error = "Job exceeded its timeout";
    job.termination = runnerSettled ? "settled" : "unconfirmed";
    job.conclusion = conclusion;
    job.error = error;
    job.finishedAt = now();
  };

  /** Jobs are in dependency order, so one pass also reaches every transitive dependent of a failure. */
  const skipBlockedJobs = (run: LiveRun): void => {
    for (const job of run.jobs) {
      if (job.conclusion !== null || job.startedAt !== null) continue;
      const blocked = job.spec.needs.some((need) => {
        const conclusion = conclusionOf(run, need);
        return conclusion !== null && conclusion !== "success";
      });
      if (blocked) {
        job.conclusion = "skipped";
        job.termination = "settled";
        job.finishedAt = now();
      }
    }
  };

  const execute = async (run: LiveRun): Promise<CiRunRecord> => {
    while (!run.cancelRequested) {
      skipBlockedJobs(run);
      const ready = run.jobs.filter(
        (job) => job.conclusion === null && job.startedAt === null && job.spec.needs.every((need) => conclusionOf(run, need) === "success"),
      );
      if (ready.length === 0) break;
      await Promise.all(ready.map((job) => runJob(run, job)));
    }
    run.conclusion = overallConclusion(run);
    run.finishedAt = now();
    return snapshot(run);
  };

  const start = (definition: unknown, commit: string): CiStartResult => {
    if (!COMMIT_SHA.test(commit)) return {ok: false, error: "A run needs an exact commit SHA"};
    const parsed = parseWorkflow(definition);
    if (!parsed.ok) return {ok: false, error: parsed.error};
    const jobs: LiveJob[] = parsed.workflow.jobs.map((spec) => ({spec, controller: new AbortController(), conclusion: null, startedAt: null, finishedAt: null, error: null, termination: "pending"}));
    const run: LiveRun = {
      runId: crypto.randomUUID(),
      workflow: parsed.workflow.name,
      commit,
      startedAt: now(),
      jobs,
      jobsByName: new Map<string, LiveJob>(jobs.map((job) => [job.spec.name, job] as const)),
      finishedAt: null,
      conclusion: null,
      cancelRequested: false,
    };
    runs.set(run.runId, run);
    const initial = snapshot(run);
    return {ok: true, run: initial, done: execute(run)};
  };

  const cancel = (runId: string): CiCancelResult => {
    const run = runs.get(runId);
    if (run === undefined) return {ok: false, error: "Unknown run"};
    if (run.finishedAt !== null) return {ok: false, error: "The run already finished"};
    run.cancelRequested = true;
    const at = now();
    for (const job of run.jobs) {
      if (job.conclusion === null && job.startedAt !== null) job.controller.abort();
      if (job.conclusion === null && job.startedAt === null) {
        job.conclusion = "cancelled";
        job.termination = "settled";
        job.finishedAt = at;
      }
    }
    return {ok: true};
  };

  const get = (runId: string): CiRunRecord | undefined => {
    const run = runs.get(runId);
    return run === undefined ? undefined : snapshot(run);
  };

  return {start, cancel, get};
}

/** One check run per finished job, for ci-gate. Skipped jobs are neutral: the gate does not count them as passing. Jobs without a result produce no check run, so the gate treats them as missing. */
export function checkRunsFor(run: CiRunRecord): CheckRun[] {
  const checks: CheckRun[] = [];
  for (const job of run.jobs) {
    if (job.conclusion === null || job.finishedAt === null) continue;
    checks.push({
      name: job.name,
      commit: run.commit,
      conclusion: job.conclusion === "skipped" ? "neutral" : job.conclusion,
      finishedAt: job.finishedAt,
    });
  }
  return checks;
}
