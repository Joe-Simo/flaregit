import { expect, test } from "bun:test";
import { captureArtifactsHistory, verifyImportedHistory } from "../src/server/import-history";
const head = "a".repeat(40), tree = "b".repeat(40), parent = "c".repeat(40);
function fixture(missing = false, moved = false) {
  let logs = 0;
  return { get: async () => ({ [Symbol.dispose]() {}, log: async () => [{ hash: moved && ++logs > 1 ? parent : head }], readCommit: async (hash: string) => hash === parent && missing ? null : { hash, treeHash: tree, parents: hash === head ? [parent] : [] } }) };
}
test("Artifacts inventory captures pinned entire ancestry without executing source", async () => {
  const inventory = await captureArtifactsHistory(fixture(), "repo", "main", head);
  expect(Object.keys(inventory!.commits)).toHaveLength(2);
  expect(inventory!.shallow).toBe(false);
  expect(await verifyImportedHistory(fixture(), "repo", "main", head, inventory)).toMatchObject({ status: "verified" });
});
test("missing ancestry is incomplete and changed ref invalidates snapshot", async () => {
  const source = await captureArtifactsHistory(fixture(), "repo", "main", head);
  expect(await verifyImportedHistory(fixture(true), "repo", "main", head, source)).toMatchObject({ status: "incomplete" });
  expect(await captureArtifactsHistory(fixture(false, true), "repo", "main", head)).toBeNull();
  expect(await verifyImportedHistory(fixture(), "repo", "main", head, null)).toMatchObject({ status: "unavailable" });
});
