import { expect, test } from "bun:test";
import { safeSearchText, searchAccountMetadata } from "../src/server/metadata-search.js";
import type { FlareGitProjectState } from "../src/core/types.js";
import type { ProjectRow } from "../src/server/durable-object.js";
const id = "p123456abcdef";
const reference: ProjectRow = { id, name: "Find me", role: "owner", kind: "empty", created_at: "" };
const state = { projectId: id, projectName: "Find me", tasks: {} } as FlareGitProjectState;
function repository(role: () => Promise<unknown>, read = async () => state) { return { roleOf: role, getState: read, listIssues: async () => [] }; }
test("account metadata searches literal names with bounded internal links", async () => {
  const result = await searchAccountMetadata({ query: "Find", userId: "user", references: [reference], repository: () => repository(async () => "owner"), lifecycle: async () => "active" });
  expect(result.results).toEqual([{ id, kind: "repository", title: "Find me", description: "Repository", href: `/#/p/${id}/code` }]);
});
test("membership revocation during an awaited read suppresses results", async () => {
  let allowed = true;
  const result = await searchAccountMetadata({ query: "Find", userId: "user", references: [reference], repository: () => repository(async () => allowed ? "owner" : null, async () => { await Promise.resolve(); allowed = false; return state; }), lifecycle: async () => "active" });
  expect(result.results).toEqual([]);
});
test("wrong repository snapshots and deleted accounts cannot return private metadata", async () => {
  const input = { query: "Find", userId: "user", references: [reference], repository: () => repository(async () => "owner", async () => ({ ...state, projectId: "p999999999999" })), lifecycle: async () => "active" };
  expect((await searchAccountMetadata(input)).results).toEqual([]);
  expect((await searchAccountMetadata({ ...input, lifecycle: async () => "deleted" })).results).toEqual([]);
});
test("credential URL keys are decoded and credentials omitted", () => {
  expect(safeSearchText("See https://token@example.com/path and https://example.com/?%61pi_key=private")).toBe("See [REDACTED URL] and [REDACTED URL]");
});
test("oversized queries reject and revoked membership skips all reads", async () => {
  let read = false;
  const input = { query: "Find", userId: "user", references: [reference], repository: () => repository(async () => null, async () => { read = true; return state; }), lifecycle: async () => "active" };
  expect((await searchAccountMetadata(input)).results).toEqual([]);
  expect(read).toBe(false);
  await expect(searchAccountMetadata({ ...input, query: "x".repeat(201) })).rejects.toThrow(RangeError);
});
