import { describe, expect, test } from "bun:test";
import { settingsFor } from "../src/core/command-policy.js";
import { diffTrees } from "../src/server/browse.js";
import { validateWebhookUrl } from "../src/server/webhooks.js";

describe("validateWebhookUrl", () => {
  test("accepts public https hostnames", () => {
    expect(validateWebhookUrl("https://hooks.example.com/x").hostname).toBe("hooks.example.com");
  });
  test.each([
    "http://example.com/x",
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "https://user:pw@example.com/x",
    "https://intranet/x",
    "https://svc.internal/x",
    "https://svc.internal./x",
    "https://localhost./x",
    "https://svc.local./x",
    "not a url",
  ])("rejects %s", (url) => {
    expect(() => validateWebhookUrl(url)).toThrow();
  });
});

describe("settingsFor", () => {
  test("demo policy confines contributors to src/ and protects verifier files", () => {
    const s = settingsFor(undefined);
    expect(s.fixture).toBe("ticket-booking");
    expect(s.allowedScope).toEqual(["src/"]);
    expect(s.protectedPaths).toContain("tests/");
  });
  test("command policy carries the customer check and defaults scope to everything", () => {
    const s = settingsFor({ kind: "command", test: "bun test" });
    expect(s.fixture).toBe("custom");
    expect(s.checkCommand).toBe("bun test");
    expect(s.allowedScope).toEqual(["*"]);
    expect(s.protectedPaths.length).toBeGreaterThan(0);
  });
});

type Entry = { name: string; mode: string; hash: string; type: "blob" | "tree" };
const fakeRepo = (trees: Record<string, Entry[]>) => ({ readTree: async (h: string) => trees[h] ?? [] }) as unknown as Parameters<typeof diffTrees>[0];
const blob = (name: string, hash: string): Entry => ({ name, mode: "100644", hash, type: "blob" });
const tree = (name: string, hash: string): Entry => ({ name, mode: "040000", hash, type: "tree" });

describe("diffTrees", () => {
  const repo = fakeRepo({
    A: [blob("keep", "k"), blob("gone", "g"), blob("edit", "e1"), tree("dir", "dA")],
    B: [blob("keep", "k"), blob("edit", "e2"), blob("new", "n"), tree("dir", "dB")],
    dA: [blob("x", "x1"), blob("same", "s")],
    dB: [blob("x", "x2"), blob("same", "s"), blob("y", "y")],
  });
  test("reports added, modified and deleted files, recursing only into changed subtrees", async () => {
    const out = await diffTrees(repo, "A", "B");
    expect(out.map((c) => `${c.status}:${c.path}`)).toEqual(["modified:dir/x", "added:dir/y", "modified:edit", "deleted:gone", "added:new"]);
  });
  test("identical trees produce no changes", async () => {
    expect(await diffTrees(repo, "A", "A")).toEqual([]);
  });
  test("identical roots require no provider reads", async () => {
    let reads = 0;
    const unchanged = { readTree: async () => { reads++; throw new Error("Unnecessary provider read"); } } as unknown as Parameters<typeof diffTrees>[0];
    expect(await diffTrees(unchanged, "same", "same")).toEqual([]);
    expect(reads).toBe(0);
  });
  test("deep tree comparison preserves complete paths and type-change ordering", async () => {
    const deep = { readTree: async (hash: string) => {
      const [side, value] = hash.split(":"); const depth = Number(value);
      return depth < 1000 ? [tree("d", `${side}:${depth + 1}`)] : [blob("leaf", side === "a" ? "old" : "new")];
    } } as unknown as Parameters<typeof diffTrees>[0];
    expect(await diffTrees(deep, "a:0", "b:0")).toEqual([{ path: `${"d/".repeat(1000)}leaf`, status: "modified", aHash: "old", bHash: "new", mode: "100644" }]);
    const replacement = fakeRepo({ old: [blob("entry", "old-blob")], newer: [tree("entry", "child")], child: [blob("file", "new-blob")] });
    expect((await diffTrees(replacement, "old", "newer")).map(change => `${change.status}:${change.path}`)).toEqual(["added:entry/file", "deleted:entry"]);
  });
  test("oversized path output fails explicitly before it can become a complete diff", async () => {
    const largePaths = fakeRepo({ newer: [blob("x", "new")] });
    await expect(diffTrees(largePaths, undefined, "newer", "p".repeat(16 * 1024 * 1024))).rejects.toMatchObject({ status: 413, reason: "metadata_capacity" });
  });
  test("a missing side makes everything added", async () => {
    const out = await diffTrees(repo, undefined, "dB");
    expect(out.every((c) => c.status === "added")).toBe(true);
  });
  test("an unavailable referenced tree is a failure, not an empty diff", async () => {
    const missing = { readTree: async () => null } as unknown as Parameters<typeof diffTrees>[0];
    await expect(diffTrees(missing, "existing-reference", undefined)).rejects.toThrow(/Could not read a repository tree/);
    await expect(diffTrees(missing, undefined, "existing-reference")).rejects.toThrow(/Could not read a repository tree/);
  });
  test("5,001 changed files fail rather than silently recording partial coordination evidence", async () => {
    const large = fakeRepo({ tip: Array.from({ length: 5001 }, (_, index) => blob(`file-${index}`, `hash-${index}`)) });
    await expect(diffTrees(large, undefined, "tip")).rejects.toThrow(/5,000-file inspection limit/);
  });
});
