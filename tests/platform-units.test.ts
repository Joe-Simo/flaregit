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
  test("a missing side makes everything added", async () => {
    const out = await diffTrees(repo, undefined, "dB");
    expect(out.every((c) => c.status === "added")).toBe(true);
  });
});
