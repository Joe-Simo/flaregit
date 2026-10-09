import {expect, test} from "bun:test";
import {progress, type Project} from "../src/core/project-planning";
import {
  addPlanItem,
  applyView,
  assignIteration,
  createIteration,
  exportProject,
  MAX_BULK_ITEMS,
  setAutomation,
  setStatusBulk,
  startPlan,
  updatePlanItem,
  type AutomationRule,
  type BulkOutcome,
  type Outcome,
  type ProjectPlan,
  type ProjectView,
} from "../src/core/project-views";

const project: Project = {statuses: ["todo", "doing", "done"], fieldTypes: {points: "number", owner: "text"}, items: []};
const sprintOne = {id: "s1", title: "Sprint 1", start: "2026-01-05", end: "2026-01-16"};
const sprintTwo = {id: "s2", title: "Sprint 2", start: "2026-01-19", end: "2026-01-30"};
const doneRule: AutomationRule = {when: {toStatus: "done"}, then: {setField: "points", value: 0}};
const board: ProjectView = {name: "Board", layout: "board", filter: {}, sortBy: "issueNumber", direction: "asc"};

function must(result: Outcome<ProjectPlan>): ProjectPlan {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function mustBulk(result: BulkOutcome): ProjectPlan {
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}

function plannedWith(numbers: readonly number[], base: Project = project): ProjectPlan {
  return numbers.reduce((plan, issueNumber) => must(addPlanItem(plan, issueNumber, numbers)), startPlan(base));
}

function viewWith(overrides: Partial<ProjectView>): ProjectView {
  return {...board, ...overrides};
}

function viewNumbers(plan: ProjectPlan, view: ProjectView): number[] {
  const result = applyView(plan, view);
  if (!result.ok) throw new Error(result.error);
  return result.value.map((item) => item.issueNumber);
}

function sampleBoard(): ProjectPlan {
  let plan = must(createIteration(plannedWith([1, 2, 3, 4]), sprintOne));
  plan = must(updatePlanItem(plan, 1, 1, {fields: {points: 5}}));
  plan = must(updatePlanItem(plan, 2, 1, {status: "doing", fields: {points: 3}}));
  plan = must(updatePlanItem(plan, 3, 1, {fields: {points: 5}}));
  plan = must(assignIteration(plan, 1, "s1"));
  return must(assignIteration(plan, 3, "s1"));
}

test("iterations need unique ids, real calendar dates and an end on or after the start", () => {
  const base = startPlan(project);
  const created = must(createIteration(base, sprintOne));
  expect(created.iterations).toEqual([sprintOne]);
  expect(createIteration(created, {...sprintTwo, id: "s2", end: "2026-01-04"}).ok).toBe(false);
  expect(createIteration(base, {...sprintOne, start: "2026-02-30"}).ok).toBe(false);
  expect(createIteration(base, {...sprintOne, start: "2026-1-5"}).ok).toBe(false);
  expect(createIteration(created, {...sprintTwo, id: "s1"}).ok).toBe(false);
  expect(createIteration(base, {...sprintOne, end: "2026-01-05"}).ok).toBe(true);
});

test("an item belongs to at most one iteration and must exist", () => {
  const plan = must(createIteration(must(createIteration(plannedWith([1]), sprintOne)), sprintTwo));
  expect(assignIteration(plan, 9, "s1").ok).toBe(false);
  expect(assignIteration(plan, 1, "s9").ok).toBe(false);
  const moved = must(assignIteration(must(assignIteration(plan, 1, "s1")), 1, "s2"));
  expect(moved.assignments).toEqual([{issueNumber: 1, iterationId: "s2"}]);
});

test("views filter by status and iteration and sort with ascending issue-number tie breaks", () => {
  const plan = sampleBoard();
  expect(viewNumbers(plan, viewWith({sortBy: "points", direction: "desc"}))).toEqual([1, 3, 2, 4]);
  expect(viewNumbers(plan, viewWith({sortBy: "points", direction: "asc"}))).toEqual([2, 1, 3, 4]);
  expect(viewNumbers(plan, viewWith({filter: {status: ["todo"]}, direction: "desc"}))).toEqual([4, 3, 1]);
  expect(viewNumbers(plan, viewWith({filter: {iteration: "s1"}, sortBy: "points", direction: "desc"}))).toEqual([1, 3]);
  expect(viewNumbers(plan, viewWith({filter: {iteration: "s1", status: ["doing"]}}))).toEqual([]);
});

test("applyView refuses unknown sort fields, statuses, iterations, layouts and directions", () => {
  const plan = sampleBoard();
  const accepted = (overrides: Partial<ProjectView>): boolean => applyView(plan, viewWith(overrides)).ok;
  expect(accepted({sortBy: "points"})).toBe(true);
  expect(accepted({sortBy: "nope"})).toBe(false);
  expect(accepted({sortBy: "toString"})).toBe(false);
  expect(accepted({filter: {status: ["shipped"]}})).toBe(false);
  expect(accepted({filter: {status: []}})).toBe(false);
  expect(accepted({filter: {iteration: "s9"}})).toBe(false);
  expect(accepted({name: "  "})).toBe(false);
  expect(accepted({layout: "gantt" as unknown as ProjectView["layout"]})).toBe(false);
  expect(accepted({direction: "sideways" as unknown as ProjectView["direction"]})).toBe(false);
});

test("automation fires only when a status really changes, in one version bump", () => {
  let plan = must(setAutomation(plannedWith([1]), [doneRule]));
  plan = must(updatePlanItem(plan, 1, 1, {status: "doing"}));
  expect(plan.project.items[0]?.fields).toEqual({});
  plan = must(updatePlanItem(plan, 1, 2, {status: "done"}));
  expect(plan.project.items[0]).toMatchObject({status: "done", fields: {points: 0}, version: 3});
  plan = must(updatePlanItem(plan, 1, 3, {fields: {points: 9}}));
  plan = must(updatePlanItem(plan, 1, 4, {status: "done"}));
  expect(plan.project.items[0]?.fields).toEqual({points: 9});
});

test("values set explicitly in the same edit win over automation", () => {
  const plan = must(setAutomation(plannedWith([1]), [doneRule]));
  const moved = must(updatePlanItem(plan, 1, 1, {status: "done", fields: {points: 8}}));
  expect(moved.project.items[0]?.fields).toEqual({points: 8});
});

test("rules must target a known status and a declared field whose type matches the value", () => {
  const rule = (toStatus: string, setField: string, value: string | number): AutomationRule => ({when: {toStatus}, then: {setField, value}});
  const base = startPlan(project);
  expect(setAutomation(base, [rule("done", "owner", "alice")]).ok).toBe(true);
  expect(setAutomation(base, [rule("done", "points", 1)]).ok).toBe(true);
  expect(setAutomation(base, [rule("done", "nope", 1)]).ok).toBe(false);
  expect(setAutomation(base, [rule("done", "toString", 1)]).ok).toBe(false);
  expect(setAutomation(base, [rule("done", "points", "5")]).ok).toBe(false);
  expect(setAutomation(base, [rule("done", "owner", 3)]).ok).toBe(false);
  expect(setAutomation(base, [rule("done", "points", Number.NaN)]).ok).toBe(false);
  expect(setAutomation(base, [rule("shipped", "points", 1)]).ok).toBe(false);
});

test("invalid rules that bypass validation are skipped when applied", () => {
  const forged: ProjectPlan = {...plannedWith([1]), rules: [{when: {toStatus: "done"}, then: {setField: "nope", value: 1}}]};
  const moved = must(updatePlanItem(forged, 1, 1, {status: "done"}));
  expect(moved.project.items[0]).toMatchObject({status: "done", fields: {}});
});

test("bulk status changes are all or nothing and check every item's version", () => {
  const plan = must(setAutomation(plannedWith([1, 2, 3]), [doneRule]));
  const stale = must(updatePlanItem(plan, 2, 1, {fields: {points: 1}}));
  expect(setStatusBulk(stale, [1, 2, 3], "done", [1, 1, 1])).toEqual({
    ok: false,
    errors: [{issueNumber: 2, error: "The item changed since it was read"}],
  });
  expect(stale.project.items.map((item) => item.status)).toEqual(["todo", "todo", "todo"]);
  const moved = mustBulk(setStatusBulk(plan, [1, 2, 3], "done", [1, 1, 1]));
  expect(progress(moved.project)).toEqual({todo: 0, doing: 0, done: 3});
  expect(moved.project.items.map((item) => item.fields.points)).toEqual([0, 0, 0]);
});

test("bulk requests are capped at 100 distinct items and need one version per item", () => {
  const numbers = Array.from({length: MAX_BULK_ITEMS + 1}, (_, index) => index + 1);
  expect(setStatusBulk(startPlan(project), numbers, "done", numbers.map(() => 1))).toEqual({
    ok: false,
    errors: [{error: `Bulk status changes are limited to ${MAX_BULK_ITEMS} items`}],
  });
  expect(setStatusBulk(startPlan(project), [], "done", []).ok).toBe(false);
  expect(setStatusBulk(startPlan(project), [1, 1], "done", [1, 1]).ok).toBe(false);
  expect(setStatusBulk(startPlan(project), [1], "done", []).ok).toBe(false);
  expect(setStatusBulk(plannedWith([1]), [1], "shipped", [1]).ok).toBe(false);
  const capped = Array.from({length: MAX_BULK_ITEMS}, (_, index) => index + 1);
  const full = mustBulk(setStatusBulk(plannedWith(capped), capped, "done", capped.map(() => 1)));
  expect(progress(full.project).done).toBe(MAX_BULK_ITEMS);
});

test("export is ordered by issue number and does not depend on insertion order", () => {
  const numeric: Project = {statuses: project.statuses, fieldTypes: {points: "number", estimate: "number"}, items: []};
  const first = must(
    updatePlanItem(
      must(assignIteration(must(createIteration(must(createIteration(plannedWith([2, 1], numeric), sprintTwo)), sprintOne)), 2, "s2")),
      2,
      1,
      {fields: {estimate: 4, points: 2}},
    ),
  );
  const second = must(
    updatePlanItem(
      must(assignIteration(must(createIteration(must(createIteration(plannedWith([1, 2], numeric), sprintOne)), sprintTwo)), 2, "s2")),
      2,
      1,
      {fields: {points: 2, estimate: 4}},
    ),
  );
  const exported = exportProject(first);
  expect(JSON.stringify(exported)).toBe(JSON.stringify(exportProject(second)));
  expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);
  expect(exported.items.map((item) => item.issueNumber)).toEqual([1, 2]);
  expect(Object.keys(exported.fieldTypes)).toEqual(["estimate", "points"]);
  expect(Object.keys(exported.items[1]?.fields ?? {})).toEqual(["estimate", "points"]);
  expect(exported.iterations.map((iteration) => iteration.id)).toEqual(["s1", "s2"]);
  expect(exported.assignments).toEqual([{issueNumber: 2, iterationId: "s2"}]);
});
