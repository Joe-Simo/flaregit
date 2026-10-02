import { expect, test } from "bun:test";
import { CloudflareArtifactsClient, type ArtifactsBinding, type ArtifactsRepoCapability } from "../src/artifacts/cloudflare.js";

test("Workers adapter uses documented commit dates, metadata and RPC disposal", async () => {
  let disposed = 0;
  const info: ArtifactsRepoInfo = { id: "repo-id", name: "repo", description: null, defaultBranch: "main", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", lastPushAt: null, source: null, readOnly: false, remote: "https://example.artifacts.cloudflare.net/repo.git" };
  const created: ArtifactsCreateRepoResult = { id: info.id, name: info.name, description: null, defaultBranch: "main", remote: info.remote, token: "fixture-token" };
  const commit: ArtifactsCommitMetadata = { hash: "a".repeat(40), treeHash: "b".repeat(40), author: { name: "Contributor", email: "contributor@localhost" }, committer: { name: "Reviewer", email: "reviewer@localhost" }, message: "Contribution", parents: [], authoredAt: 1_700_000_000, committedAt: 1_700_000_001 };
  const capability: ArtifactsRepoCapability = {
    info: async () => info,
    createToken: async () => ({ id: "token-id", plaintext: "fixture-token", scope: "read", expiresAt: "2026-10-02T00:00:00Z" }),
    revokeToken: async () => true,
    listTokens: async () => ({ tokens: [], total: 0 }),
    fork: async () => created,
    log: async () => [commit],
    readCommit: async () => commit,
    readFile: async () => new Blob(["contents"], { type: "text/plain" }),
    readBlob: async () => null,
    readTree: async () => [],
    [Symbol.dispose]: () => { disposed++; },
  };
  const { remote: _remote, ...listed } = info;
  const binding: ArtifactsBinding = { create: async () => created, get: async () => capability, import: async () => created, list: async () => ({ repos: [listed], total: 1, cursor: "next" }), delete: async () => true };
  const client = new CloudflareArtifactsClient(binding);
  const page = await client.list();
  expect(page.repos[0]?.remote).toBe(info.remote);
  expect(page.cursor).toBe("next");
  expect(disposed).toBe(1);
  using repo = await client.get("repo");
  expect((await repo.log())[0]?.timestamp).toBe("2023-11-14T22:13:20.000Z");
  expect((await repo.readCommit(commit.hash))?.author).toBe("Contributor");
  expect(await (await repo.readFile({ ref: "main", path: "file.txt" }))?.text()).toBe("contents");
  expect((await client.create("repo")).id).toBe("repo-id");
});
