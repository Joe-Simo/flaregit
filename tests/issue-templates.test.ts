import {expect, test} from "bun:test";
import {validateSubmission, validateTemplate, type IssueTemplate} from "../src/core/issue-templates";

const bug: IssueTemplate = {
  name: "Bug report",
  fields: [
    {id: "summary", type: "text", required: true},
    {id: "severity", type: "dropdown", required: true, options: ["low", "high"]},
    {id: "notes", type: "text", required: false},
    {id: "confirmed", type: "checkbox", required: true},
  ],
};

test("a valid submission is trimmed and accepted", () => {
  const result = validateSubmission(bug, {summary: " crash ", severity: "high", confirmed: true});
  expect(result).toEqual({ok: true, values: {summary: "crash", severity: "high", confirmed: true}});
});

test("missing and blank required fields are reported", () => {
  const result = validateSubmission(bug, {summary: "  ", confirmed: false});
  if (result.ok) throw new Error("expected failure");
  expect(result.errors.map((entry) => entry.field).sort()).toEqual(["confirmed", "severity", "summary"]);
});

test("unknown fields are rejected", () => {
  const result = validateSubmission(bug, {summary: "x", severity: "low", confirmed: true, extra: "y"});
  if (result.ok) throw new Error("expected failure");
  expect(result.errors).toEqual([{field: "extra", error: "Unknown field"}]);
});

test("wrong types and invalid dropdown options are rejected", () => {
  expect(validateSubmission(bug, {summary: 5, severity: "low", confirmed: true}).ok).toBe(false);
  expect(validateSubmission(bug, {summary: "x", severity: "medium", confirmed: true}).ok).toBe(false);
  expect(validateSubmission(bug, {summary: "x", severity: "low", confirmed: "yes"}).ok).toBe(false);
});

test("templates must be well formed", () => {
  expect(validateTemplate(bug)).toEqual([]);
  expect(validateTemplate({name: " ", fields: []}).length).toBe(2);
  expect(validateTemplate({name: "t", fields: [{id: "a", type: "text", required: false}, {id: "a", type: "dropdown", required: false, options: []}]}).length).toBe(2);
});
