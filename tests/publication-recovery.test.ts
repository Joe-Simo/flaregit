import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { publicationInHistory } from "../src/server/publication.js";
import { gitOrThrow, PLATFORM_IDENTITY } from "../src/core/pipeline/git.js";

test("production publication recovery recognizes landed ancestors after canonical advances", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publication-recovery-"));
  try {
    const canonical = path.join(root, "canonical"), reader = path.join(root, "reader");
    fs.mkdirSync(canonical); fs.mkdirSync(reader);
    gitOrThrow(canonical, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(canonical, "file"), "base");
    gitOrThrow(canonical, ["add", "."]); gitOrThrow(canonical, [...PLATFORM_IDENTITY, "commit", "-m", "base"]);
    const base = gitOrThrow(canonical, ["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(canonical, "file"), "landed");
    gitOrThrow(canonical, ["add", "."]); gitOrThrow(canonical, [...PLATFORM_IDENTITY, "commit", "-m", "landed"]);
    const landed = gitOrThrow(canonical, ["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(canonical, "file"), "later");
    gitOrThrow(canonical, ["add", "."]); gitOrThrow(canonical, [...PLATFORM_IDENTITY, "commit", "-m", "later"]);
    const advanced = gitOrThrow(canonical, ["rev-parse", "HEAD"]);
    gitOrThrow(reader, ["init"]);
    const exec = async (command: string) => { const exitCode = spawnSync("sh", ["-c", command], { stdio: "pipe" }).status ?? -1; return { success: exitCode === 0, exitCode }; };
    expect(await publicationInHistory(exec, reader, canonical, "", "main", landed)).toBe(true);
    expect(await publicationInHistory(exec, reader, canonical, "", "main", base)).toBe(true);
    const tree = gitOrThrow(reader, ["rev-parse", "refs/flaregit/recovery-head^{tree}"]);
    const unrelated = gitOrThrow(reader, [...PLATFORM_IDENTITY, "commit-tree", tree, "-m", "unrelated root"]);
    expect(await publicationInHistory(exec, reader, canonical, "", "main", unrelated)).toBe(false);
    await expect(publicationInHistory(exec, reader, canonical, "", "main", "f".repeat(40))).rejects.toThrow("remains pending");
    const blob = gitOrThrow(canonical, ["rev-parse", "HEAD:file"]);
    await expect(publicationInHistory(exec, reader, canonical, "", "main", blob)).rejects.toThrow("remains pending");
    expect(gitOrThrow(canonical, ["rev-parse", "HEAD"])).toBe(advanced);
    await expect(publicationInHistory(exec, reader, path.join(root, "missing"), "", "main", landed)).rejects.toThrow("remains pending");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("ancestry command execution failures keep publication pending", async () => {
  const exec = async (command: string) => command.includes("merge-base") ? { success: false, exitCode: 126 } : { success: true, exitCode: 0 };
  await expect(publicationInHistory(exec, "/workspace", "https://example.com/repo", "", "main", "a".repeat(40))).rejects.toThrow("inspection failed");
});
