import {expect, test} from "bun:test";
import {failingRequiredChecks, type CheckRun} from "../src/core/ci-gate";

const run = (name: string, commit: string, conclusion: CheckRun["conclusion"], finishedAt: number): CheckRun => ({name, commit, conclusion, finishedAt});

test("missing and failing required checks block", () => {
  expect(failingRequiredChecks(["build", "test"], [run("build", "c1", "success", 1)], "c1")).toEqual(["test"]);
  expect(failingRequiredChecks(["build"], [run("build", "c1", "failure", 1)], "c1")).toEqual(["build"]);
});

test("the latest run wins and other commits do not count", () => {
  const runs = [run("build", "c1", "failure", 1), run("build", "c1", "success", 2), run("test", "c0", "success", 3)];
  expect(failingRequiredChecks(["build", "test"], runs, "c1")).toEqual(["test"]);
  expect(failingRequiredChecks(["build"], [run("build", "c1", "success", 1), run("build", "c1", "failure", 2)], "c1")).toEqual(["build"]);
});
