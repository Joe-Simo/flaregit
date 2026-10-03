import { expect, test } from "bun:test";
import { frozenInputDiffMatches } from "../src/web/review-diff-identity";
import { parseSignedRepositoryBrowseRequest } from "../src/server/public-repositories";

const commit = "e".repeat(40), base = "a".repeat(40), parent = "7".repeat(40);
const saved = { repo: "task:frozen", base, head: { hash: commit, parents: [parent] }, input: { taskId: "frozen", commit, baseSource: "recorded-contribution-base" as const } };

test("verified saved bases survive missing legacy candidate metadata without replacing the frozen head", () => {
  expect(frozenInputDiffMatches(saved, { taskId: "frozen", commit })).toBe(true);
  expect(frozenInputDiffMatches(saved, { taskId: "frozen", commit, base })).toBe(true);
  for (const wrong of [{ ...saved, head: { ...saved.head, hash: "f".repeat(40) } }, { ...saved, base: null }, { ...saved, repo: "canonical" }, { ...saved, input: { ...saved.input, taskId: "other" } }, { ...saved, input: undefined }]) {
    expect(frozenInputDiffMatches(wrong, { taskId: "frozen", commit })).toBe(false);
  }
  expect(frozenInputDiffMatches({ ...saved, base: parent }, { taskId: "frozen", commit, base })).toBe(false);
});

test("unrecorded legacy ranges remain exactly the first parent and never override a recorded base", () => {
  const legacy = { ...saved, base: parent, input: { ...saved.input, baseSource: "commit-parent" as const } };
  expect(frozenInputDiffMatches(legacy, { taskId: "frozen", commit })).toBe(true);
  expect(frozenInputDiffMatches(legacy, { taskId: "frozen", commit, base: parent })).toBe(false);
  expect(frozenInputDiffMatches({ ...legacy, base }, { taskId: "frozen", commit })).toBe(false);
});

test("explicit saved comparison ranges require two full canonical hashes", () => {
  expect(parseSignedRepositoryBrowseRequest("/diff", new URLSearchParams({ commit, base }))).toMatchObject({ kind: "diff", commit, base });
  for (const query of [`commit=${commit.slice(0, 7)}&base=${base}`, `commit=${commit}&base=HEAD`, `task=frozen&base=${base}`, `candidate=frozen&base=${base}`, `commit=${commit}&base=${base}&input=frozen`]) {
    expect(() => parseSignedRepositoryBrowseRequest("/diff", new URLSearchParams(query))).toThrow();
  }
});
