import {expect, test} from "bun:test";
import {blame, fileHistory, lineUrl, type Commit} from "../src/core/blame";

const sha = (n: number): string => n.toString(16).padStart(40, "0");
const when = (n: number): string => new Date(n * 1000).toISOString();

/** Commit `n` has sha `sha(n)`. `parent` is the parent's number, or null for the root. */
function commit(n: number, parent: number | null, files: Record<string, string>, author = "alice"): Commit {
  return {sha: sha(n), parent: parent === null ? null : sha(parent), author, timestamp: when(n), files};
}

test("a line deleted and re-added is blamed on the commit that re-added it", () => {
  const history = [
    commit(1, null, {"a.txt": "one\ntwo\nthree\n"}),
    commit(2, 1, {"a.txt": "one\nthree\n"}, "bob"),
    commit(3, 2, {"a.txt": "one\ntwo\nthree\n"}, "carol"),
  ];
  expect(blame(history, "a.txt", sha(3))).toEqual({
    ok: true,
    lines: [
      {line: 1, text: "one", sha: sha(1), author: "alice", timestamp: when(1)},
      {line: 2, text: "two", sha: sha(3), author: "carol", timestamp: when(3)},
      {line: 3, text: "three", sha: sha(1), author: "alice", timestamp: when(1)},
    ],
  });
  expect(blame(history, "a.txt", sha(2))).toEqual({
    ok: true,
    lines: [
      {line: 1, text: "one", sha: sha(1), author: "alice", timestamp: when(1)},
      {line: 2, text: "three", sha: sha(1), author: "alice", timestamp: when(1)},
    ],
  });
});

test("blame at an earlier commit ignores later changes", () => {
  const history = [
    commit(1, null, {"a.txt": "a\n"}),
    commit(2, 1, {"a.txt": "a\nb\n"}, "bob"),
    commit(3, 2, {"a.txt": "a\nb\nc\n"}, "carol"),
  ];
  expect(blame(history, "a.txt", sha(2))).toEqual({
    ok: true,
    lines: [
      {line: 1, text: "a", sha: sha(1), author: "alice", timestamp: when(1)},
      {line: 2, text: "b", sha: sha(2), author: "bob", timestamp: when(2)},
    ],
  });
});

test("on a rename-free path, commits that touch only other files do not count", () => {
  const c1 = commit(1, null, {"src/a.ts": "const a = 1;\n", "README.md": "v1\n"});
  const c2 = commit(2, 1, {"src/a.ts": "const a = 1;\nconst b = 2;\n", "README.md": "v1\n"}, "bob");
  const c3 = commit(3, 2, {"src/a.ts": "const a = 1;\nconst b = 2;\n", "README.md": "v2\n"}, "carol");
  const c4 = commit(4, 3, {"src/a.ts": "const a = 1;\nconst b = 3;\n", "README.md": "v2\n"}, "dave");
  const history = [c1, c2, c3, c4];
  expect(blame(history, "src/a.ts", sha(4))).toEqual({
    ok: true,
    lines: [
      {line: 1, text: "const a = 1;", sha: sha(1), author: "alice", timestamp: when(1)},
      {line: 2, text: "const b = 3;", sha: sha(4), author: "dave", timestamp: when(4)},
    ],
  });
  expect(fileHistory(history, "src/a.ts")).toEqual({ok: true, commits: [c4, c2, c1]});
});

test("inserting lines above shifts later lines without changing their origin", () => {
  const history = [commit(1, null, {"a.txt": "a\nb\n"}), commit(2, 1, {"a.txt": "x\na\nb\n"}, "bob")];
  expect(blame(history, "a.txt", sha(2))).toEqual({
    ok: true,
    lines: [
      {line: 1, text: "x", sha: sha(2), author: "bob", timestamp: when(2)},
      {line: 2, text: "a", sha: sha(1), author: "alice", timestamp: when(1)},
      {line: 3, text: "b", sha: sha(1), author: "alice", timestamp: when(1)},
    ],
  });
});

test("a file created later is blamed on its creation commit", () => {
  const c1 = commit(1, null, {"other.txt": "z\n"});
  const c2 = commit(2, 1, {"other.txt": "z\n", "new.txt": "p\nq\n"}, "bob");
  const history = [c1, c2];
  expect(blame(history, "new.txt", sha(2))).toEqual({
    ok: true,
    lines: [
      {line: 1, text: "p", sha: sha(2), author: "bob", timestamp: when(2)},
      {line: 2, text: "q", sha: sha(2), author: "bob", timestamp: when(2)},
    ],
  });
  expect(fileHistory(history, "new.txt")).toEqual({ok: true, commits: [c2]});
});

test("a file absent at the blamed commit and an unknown commit are clear errors", () => {
  const history = [commit(1, null, {"gone.txt": "x\n"}), commit(2, 1, {}, "bob")];
  expect(blame(history, "gone.txt", sha(2))).toEqual({ok: false, error: `gone.txt is absent at commit ${sha(2)}`});
  expect(blame(history, "gone.txt", sha(9))).toEqual({ok: false, error: `Commit ${sha(9)} is not in the history`});
});

test("file history includes deletions, skips unrelated commits and rejects a path that never existed", () => {
  const c1 = commit(1, null, {"a.txt": "x\n"});
  const c2 = commit(2, 1, {"a.txt": "x\n", "b.txt": "q\n"}, "bob");
  const c3 = commit(3, 2, {"a.txt": "y\n", "b.txt": "q\n"}, "carol");
  const c4 = commit(4, 3, {"b.txt": "q\n"}, "dave");
  const history = [c1, c2, c3, c4];
  expect(fileHistory(history, "a.txt")).toEqual({ok: true, commits: [c4, c3, c1]});
  expect(fileHistory(history, "missing.txt").ok).toBe(false);
});

test("a trailing newline does not add a line and an empty file has none", () => {
  expect(blame([commit(1, null, {"a.txt": "only\n"})], "a.txt", sha(1))).toEqual({
    ok: true,
    lines: [{line: 1, text: "only", sha: sha(1), author: "alice", timestamp: when(1)}],
  });
  expect(blame([commit(1, null, {"a.txt": ""})], "a.txt", sha(1))).toEqual({ok: true, lines: []});
});

test("a history that is not one linear chain of known commits is refused", () => {
  const missingParent = [commit(2, 1, {"a.txt": "x\n"})];
  const fork = [commit(1, null, {"a.txt": "x\n"}), commit(2, 1, {"a.txt": "x\n"}), commit(3, 1, {"a.txt": "y\n"})];
  expect(blame(missingParent, "a.txt", sha(2)).ok).toBe(false);
  expect(blame(fork, "a.txt", sha(2)).ok).toBe(false);
  expect(fileHistory(fork, "a.txt").ok).toBe(false);
});

test("histories over 1000 commits are refused", () => {
  const history = Array.from({length: 1001}, (_, index) => commit(index + 1, index === 0 ? null : index, {"a.txt": "x\n"}));
  expect(blame(history, "a.txt", sha(1001)).ok).toBe(false);
  expect(fileHistory(history, "a.txt").ok).toBe(false);
  expect(blame(history.slice(0, 1000), "a.txt", sha(1000)).ok).toBe(true);
});

test("files over 5000 lines are refused for blame", () => {
  const file = (count: number) => `${Array.from({length: count}, (_, index) => `line ${index}`).join("\n")}\n`;
  const atLimit = blame([commit(1, null, {"big.txt": file(5000)})], "big.txt", sha(1));
  if (!atLimit.ok) throw new Error(atLimit.error);
  expect(atLimit.lines).toHaveLength(5000);
  expect(blame([commit(1, null, {"big.txt": file(5001)})], "big.txt", sha(1)).ok).toBe(false);
});

test("permalinks validate the sha, path and line", () => {
  const base = "https://example.test/owner/repo";
  expect(lineUrl(base, sha(7), "src/core/blame.ts", 12)).toEqual({ok: true, url: `${base}/blob/${sha(7)}/src/core/blame.ts#L12`});
  expect(lineUrl(base, sha(7), "docs/my file.md", 3)).toEqual({ok: true, url: `${base}/blob/${sha(7)}/docs/my%20file.md#L3`});
  expect(lineUrl(base, "A".repeat(40), "a.ts", 1).ok).toBe(false);
  expect(lineUrl(base, "a".repeat(39), "a.ts", 1).ok).toBe(false);
  expect(lineUrl(base, sha(7), "../secret.ts", 1).ok).toBe(false);
  expect(lineUrl(base, sha(7), "src/../secret.ts", 1).ok).toBe(false);
  expect(lineUrl(base, sha(7), "/etc/passwd", 1).ok).toBe(false);
  expect(lineUrl(base, sha(7), "", 1).ok).toBe(false);
  expect(lineUrl(base, sha(7), "a.ts", 0).ok).toBe(false);
  expect(lineUrl(base, sha(7), "a.ts", 1.5).ok).toBe(false);
});
