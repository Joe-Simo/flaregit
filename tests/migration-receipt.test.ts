import { expect, test } from "bun:test";
import { compareMigrationHistory, type GitHistoryInventory } from "../src/server/migration-receipt";
const tip = "a".repeat(40), root = "b".repeat(40), tree = "c".repeat(40);
const inventory = (): GitHistoryInventory => ({ capturedAt: "2026-10-02T12:00:00Z", shallow: false, refs: { "refs/heads/main": tip }, commits: { [tip]: { tree, parents: [root] }, [root]: { tree, parents: [] } } });
test("selected ref receipt compares entire inventoried history rather than only matching tips", () => {
  expect(compareMigrationHistory(inventory(), inventory(), ["refs/heads/main"])).toMatchObject({ status: "verified", commitsCompared: 2, scope: "selected-ref-reachable-commit-history" });
  const truncated = inventory(); delete truncated.commits[root];
  expect(compareMigrationHistory(inventory(), truncated, ["refs/heads/main"])).toMatchObject({ status: "mismatch", missingCommits: [root] });
});
test("shallow or missing source ancestry cannot produce complete history claims", () => {
  const shallow = { ...inventory(), shallow: true };
  expect(compareMigrationHistory(shallow, shallow, ["refs/heads/main"]).status).toBe("incomplete");
  const missing = inventory(); delete missing.commits[root];
  expect(compareMigrationHistory(missing, missing, ["refs/heads/main"]).status).toBe("incomplete");
});
test("changed source refs and trees are reported without hiding consequential differences", () => {
  const destination = inventory(); destination.refs["refs/heads/main"] = root; destination.commits[tip]!.tree = root;
  expect(compareMigrationHistory(inventory(), destination, ["refs/heads/main"])).toMatchObject({ status: "mismatch", differentRefs: ["refs/heads/main"], differentCommits: [tip] });
});
test("receipt rejects hidden refs and does not imply unselected branch, blob or tag object verification", () => {
  expect(() => compareMigrationHistory(inventory(), inventory(), ["refs/flaregit/candidate"])).toThrow();
  expect(compareMigrationHistory(inventory(), inventory(), ["refs/heads/main"]).detail).toContain("Blob transfer");
});
