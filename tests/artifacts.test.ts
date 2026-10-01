/// <reference types="bun" />
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { LocalGitArtifactsClient } from "../src/artifacts/local-git.js";

const TEST_DIR = path.resolve(process.cwd(), ".flaregit-storage", "test-artifacts");

describe("LocalGitArtifactsClient", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test("creates a bare repository and issues token", async () => {
    const client = new LocalGitArtifactsClient(TEST_DIR);
    const repo = await client.create("test-canonical", {
      description: "Canonical test repo",
      setDefaultBranch: "main",
    });

    expect(repo.name).toBe("test-canonical");
    expect(repo.defaultBranch).toBe("main");
    expect(repo.token).toBeDefined();
    expect(repo.token?.startsWith("art_v1_")).toBe(true);
    expect(fs.existsSync(repo.remote)).toBe(true);
  });

  test("forks a repository and tracks commits", async () => {
    const client = new LocalGitArtifactsClient(TEST_DIR);
    const canonical = await client.create("canonical", { setDefaultBranch: "main" });

    // Seed a commit into canonical
    const workDir = path.join(TEST_DIR, "work-seed");
    spawnSync("git", ["clone", canonical.remote, workDir]);
    fs.writeFileSync(path.join(workDir, "README.md"), "# Accord Project\n");
    spawnSync("git", ["-C", workDir, "add", "README.md"]);
    spawnSync("git", [
      "-C",
      workDir,
      "-c",
      "user.name=System",
      "-c",
      "user.email=system@accord.local",
      "commit",
      "-m",
      "Initial commit",
    ]);
    spawnSync("git", ["-C", workDir, "push", "origin", "main"]);

    // Fork canonical to task repo
    const handle = await client.get("canonical");
    const forkMeta = await handle.fork("task-123");

    expect(forkMeta.name).toBe("task-123");
    expect(fs.existsSync(forkMeta.remote)).toBe(true);

    // Verify file content via Artifacts handle
    const taskHandle = await client.get("task-123");
    const file = await taskHandle.readFile({ ref: "main", path: "README.md" });
    expect(file).not.toBeNull();
    const content = await file?.text();
    expect(content).toBe("# Accord Project\n");

    const history = await taskHandle.log({ ref: "main" });
    expect(history.length).toBe(1);
    expect(history[0]?.message).toBe("Initial commit");
  });
});
