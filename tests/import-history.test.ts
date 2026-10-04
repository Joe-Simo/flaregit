import { expect, test } from "bun:test";
import { captureArtifactsHistory, captureArtifactsHistoryChunk, HistoryMetadataLimitError, verifyImportedHistory } from "../src/server/import-history";
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
test("missing ancestry is incomplete and later branch movement preserves historical snapshot", async () => {
  const source = await captureArtifactsHistory(fixture(), "repo", "main", head);
  expect(await verifyImportedHistory(fixture(true), "repo", "main", head, source)).toMatchObject({ status: "incomplete" });
  expect(await captureArtifactsHistory(fixture(false, true), "repo", "main", head)).toMatchObject({ refs: { "refs/heads/main": head } });
  expect(await verifyImportedHistory(fixture(), "repo", "main", head, null)).toMatchObject({ status: "unavailable" });
});

test("partial destination keeps proven metadata mismatch while missing entries remain incomplete", async () => {
  const source = await captureArtifactsHistory(fixture(), "repo", "main", head);
  const changed = { get: async () => ({ [Symbol.dispose]() {}, log: async () => [{ hash: head }], readCommit: async (hash: string) => hash === parent ? null : { hash, treeHash: "d".repeat(40), parents: [parent] } }) };
  expect(await verifyImportedHistory(changed, "repo", "main", head, source)).toMatchObject({ status: "mismatch", receipt: { differentCommits: [head], missingCommits: [parent] } });
});

test("explicit frontier chunks preserve merge parent order and admit every attempted read", async () => {
  const second = "d".repeat(40), attempts: string[] = [];
  let disposed = false;
  const binding = { get: async () => ({ [Symbol.dispose]() { disposed = true; }, log: async () => [], readCommit: async (hash: string) => hash === second ? null : { hash, treeHash: tree, parents: hash === head ? [second, parent] : [] } }) };
  const chunk = await captureArtifactsHistoryChunk(binding, "repo", [head, second, parent], async hash => { attempts.push(hash); });
  expect(attempts).toEqual([head, second, parent]);
  expect(chunk).toEqual({ commits: { [head]: { tree, parents: [second, parent] }, [parent]: { tree, parents: [] } }, missing: [second] });
  expect(disposed).toBe(true);
});

test("revoked admission stops subsequent provider reads and invalid metadata cannot advance a chunk", async () => {
  const reads: string[] = [];
  const binding = { get: async () => ({ [Symbol.dispose]() {}, log: async () => [], readCommit: async (hash: string) => { reads.push(hash); return { hash, treeHash: tree, parents: [] }; } }) };
  await expect(captureArtifactsHistoryChunk(binding, "repo", [head, parent], async (_hash, index) => { if (index) throw new Error("Access revoked"); })).rejects.toThrow("Access revoked");
  expect(reads).toEqual([head]);
  await expect(captureArtifactsHistoryChunk(binding, "repo", [head, head], async () => {})).rejects.toThrow("Invalid history inspection frontier");
  expect(reads).toEqual([head]);
  const invalid = { get: async () => ({ [Symbol.dispose]() {}, log: async () => [], readCommit: async () => ({ hash: parent, treeHash: tree, parents: [] }) }) };
  await expect(captureArtifactsHistoryChunk(invalid, "repo", [head], async () => {})).rejects.toThrow("Invalid imported commit metadata");
});

test("one linear frontier advances a bounded 128 commits rather than one workflow step per commit", async () => {
  const sha = (index: number) => index.toString(16).padStart(40, "0");
  let reads = 0;
  const binding = { get: async () => ({ [Symbol.dispose]() {}, log: async () => [], readCommit: async (hash: string) => { reads++; const index = Number.parseInt(hash, 16); return { hash, treeHash: tree, parents: index ? [sha(index - 1)] : [] }; } }) };
  const first = await captureArtifactsHistoryChunk(binding, "repo", [sha(200)], async () => {});
  expect(Object.keys(first.commits)).toHaveLength(128);
  expect(reads).toBe(128);
  expect(first.commits[sha(73)]?.parents).toEqual([sha(72)]);
  const next = await captureArtifactsHistoryChunk(binding, "repo", [sha(72)], async () => {});
  expect(Object.keys(next.commits)).toHaveLength(73);
  expect(next.commits[sha(0)]?.parents).toEqual([]);
});

test("captured merge boundaries avoid repeated reads without skipping a requested frontier", async () => {
  const reads: string[] = [];
  const binding = { get: async () => ({ [Symbol.dispose]() {}, log: async () => [], readCommit: async (hash: string) => { reads.push(hash); return { hash, treeHash: tree, parents: hash === head ? [parent] : [] }; } }) };
  const chunk = await captureArtifactsHistoryChunk(binding, "repo", [head], async () => {}, [head, parent]);
  expect(reads).toEqual([head]);
  expect(chunk.commits[head]?.parents).toEqual([parent]);
  expect(chunk.missing).toEqual([]);
});

test("authority lost during the final provider read prevents returning its metadata", async () => {
  let active = true;
  const binding = { get: async () => ({ [Symbol.dispose]() {}, log: async () => [], readCommit: async (hash: string) => { active = false; return { hash, treeHash: tree, parents: [] }; } }) };
  await expect(captureArtifactsHistoryChunk(binding, "repo", [head], async () => {}, [], async () => { if (!active) throw new Error("Access revoked during read"); })).rejects.toThrow("Access revoked during read");
});

test("authority lost during funding prevents dispatching an imported-history read", async () => {
  let active = true, reads = 0;
  const binding = { get: async () => ({ [Symbol.dispose]() {}, log: async () => [], readCommit: async (hash: string) => { reads++; return { hash, treeHash: tree, parents: [] }; } }) };
  await expect(captureArtifactsHistoryChunk(binding, "repo", [head], async () => { active = false; }, [], async () => { if (!active) throw new Error("Access revoked during funding"); })).rejects.toThrow("Access revoked during funding");
  expect(reads).toBe(0);
});

test("metadata wider than the fixed parent bound reports capacity rather than a retryable provider failure", async () => {
  const parents = Array.from({ length: 257 }, (_, index) => index.toString(16).padStart(40, "0"));
  const binding = { get: async () => ({ [Symbol.dispose]() {}, log: async () => [], readCommit: async (hash: string) => ({ hash, treeHash: tree, parents }) }) };
  await expect(captureArtifactsHistoryChunk(binding, "repo", [head], async () => {})).rejects.toBeInstanceOf(HistoryMetadataLimitError);
});
