import {expect, test} from "bun:test";
import {nextStep, planRevert} from "../src/core/merge-queue";

const pass = () => true;

test("the head merges only on the current base with passing checks", () => {
  const queue = [{change: "c1", baseCommit: "b0"}];
  expect(nextStep(queue, "b0", pass, () => "b1")).toEqual({action: "merge", change: "c1", newBase: "b1"});
  expect(nextStep(queue, "b9", pass, () => "b1").action).toBe("requeue");
  expect(nextStep(queue, "b0", () => false, () => "b1").action).toBe("requeue");
  expect(nextStep([], "b0", pass, () => "b1")).toEqual({action: "idle"});
});

test("reverts are new changes that name the target and reason", () => {
  expect(planRevert(["c1"], {revertsChange: "c1", requestedBy: "a", reason: " broke build "})).toEqual({ok: true, title: "Revert c1: broke build"});
  expect(planRevert(["c1"], {revertsChange: "c2", requestedBy: "a", reason: "x"}).ok).toBe(false);
  expect(planRevert(["c1"], {revertsChange: "c1", requestedBy: "a", reason: " "}).ok).toBe(false);
});
