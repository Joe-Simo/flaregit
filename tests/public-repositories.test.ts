import { expect, test } from "bun:test";
import type { ArtifactsRepoCapability } from "../src/artifacts/cloudflare.js";
import { readPublicRepository, type PublicRepositoryGrant } from "../src/server/public-repositories.js";

const head = "a".repeat(40);
const parent = "b".repeat(40);
const hidden = "c".repeat(40);
const tree = "d".repeat(40);
const grant: PublicRepositoryGrant = { visibility: "public", confirmedByOwner: true, acceptedCommit: head };
function fixture() {
  const accesses: string[] = [];
  const repo = {
    async log(opts: { ref?: string; offset?: number; limit?: number }) {
      accesses.push(`log:${opts.ref}`);
      expect(opts.ref).toBe(head);
      return [head, parent].slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 30)).map((hash) => ({ hash, treeHash: tree, message: "Accepted change", author: { name: "Contributor", email: "private@example.com" }, parents: hash === head ? [parent] : [], committedAt: 1 }));
    },
    async readTree() { accesses.push("tree"); return [{ name: "README.md", type: "blob", hash: hidden, mode: "100644" }]; },
    async readBlob() { accesses.push("blob"); return new Blob(["Accepted source"]); },
  };
  return { repo: repo as unknown as ArtifactsRepoCapability, accesses };
}
test("private and unconfirmed repositories fail closed before Artifacts reads", async () => {
  const { repo, accesses } = fixture();
  await expect(readPublicRepository(repo, null, { kind: "history" })).rejects.toThrow("Repository not found");
  await expect(readPublicRepository(repo, { ...grant, confirmedByOwner: false } as unknown as PublicRepositoryGrant, { kind: "history" })).rejects.toThrow();
  expect(accesses).toEqual([]);
});
test("public history omits author email and never queries mutable refs", async () => {
  const { repo } = fixture();
  const result = await readPublicRepository(repo, grant, { kind: "history" });
  expect(JSON.stringify(result)).not.toContain("private@example.com");
  expect(JSON.stringify(result)).toContain("Contributor");
});
test("files and diffs use accepted ancestry only", async () => {
  const { repo, accesses } = fixture();
  expect(await readPublicRepository(repo, grant, { kind: "file", commit: parent, path: "README.md" })).toMatchObject({ kind: "file", commit: parent, file: { content: "Accepted source" } });
  expect(await readPublicRepository(repo, grant, { kind: "diff", from: parent, to: head })).toMatchObject({ kind: "diff", changes: [] });
  accesses.length = 0;
  await expect(readPublicRepository(repo, grant, { kind: "file", commit: hidden, path: "README.md" })).rejects.toThrow("accepted-history");
  expect(accesses).not.toContain("blob");
  expect(accesses).not.toContain("tree");
});
test("hidden refs, traversal and unbounded pagination are rejected", async () => {
  const { repo, accesses } = fixture();
  await expect(readPublicRepository(repo, grant, { kind: "directory", commit: "refs/heads/candidate" })).rejects.toThrow("immutable");
  await expect(readPublicRepository(repo, grant, { kind: "file", path: "../token" })).rejects.toThrow("path");
  await expect(readPublicRepository(repo, grant, { kind: "history", limit: 1000 })).rejects.toThrow("pagination");
  expect(accesses).toEqual([]);
});
