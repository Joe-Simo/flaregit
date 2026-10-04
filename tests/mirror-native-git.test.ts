import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pushMirror, type Exec } from "../src/server/mirror";

/** Real local Git transport evidence, not a hosted GitHub delivery claim. */
test("native mirror retries exact accepted SHA, preserves divergent destination and canonical history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flaregit-mirror-native-"));
  const canonical = join(directory, "canonical.git"), destination = join(directory, "destination.git");
  const canonicalUrl = "https://artifacts.example/native-fixture.git", target = "https://github.com/synthetic/native-fixture.git";
  const canonicalToken = "synthetic_canonical_credential", githubToken = "synthetic_github_credential";
  const environment = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "Synthetic mirror", GIT_AUTHOR_EMAIL: "synthetic@localhost", GIT_COMMITTER_NAME: "Synthetic mirror", GIT_COMMITTER_EMAIL: "synthetic@localhost" };
  const run = async (args: string[], input?: string) => {
    const child = Bun.spawn(args, { env: environment, stdin: input === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" });
    if (input !== undefined) { if (!child.stdin) throw new Error("Missing native Git input"); child.stdin.write(input); child.stdin.end(); }
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { success: exitCode === 0, exitCode, stdout, stderr };
  };
  const git = async (repository: string, args: string[], input?: string) => {
    const result = await run(["git", "--git-dir", repository, ...args], input);
    if (!result.success) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  let failedTransport = false;
  const commands: string[] = [];
  const exec: Exec = async (command, auth) => {
    commands.push(command);
    expect(command).not.toContain(canonicalToken); expect(command).not.toContain(githubToken);
    // Only these two hard-coded fixture URLs are rewritten; no network access or credentials reach native Git.
    if (command.includes(" push ")) {
      expect(auth?.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${btoa(`x-access-token:${githubToken}`)}`);
      if (failedTransport) return { success: false, exitCode: 128, stdout: "", stderr: `Synthetic transport unavailable ${githubToken} ${btoa(`x-access-token:${canonicalToken}`)}` };
    }
    const localCommand = command.replaceAll(canonicalUrl, canonical).replaceAll(target, destination);
    return run(["sh", "-c", localCommand]);
  };
  try {
    expect((await run(["git", "init", "--bare", canonical])).success).toBe(true);
    expect((await run(["git", "init", "--bare", destination])).success).toBe(true);
    const tree = await git(canonical, ["mktree"], "");
    const accepted = await git(canonical, ["commit-tree", tree, "-m", "Synthetic accepted contribution"]);
    await git(canonical, ["update-ref", "refs/heads/main", accepted]);
    const input = { canonicalRemote: canonicalUrl, canonicalToken, target, githubToken, branch: "main", commit: accepted, workdir: join(directory, "delivery.git") };
    const deliver = () => pushMirror({ exec }, input);
    expect((await deliver()).status).toBe("ok");
    expect(await git(destination, ["rev-parse", "refs/heads/main"])).toBe(accepted);
    const reflogBefore = await git(destination, ["rev-list", "--all", "--count"]);
    expect((await deliver()).status).toBe("ok");
    expect(await git(destination, ["rev-list", "--all", "--count"])).toBe(reflogBefore);
    const nextAccepted = await git(canonical, ["commit-tree", tree, "-p", accepted, "-m", "Synthetic next accepted contribution"]);
    await git(canonical, ["update-ref", "refs/heads/main", nextAccepted]);
    input.commit = nextAccepted;
    failedTransport = true;
    const failed = await deliver();
    expect(failed.status).toBe("error"); expect(failed.detail).not.toContain(githubToken); expect(failed.detail).not.toContain(btoa(`x-access-token:${canonicalToken}`));
    expect(await git(destination, ["rev-parse", "refs/heads/main"])).toBe(accepted);
    failedTransport = false;
    expect((await deliver()).status).toBe("ok");
    expect(await git(destination, ["rev-parse", "refs/heads/main"])).toBe(nextAccepted);
    const divergent = await git(destination, ["commit-tree", tree, "-m", "Synthetic independently accepted destination history"]);
    await git(destination, ["update-ref", "refs/heads/main", divergent]);
    expect((await deliver()).status).toBe("diverged");
    expect(await git(destination, ["rev-parse", "refs/heads/main"])).toBe(divergent);
    expect(await git(canonical, ["rev-parse", "refs/heads/main"])).toBe(nextAccepted);
    expect(commands.filter(command => command.includes(" push ")).every(command => !/--force|\s\+/.test(command))).toBe(true);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 20_000);
