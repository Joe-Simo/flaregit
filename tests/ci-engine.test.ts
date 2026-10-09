import {expect, test} from "bun:test";
import {checkRunsFor, createCiEngine, type CiConclusion, type CiEngine, type CiJobRunner, type CiRunRecord} from "../src/core/ci-engine";
import {failingRequiredChecks} from "../src/core/ci-gate";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);

const definition = (jobs: readonly {name: string; needs?: readonly string[]}[]) => ({name: "ci", triggers: ["push"], jobs});
const steppingClock = (start: number) => {
  let time = start - 1;
  return () => ++time;
};
const succeed: CiJobRunner = async () => ({conclusion: "success"});
const startRun = (engine: CiEngine, input: unknown, commit = SHA) => {
  const result = engine.start(input, commit);
  if (!result.ok) throw new Error(result.error);
  return result;
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return {promise, resolve};
};
const outcomes = (record: CiRunRecord) => Object.fromEntries(record.jobs.map((job) => [job.name, job.conclusion]));

test("a branch name or an invalid definition starts no run", () => {
  const engine = createCiEngine({runner: succeed});
  expect(engine.start(definition([{name: "build"}]), "main")).toEqual({ok: false, error: "A run needs an exact commit SHA"});
  expect(engine.start(definition([{name: "build", needs: ["setup"]}]), SHA)).toEqual({ok: false, error: "Job build needs missing job setup"});
});

test("independent jobs start in the same wave and dependents wait for the whole wave", async () => {
  const events: string[] = [];
  const runner: CiJobRunner = async (job) => {
    events.push(`start ${job.name}`);
    await Promise.resolve();
    events.push(`finish ${job.name}`);
    return {conclusion: "success"};
  };
  const {done} = startRun(createCiEngine({runner, now: steppingClock(1)}), definition([{name: "lint"}, {name: "unit"}, {name: "ship", needs: ["lint", "unit"]}]));
  expect((await done).conclusion).toBe("success");
  expect(events).toEqual(["start lint", "start unit", "finish lint", "finish unit", "start ship", "finish ship"]);
});

test("a failed job skips its dependents transitively without running them", async () => {
  const called: string[] = [];
  const runner: CiJobRunner = async (job) => {
    called.push(job.name);
    return {conclusion: job.name === "test" ? "failure" : "success"};
  };
  const {done} = startRun(
    createCiEngine({runner, now: steppingClock(1)}),
    definition([{name: "build"}, {name: "lint"}, {name: "test", needs: ["build"]}, {name: "deploy", needs: ["test"]}, {name: "publish", needs: ["deploy", "lint"]}]),
  );
  const record = await done;
  expect(called).toEqual(["build", "lint", "test"]);
  expect(outcomes(record)).toEqual({build: "success", lint: "success", test: "failure", deploy: "skipped", publish: "skipped"});
  expect(record.conclusion).toBe("failure");
});

test("a runner exception fails only that job, with its message capped at 500 characters", async () => {
  const runner: CiJobRunner = async (job) => {
    if (job.name === "build") throw new Error("x".repeat(800));
    return {conclusion: "success"};
  };
  const record = await startRun(createCiEngine({runner, now: steppingClock(1)}), definition([{name: "build"}, {name: "lint"}])).done;
  expect(record.jobs.find((job) => job.name === "build")).toMatchObject({conclusion: "failure", error: "x".repeat(500)});
  expect(outcomes(record)).toEqual({build: "failure", lint: "success"});
  expect(record.conclusion).toBe("failure");
});

test("an unknown conclusion from the runner is a failure", async () => {
  const runner: CiJobRunner = async () => ({conclusion: "neutral" as unknown as CiConclusion});
  const record = await startRun(createCiEngine({runner, now: steppingClock(1)}), definition([{name: "build"}])).done;
  expect(record.jobs[0]).toMatchObject({conclusion: "failure", error: "The runner returned an unknown conclusion"});
});

test("jobs and the run take their start and finish times from the injected clock", async () => {
  const record = await startRun(createCiEngine({runner: succeed, now: steppingClock(100)}), definition([{name: "build"}, {name: "test", needs: ["build"]}])).done;
  expect(record).toMatchObject({startedAt: 100, finishedAt: 105, status: "completed"});
  expect(record.jobs.map((job) => [job.startedAt, job.finishedAt])).toEqual([
    [101, 102],
    [103, 104],
  ]);
});

test("cancel aborts the running wave, schedules nothing new, and cancels pending jobs", async () => {
  const called: string[] = [];
  const gate = deferred<{conclusion: CiConclusion}>();
  const runner: CiJobRunner = async (job) => {
    called.push(job.name);
    if (job.name === "build") return gate.promise;
    return {conclusion: "success"};
  };
  const engine = createCiEngine({runner, now: steppingClock(1)});
  const {run, done} = startRun(engine, definition([{name: "build"}, {name: "test", needs: ["build"]}, {name: "deploy", needs: ["test"]}]));
  expect(run).toMatchObject({status: "in_progress", conclusion: null});
  expect(engine.cancel(run.runId)).toEqual({ok: true});
  gate.resolve({conclusion: "success"});
  const record = await done;
  expect(called).toEqual(["build"]);
  expect(outcomes(record)).toEqual({build: "cancelled", test: "cancelled", deploy: "cancelled"});
  expect(record.conclusion).toBe("cancelled");
});

test("a finished run no longer changes and unknown runs cannot be cancelled", async () => {
  const engine = createCiEngine({runner: succeed, now: steppingClock(1)});
  const {run, done} = startRun(engine, definition([{name: "build"}]));
  const record = await done;
  expect(record.status).toBe("completed");
  expect(engine.cancel(run.runId)).toEqual({ok: false, error: "The run already finished"});
  expect(engine.get(run.runId)).toEqual(record);
  expect(engine.cancel("missing")).toEqual({ok: false, error: "Unknown run"});
});

test("the run succeeds only when every job succeeds", async () => {
  const allGreen = await startRun(createCiEngine({runner: succeed, now: steppingClock(1)}), definition([{name: "build"}, {name: "test", needs: ["build"]}])).done;
  expect(allGreen.conclusion).toBe("success");

  const cancelledByRunner: CiJobRunner = async (job) => ({conclusion: job.name === "lint" ? "cancelled" : "success"});
  const partial = await startRun(createCiEngine({runner: cancelledByRunner, now: steppingClock(1)}), definition([{name: "build"}, {name: "lint"}])).done;
  expect(outcomes(partial)).toEqual({build: "success", lint: "cancelled"});
  expect(partial.conclusion).toBe("failure");
});

test("the run record is plain data that survives a JSON round trip", async () => {
  const record = await startRun(createCiEngine({runner: succeed, now: steppingClock(1)}), definition([{name: "build"}])).done;
  expect(JSON.parse(JSON.stringify(record))).toEqual(record);
});

test("check runs from a finished run feed the required-check gate for its exact commit", async () => {
  const runner: CiJobRunner = async (job) => ({conclusion: job.name === "test" ? "failure" : "success"});
  const record = await startRun(createCiEngine({runner, now: steppingClock(1)}), definition([{name: "build"}, {name: "test", needs: ["build"]}, {name: "deploy", needs: ["test"]}])).done;
  const required = ["build", "test", "deploy"];
  expect(failingRequiredChecks(required, checkRunsFor(record), SHA)).toEqual(["test", "deploy"]);
  expect(failingRequiredChecks(required, checkRunsFor(record), OTHER_SHA)).toEqual(required);
});


test("timeout aborts an unresponsive runner and skips its dependents", async () => {
  let signal: AbortSignal | undefined;
  const engine = createCiEngine({jobTimeoutMs: 5, runner: async (_job, _commit, abortSignal) => {
    signal = abortSignal;
    return new Promise(() => {});
  }});
  const record = await startRun(engine, definition([{name: "build"}, {name: "deploy", needs: ["build"]}])).done;
  expect(signal?.aborted).toBe(true);
  expect(record.jobs[0]?.error).toBe("Job exceeded its timeout");
  expect(record.jobs[0]?.termination).toBe("unconfirmed");
  expect(outcomes(record)).toEqual({build: "failure", deploy: "skipped"});
});

test("cancel settles an unresponsive runner and ignores its late success", async () => {
  const gate = deferred<{conclusion: CiConclusion}>();
  let signal: AbortSignal | undefined;
  const engine = createCiEngine({runner: async (_job, _commit, abortSignal) => { signal = abortSignal; return gate.promise; }});
  const {run, done} = startRun(engine, definition([{name: "build"}]));
  engine.cancel(run.runId);
  const record = await done;
  expect(signal?.aborted).toBe(true);
  expect(record.conclusion).toBe("cancelled");
  expect(record.jobs[0]?.termination).toBe("unconfirmed");
  gate.resolve({conclusion: "success"});
  await Promise.resolve();
  expect(engine.get(run.runId)).toEqual(record);
});

test("invalid timeout budgets fail before any job starts", () => {
  for (const jobTimeoutMs of [0, -1, NaN, Infinity, 1.5, 86_400_001]) {
    expect(() => createCiEngine({runner: succeed, jobTimeoutMs})).toThrow("Job timeout");
  }
});
