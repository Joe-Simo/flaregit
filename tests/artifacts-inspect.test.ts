import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureGitInventory, inventoryAncestry } from "../src/cli/artifacts-inspect.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "inspect-git-")), source = join(root, "source");
  const git = async (...args: string[]) => {
    const child = Bun.spawn(["git", ...args], { env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@localhost", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@localhost", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" }, stdout: "pipe", stderr: "pipe" });
    const [output, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code) throw new Error(errors); return output.trim();
  };
  await git("init", "--initial-branch=main", source); await Bun.write(join(source, "file.txt"), "base\n");
  await git("-C", source, "add", "."); await git("-C", source, "commit", "-m", "base");
  const base = await git("-C", source, "rev-parse", "HEAD");
  await Bun.write(join(source, "file.txt"), "main advancement\n"); await git("-C", source, "commit", "-am", "main");
  const main = await git("-C", source, "rev-parse", "HEAD");
  await git("-C", source, "checkout", "--orphan", "isolated"); await Bun.write(join(source, "file.txt"), "custom ref only\n"); await git("-C", source, "commit", "-am", "isolated contribution");
  const custom = await git("-C", source, "rev-parse", "HEAD");
  await git("-C", source, "update-ref", "refs/notes/review", custom); await git("-C", source, "update-ref", "refs/flaregit/candidates/test", custom);
  await git("-C", source, "checkout", "main"); await git("-C", source, "branch", "-D", "isolated");
  return { root, source, git, base, main, custom, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("native mirror inventory includes advertised custom refs and their otherwise unreachable commits", async () => {
  const f = await fixture();
  try {
    const ordinary = join(f.root, "ordinary.git"), mirror = join(f.root, "mirror.git");
    await f.git("clone", "--bare", f.source, ordinary); await f.git("clone", "--mirror", f.source, mirror);
    expect((await captureGitInventory(ordinary)).refs["refs/notes/review"]).toBeUndefined();
    const inventory = await captureGitInventory(mirror);
    expect(inventory.refs["refs/notes/review"]).toBe(f.custom); expect(inventory.refs["refs/flaregit/candidates/test"]).toBe(f.custom);
    expect(inventory.commits[f.custom]).toBeDefined(); expect(inventory.shallow).toBe(false);
    expect(inventoryAncestry(inventory, f.custom, f.main)).toBe(false);
    expect(inventoryAncestry(inventory, f.main, f.base)).toBe(true);
  } finally { await f.cleanup(); }
});

test("missing main reports unknown rather than a false ancestry claim", async () => {
  const f = await fixture();
  try {
    const mirror = join(f.root, "no-main.git"); await f.git("clone", "--mirror", f.source, mirror);
    await f.git("--git-dir", mirror, "update-ref", "-d", "refs/heads/main");
    const inventory = await captureGitInventory(mirror);
    expect(inventory.refs["refs/heads/main"]).toBeUndefined();
    expect(inventoryAncestry(inventory, f.custom, inventory.refs["refs/heads/main"])).toBe("unknown");
  } finally { await f.cleanup(); }
});

test("shallow native history cannot establish a negative but still proves observed positive ancestry", async () => {
  const f = await fixture();
  try {
    const shallow = join(f.root, "shallow.git"); await f.git("clone", "--bare", "--depth=1", `file://${f.source}`, shallow);
    const inventory = await captureGitInventory(shallow);
    expect(inventory.shallow).toBe(true);
    expect(inventoryAncestry(inventory, f.main, f.base)).toBe("unknown");
    expect(inventoryAncestry(inventory, f.main, f.main)).toBe(true);
  } finally { await f.cleanup(); }
});
