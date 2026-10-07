import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureGitMigrationInventory, compareGitMigrationInventories, type GitMigrationInventoryExecutor } from "../src/server/git-migration-inventory";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "flaregit-git-migration-")), source = join(directory, "source.git"), destination = join(directory, "destination.git");
  const environment = { ...process.env, GIT_AUTHOR_NAME: "Synthetic owner", GIT_AUTHOR_EMAIL: "synthetic@localhost", GIT_COMMITTER_NAME: "Synthetic owner", GIT_COMMITTER_EMAIL: "synthetic@localhost", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  const native = async (args: string[], input?: string) => {
    const child = Bun.spawn(args, { env: environment, stdin: input === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
    if (input !== undefined) { if (!child.stdin) throw new Error("Missing Git input"); child.stdin.write(input); child.stdin.end(); }
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); if (exit !== 0) throw new Error(stderr); return stdout.trim();
  };
  await native(["git", "init", "--bare", source]);
  const git = (args: string[], input?: string) => native(["git", "--git-dir", source, ...args], input);
  const blob = await git(["hash-object", "-w", "--stdin"], "Preserved Git content\n");
  const tree = await git(["mktree"], `100644 blob ${blob}\tfile.txt\n`);
  const commit = await git(["commit-tree", tree, "-m", "Synthetic accepted source"]);
  await git(["update-ref", "refs/heads/main", commit]); await git(["update-ref", "refs/heads/release", commit]);
  const annotated = await git(["mktag"], `object ${commit}\ntype commit\ntag v1\ntagger Synthetic <synthetic@localhost> 1791072000 +0000\n\nOriginal annotation\n`);
  const blobTag = await git(["mktag"], `object ${blob}\ntype blob\ntag asset\ntagger Synthetic <synthetic@localhost> 1791072000 +0000\n\nNoncommit asset tag\n`);
  await git(["update-ref", "refs/tags/v1", annotated]); await git(["update-ref", "refs/tags/asset", blobTag]); await git(["update-ref", "refs/tags/tree", tree]);
  const commands: string[] = [];
  const executor: GitMigrationInventoryExecutor = { beforeCommand: async () => {}, exec: async (command, env) => {
    commands.push(command); const child = Bun.spawn(["sh", "-c", command], { env: { ...environment, ...env }, stdout: "pipe", stderr: "pipe" });
    const [stdout, _stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { success: exit === 0, stdout };
  } };
  return { directory, source, destination, blob, tree, commit, annotated, blobTag, git, native, commands, executor, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("native inventory preserves all captured heads/tags including annotated and noncommit Git objects", async () => {
  const f = await fixture();
  try {
    const source = await captureGitMigrationInventory(f.executor, f.source);
    expect(source.status).toBe("complete"); expect(source.refs.length).toBe(5);
    expect(source.refs.find(ref => ref.ref === "refs/tags/v1")).toMatchObject({ object: f.annotated, type: "tag", peeledObject: f.commit, peeledType: "commit" });
    expect(source.refs.find(ref => ref.ref === "refs/tags/asset")).toMatchObject({ object: f.blobTag, peeledObject: f.blob, peeledType: "blob" });
    expect(source.refs.find(ref => ref.ref === "refs/tags/tree")).toMatchObject({ object: f.tree, peeledObject: f.tree, peeledType: "tree" });
    expect(source.objects).toEqual({ [f.annotated]: "tag", [f.blobTag]: "tag", [f.commit]: "commit", [f.tree]: "tree", [f.blob]: "blob" });
    expect(source.providerVerified).toBe(false); expect(source.excluded).toContain("lfs-object-bytes");
    expect(f.commands.some(command => /\bpush\b|\bfetch\b|\bcheckout\b|--mirror|--all/.test(command))).toBe(false);
    await f.native(["git", "clone", "--quiet", "--bare", f.source, f.destination]);
    const destination = await captureGitMigrationInventory(f.executor, f.destination);
    expect(compareGitMigrationInventories(source, destination).status).toBe("matched");
  } finally { await f.cleanup(); }
});

test("a selected-branch-only copy cannot claim complete source migration", async () => {
  const f = await fixture();
  try {
    await f.native(["git", "clone", "--quiet", "--bare", "--single-branch", "--branch", "main", "--no-tags", f.source, f.destination]);
    const source = await captureGitMigrationInventory(f.executor, f.source), destination = await captureGitMigrationInventory(f.executor, f.destination);
    const result = compareGitMigrationInventories(source, destination);
    expect(result.status).toBe("different"); expect(result.missingRefs).toContain("refs/heads/release"); expect(result.missingRefs).toContain("refs/tags/v1"); expect(result.missingObjects).toContain(f.annotated);
  } finally { await f.cleanup(); }
});

test("bounded or omitted native metadata remains explicitly incomplete", async () => {
  const f = await fixture();
  try {
    expect((await captureGitMigrationInventory(f.executor, f.source, { maxRefs: 1 })).reason).toBe("ref_capacity");
    const limited = await captureGitMigrationInventory(f.executor, f.source, { maxObjects: 1 }); expect(limited.status).toBe("incomplete"); expect(limited.reason).toBe("object_capacity");
    const omitted = await captureGitMigrationInventory({ beforeCommand: async () => {}, exec: async () => ({ success: true, stdout: "" }) }, f.source); expect(omitted.status).toBe("incomplete"); expect(omitted.reason).toBe("metadata_unavailable");
    expect(compareGitMigrationInventories(limited, await captureGitMigrationInventory(f.executor, f.source)).status).toBe("incomplete");
  } finally { await f.cleanup(); }
});

test("changed annotated tag metadata is a different ref even with unchanged peeled commit", async () => {
  const f = await fixture();
  try {
    const before = await captureGitMigrationInventory(f.executor, f.source);
    const altered = await f.git(["mktag"], `object ${f.commit}\ntype commit\ntag v1\ntagger Synthetic <synthetic@localhost> 1791072000 +0000\n\nConsequential changed annotation\n`);
    await f.git(["update-ref", "refs/tags/v1", altered]);
    const after = await captureGitMigrationInventory(f.executor, f.source), comparison = compareGitMigrationInventories(before, after);
    expect(comparison.status).toBe("different"); expect(comparison.differentRefs).toContain("refs/tags/v1");
  } finally { await f.cleanup(); }
});

test("nested tag objects remain in closure and destination additions are reported without deletion", async () => {
  const f = await fixture();
  try {
    const before = await captureGitMigrationInventory(f.executor, f.source);
    const nested = await f.git(["mktag"], `object ${f.annotated}\ntype tag\ntag nested\ntagger Synthetic <synthetic@localhost> 1791072000 +0000\n\nNested preserved annotation\n`);
    await f.git(["update-ref", "refs/tags/nested", nested]);
    const after = await captureGitMigrationInventory(f.executor, f.source);
    expect(after.status).toBe("complete"); expect(after.refs.find(ref => ref.ref === "refs/tags/nested")).toMatchObject({ object: nested, peeledObject: f.commit, peeledType: "commit" });
    expect(after.objects[nested]).toBe("tag"); expect(after.objects[f.annotated]).toBe("tag");
    const result = compareGitMigrationInventories(before, after);
    expect(result.status).toBe("matched"); expect(result.comparisonScope).toBe("source-ref-and-reachable-object-preservation"); expect(result.additionalRefs).toEqual(["refs/tags/nested"]); expect(result.additionalObjects).toBe(1);
  } finally { await f.cleanup(); }
});

test("owner or budget fences retain their failure identity rather than producing publishable metadata", async () => {
  const failure = new Error("Owner permission changed"); let calls = 0;
  try {
    await captureGitMigrationInventory({ beforeCommand: async () => { throw failure; }, exec: async () => { calls++; return { success: true, stdout: "" }; } }, "/tmp/owned-git-fixture");
    throw new Error("Expected authority refusal");
  } catch (error) { expect(error).toBe(failure); }
  expect(calls).toBe(0);
});

test("commit history reports excluded gitlinks even when the current head removed the submodule", async () => {
  const f = await fixture();
  try {
    const external = "d".repeat(40);
    const linkedTree = await f.git(["mktree"], `100644 blob ${f.blob}\tfile.txt\n160000 commit ${external}\tvendor\n`);
    const linkedCommit = await f.git(["commit-tree", linkedTree, "-p", f.commit, "-m", "Synthetic submodule pointer"]);
    const head = await f.git(["commit-tree", f.tree, "-p", linkedCommit, "-m", "Synthetic removal"]);
    await f.git(["update-ref", "refs/heads/main", head]);
    const inventory = await captureGitMigrationInventory(f.executor, f.source);
    expect(inventory.status).toBe("complete");
    expect(inventory.observedExternalGitlinks).toEqual([external]);
    expect(inventory.objects[external]).toBeUndefined();
    expect(inventory.excluded).toContain("submodule-repositories");
  } finally { await f.cleanup(); }
});
