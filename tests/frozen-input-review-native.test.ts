import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitOrThrow } from "../src/core/pipeline/git.js";

// Native object-transfer evidence, not an Artifacts runtime or provider test.
for (const landing of ["merge", "squash", "rebase"] as const) {
  test(`candidate-only ${landing} transfer determines frozen input review reachability`, async () => {
    const root = await mkdtemp(join(tmpdir(), "flaregit-frozen-input-proof-"));
    const seed = join(root, "seed"), fork = join(root, "fork.git"), work = join(root, "work");
    const canonical = join(root, "canonical.git");
    const git = (dir: string, args: string[]) => gitOrThrow(dir, args);
    const contains = (dir: string, sha: string) => Bun.spawnSync(["git", "-C", dir, "cat-file", "-e", `${sha}^{commit}`], { stdout: "pipe", stderr: "pipe" }).exitCode === 0;
    try {
      await mkdir(seed);
      git(seed, ["init", "--initial-branch=main"]);
      git(seed, ["config", "user.name", "Synthetic contributor"]);
      git(seed, ["config", "user.email", "fixture@localhost"]);
      await Bun.write(join(seed, "base.txt"), "accepted base\n");
      git(seed, ["add", "."]); git(seed, ["commit", "-m", "Accepted base"]);
      const base = git(seed, ["rev-parse", "HEAD"]);
      git(root, ["init", "--bare", canonical]);
      git(seed, ["push", canonical, `${base}:refs/heads/main`]);
      git(root, ["clone", "--bare", seed, fork]);
      await Bun.write(join(seed, "feature.txt"), "frozen contribution\n");
      git(seed, ["add", "."]); git(seed, ["commit", "-m", "Frozen contribution"]);
      const input = git(seed, ["rev-parse", "HEAD"]);
      git(seed, ["push", fork, `${input}:refs/heads/task`]);
      git(root, ["clone", canonical, work]);
      git(work, ["config", "user.name", "Synthetic integrator"]);
      git(work, ["config", "user.email", "integration@localhost"]);
      git(work, ["checkout", "--detach", base]);
      git(work, ["fetch", "--quiet", fork, "+refs/heads/task:refs/flaregit/tasks/task"]);
      expect(git(work, ["rev-parse", "refs/flaregit/tasks/task"])).toBe(input);
      expect(contains(canonical, input)).toBe(false);
      git(work, ["merge", "--no-ff", "-m", "Candidate composition", "refs/flaregit/tasks/task"]);
      if (landing === "squash") {
        const tree = git(work, ["rev-parse", "HEAD^{tree}"]);
        const squashed = git(work, ["commit-tree", tree, "-p", base, "-m", "Squashed candidate"]);
        git(work, ["checkout", "--detach", squashed]);
      } else if (landing === "rebase") {
        // Force an actual rewritten parent rather than assuming rebase changes an unchanged base.
        git(work, ["checkout", "--detach", base]);
        await Bun.write(join(work, "advance.txt"), "accepted advance\n");
        git(work, ["add", "."]); git(work, ["commit", "-m", "Advanced accepted base"]);
        const advanced = git(work, ["rev-parse", "HEAD"]);
        git(work, ["checkout", "--detach", input]);
        git(work, ["rebase", "--onto", advanced, base]);
      }
      const candidate = git(work, ["rev-parse", "HEAD"]);
      git(work, ["push", "--quiet", canonical, `${candidate}:refs/flaregit/candidates/proof`]);
      expect(contains(canonical, candidate)).toBe(true);
      expect(contains(canonical, input)).toBe(landing === "merge");
      expect(contains(fork, input)).toBe(true);
      expect(git(canonical, ["for-each-ref", "--format=%(refname)"])).toBe("refs/flaregit/candidates/proof\nrefs/heads/main");
      expect(git(canonical, ["show", `${candidate}:feature.txt`])).toBe("frozen contribution");
      // Frozen input survives in its fork even after acceptance moves the canonical head.
      git(work, ["push", "--quiet", canonical, `${candidate}:refs/heads/main`]);
      expect(contains(canonical, input)).toBe(landing === "merge");
      expect(git(fork, ["rev-parse", "refs/heads/task"])).toBe(input);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
