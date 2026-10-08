import {expect, test} from "bun:test";
import {parseWorkflow} from "../src/core/workflow-parser";

const base = {name: "ci", triggers: ["push"]};

test("jobs come back in dependency order", () => {
  const result = parseWorkflow({...base, jobs: [{name: "deploy", needs: ["test"]}, {name: "test", needs: ["build"]}, {name: "build"}]});
  expect(result.ok && result.workflow.jobs.map((job) => job.name)).toEqual(["build", "test", "deploy"]);
});

test("unknown triggers, missing needs and duplicates are refused", () => {
  expect(parseWorkflow({...base, triggers: ["cron"], jobs: [{name: "a"}]})).toEqual({ok: false, error: "Unknown trigger cron"});
  expect(parseWorkflow({...base, jobs: [{name: "a", needs: ["b"]}]})).toEqual({ok: false, error: "Job a needs missing job b"});
  expect(parseWorkflow({...base, jobs: [{name: "a"}, {name: "a"}]})).toEqual({ok: false, error: "Duplicate job a"});
});

test("cycles including self-dependency are refused", () => {
  expect(parseWorkflow({...base, jobs: [{name: "a", needs: ["b"]}, {name: "b", needs: ["a"]}]}).ok).toBe(false);
  expect(parseWorkflow({...base, jobs: [{name: "a", needs: ["a"]}]}).ok).toBe(false);
});

test("malformed input is refused", () => {
  expect(parseWorkflow(null).ok).toBe(false);
  expect(parseWorkflow({name: "", triggers: ["push"], jobs: [{name: "a"}]}).ok).toBe(false);
  expect(parseWorkflow({...base, jobs: []}).ok).toBe(false);
});
