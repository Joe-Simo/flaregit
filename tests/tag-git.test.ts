import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeTag, type TagCreationIdentity } from "../src/server/tag-git";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "flaregit-tag-native-")), remote = join(directory, "canonical.git"), work = join(directory, "delivery.git");
  const env = { ...process.env, GIT_AUTHOR_NAME: "Synthetic owner", GIT_AUTHOR_EMAIL: "synthetic@localhost", GIT_COMMITTER_NAME: "Synthetic owner", GIT_COMMITTER_EMAIL: "synthetic@localhost", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  const native = async (args: string[], input?: string) => {
    const child = Bun.spawn(args, { env, stdin: input === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
    if (input !== undefined) { if (!child.stdin) throw new Error("Missing native input"); child.stdin.write(input); child.stdin.end(); }
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exit !== 0) throw new Error(stderr); return stdout.trim();
  };
  await native(["git", "init", "--bare", remote]);
  const git = (args: string[], input?: string) => native(["git", "--git-dir", remote, ...args], input);
  const tree = await git(["mktree"], ""), commit = await git(["commit-tree", tree, "-m", "Synthetic accepted history"]);
  await git(["update-ref", "refs/heads/main", commit]);
  const identity: TagCreationIdentity = { operationId: crypto.randomUUID(), projectId: "p123456789abc", incarnation: crypto.randomUUID(), canonicalRepoName: "synthetic-owned", actorId: "synthetic-owner", accountKey: "synthetic-account", tag: "v1.0.0", sourceCommit: commit, sourceTree: tree, acceptedCommit: commit };
  const fixtureRemote = `https://${"a".repeat(32)}.artifacts.cloudflare.net/owned.git`;
  const commands: string[] = [], fences: string[] = [];
  const executor = { beforeCommand: async (phase: "before" | "after") => { fences.push(phase); }, exec: async (command: string, auth?: Record<string, string>) => {
    commands.push(command); expect(command).not.toContain("synthetic_token"); expect(auth?.GIT_CONFIG_VALUE_0).toBe("Authorization: Bearer synthetic_token");
    const child = Bun.spawn(["sh", "-c", command.replaceAll(fixtureRemote, remote)], { env, stdout: "pipe", stderr: "pipe" });
    const [stdout, _stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { success: exit === 0, stdout };
  } };
  let marked = 0;
  const options = { identity, remote: fixtureRemote, token: "synthetic_token", directory: work, dispatch: "prepared" as "prepared" | "unknown", nativeOwnership:{attemptId:crypto.randomUUID(),nativeId:crypto.randomUUID()},markDispatch: async () => { marked++; return true; } };
  return { directory, remote, git, identity, commands, fences, executor, options, marks: () => marked, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("real native lightweight tag create-only CAS confirms exact accepted commit/tree without moving history", async () => {
  const f = await fixture();
  try {
    const result = await createNativeTag(f.executor, f.options);
    expect(result).toEqual({ status: "confirmed", observation: { object: f.identity.sourceCommit, commit: f.identity.sourceCommit, tree: f.identity.sourceTree, type: "commit" } });
    expect(await f.git(["rev-parse", "refs/heads/main"])).toBe(f.identity.acceptedCommit);
    expect(await f.git(["rev-parse", "refs/tags/v1.0.0"])).toBe(f.identity.sourceCommit);
    expect(f.marks()).toBe(1); expect(f.commands.find(command => command.includes(" push "))).toContain("refs/tags/v1.0.0:");
    expect(f.fences.length).toBe(f.commands.length * 2);
  } finally { await f.cleanup(); }
});

test("existing exact tag refuses a new operation and lost-ack reconciliation never pushes again", async () => {
  const f = await fixture();
  try {
    await f.git(["update-ref", "refs/tags/v1.0.0", f.identity.sourceCommit]);
    expect((await createNativeTag(f.executor, f.options)).status).toBe("existing");
    expect((await createNativeTag(f.executor, { ...f.options, dispatch: "unknown" })).status).toBe("confirmed");
    expect(f.commands.some(command => command.includes(" push "))).toBe(false); expect(f.marks()).toBe(0);
  } finally { await f.cleanup(); }
});

test("uncertain absent tag remains unknown without blind re-dispatch", async () => {
  const f = await fixture();
  try {
    expect(await createNativeTag(f.executor, { ...f.options, dispatch: "unknown" })).toEqual({ status: "unknown" });
    expect(f.commands.length).toBe(1); expect(f.commands.some(command => command.includes("fetch") || command.includes("push"))).toBe(false);
  } finally { await f.cleanup(); }
});

test("annotated tag object collision is refused even when it peels to the approved commit", async () => {
  const f = await fixture();
  try {
    const annotated = await f.git(["mktag"], `object ${f.identity.sourceCommit}\ntype commit\ntag v1.0.0\ntagger Synthetic Owner <synthetic@localhost> 1791072000 +0000\n\nDifferent consequential annotation\n`);
    await f.git(["update-ref", "refs/tags/v1.0.0", annotated]);
    const result = await createNativeTag(f.executor, { ...f.options, dispatch: "unknown" });
    expect(result).toEqual({ status: "different", observation: { object: annotated, commit: f.identity.sourceCommit, tree: f.identity.sourceTree, type: "tag" } });
    expect(await f.git(["rev-parse", "refs/tags/v1.0.0"])).toBe(annotated); expect(f.commands.some(command => command.includes(" push "))).toBe(false);
  } finally { await f.cleanup(); }
});

test("unaccepted source and unsafe tag input fail before native commands", async () => {
  const f = await fixture();
  try {
    await expect(createNativeTag(f.executor, { ...f.options, identity: { ...f.identity, sourceCommit: "b".repeat(40) } })).rejects.toThrow("Exact accepted commit required");
    await expect(createNativeTag(f.executor, { ...f.options, identity: { ...f.identity, tag: "refs/heads/main" } })).rejects.toThrow();
    expect(f.commands.length).toBe(0);
  } finally { await f.cleanup(); }
});

test("lost push acknowledgement is confirmed only by exact raw-object readback", async () => {
  const f = await fixture();
  try {
    const executor = { ...f.executor, exec: async (command: string, env?: Record<string, string>) => {
      const result = await f.executor.exec(command, env);
      return command.includes(" push ") ? { success: false, stdout: "" } : result;
    } };
    expect((await createNativeTag(executor, f.options)).status).toBe("confirmed");
    expect(f.commands.filter(command => command.includes(" push ")).length).toBe(1);
    expect((await createNativeTag(executor, { ...f.options, dispatch: "unknown" })).status).toBe("confirmed");
    expect(f.commands.filter(command => command.includes(" push ")).length).toBe(1);
  } finally { await f.cleanup(); }
});

test('lost native dispatch ownership refuses the actual push even with a stale prepared snapshot',async()=>{const f=await fixture();try{const result=await createNativeTag(f.executor,{...f.options,markDispatch:async(ownership)=>{expect(ownership).toEqual(f.options.nativeOwnership);return false;}});expect(result.status).toBe('unknown');expect(f.commands.some(command=>command.includes(' push '))).toBe(false);expect(await f.git(['for-each-ref','--format=%(refname)','refs/tags/'])).toBe('');}finally{await f.cleanup();}});
