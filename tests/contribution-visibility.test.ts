import {expect, test} from "bun:test";
import {summarize, type Contribution} from "../src/core/contribution-visibility";

const data: Contribution[] = [
  {repo: "open", repoPrivate: false},
  {repo: "secret-repo", repoPrivate: true},
];

test("owner sees private contributions", () => {
  expect(summarize(data, true, false)).toEqual({total: 2, repos: ["open", "secret-repo"]});
});

test("viewers do not count private work unless the owner opts in", () => {
  expect(summarize(data, false, false)).toEqual({total: 1, repos: ["open"]});
});

test("opt-in counts private work but never reveals private repo names", () => {
  const summary = summarize(data, false, true);
  expect(summary.total).toBe(2);
  expect(summary.repos).toEqual(["open"]);
});
