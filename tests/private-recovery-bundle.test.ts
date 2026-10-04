import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAcceptedBundle, validateRecoveryRemote, type BundleExecutor } from "../src/server/private-recovery-bundle";

const remote = `https://${"a".repeat(32)}.artifacts.cloudflare.net/repository.git`;
test("recovery remote rejects external hosts, credentials and URL ambiguity", () => {
  expect(() => validateRecoveryRemote(remote)).not.toThrow();
  for (const value of ["https://example.com/repo", remote + "?token=x", remote + "#x", remote.replace("https://", "http://"), remote.replace("https://", "https://user@"), remote.replace("/repository", ":443/repository")]) expect(() => validateRecoveryRemote(value)).toThrow();
});

test("native accepted bundle clones and fscks without private candidate objects", async () => {
  const root = await mkdtemp(join(tmpdir(), "recovery-fixture-"));
  const directory = `/tmp/flaregit-private-recovery-${crypto.randomUUID()}`;
  const unknownTreeDirectory = `/tmp/flaregit-private-recovery-${crypto.randomUUID()}`;
  const mismatchDirectory = `/tmp/flaregit-private-recovery-${crypto.randomUUID()}`;
  const contaminatedDirectory = `/tmp/flaregit-private-recovery-${crypto.randomUUID()}`;
  const branchDirectory = `/tmp/flaregit-private-recovery-${crypto.randomUUID()}`;
  const repo = join(root, "repo");
  let passed=false;
  const diagnostics:Array<{argv:string[];stdout:string;stderr:string;code:number}>=[];
  const native: BundleExecutor = { async exec(argv, options) {
    const proc = Bun.spawn(argv, { env: { ...process.env, ...options?.env }, stdout: "pipe", stderr: "pipe", timeout:Math.min(options?.timeoutMs??15_000,15_000) });
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    diagnostics.push({argv:[...argv],stdout,stderr,code});
    return { success: code === 0, stdout, stderr };
  } };
  const git = async (...argv: string[]) => {
    const result = await native.exec(["git", ...argv]);
    if (!result.success) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  try {
    await git("init", "-q", "-b", "main", repo);
    await git("-C", repo, "config", "user.email", "fixture@example.invalid");
    await git("-C", repo, "config", "user.name", "Fixture");
    await Bun.write(join(repo, "accepted.txt"), "accepted history\n");
    await git("-C", repo, "add", ".");
    await git("-C", repo, "commit", "-qm", "accepted");
    const commit = await git("-C", repo, "rev-parse", "HEAD");
    const tree = await git("-C", repo, "rev-parse", "HEAD^{tree}");
    await git("-C", repo, "checkout", "-qb", "private-candidate");
    await Bun.write(join(repo, "private.txt"), "private candidate secret\n");
    await git("-C", repo, "add", ".");
    await git("-C", repo, "commit", "-qm", "private");
    const privateBlob = await git("-C", repo, "rev-parse", "HEAD:private.txt");
    const executor: BundleExecutor = { async exec(argv, options) {
      // Local fixture transport replaces only the validated production origin.
      if (argv.includes("fetch")) {
        expect(argv).toContain("http.followRedirects=false");
        return native.exec(argv.map(value => value === remote ? repo : value === "protocol.https.allow=always" ? "protocol.file.allow=always" : value), options);
      }
      if (argv[0] === "stat") return { success: true, stdout: String(Bun.file(argv[3]!).size), stderr: "" };
      if (argv[0] === "sha256sum") return native.exec(["shasum", "-a", "256", argv[1]!], options);
      return native.exec(argv, options);
    } };
    await expect(createAcceptedBundle(executor, { remote, token: "fixture", commit, tree: "0".repeat(40), directory: mismatchDirectory })).rejects.toThrow("immutable receipt");
    const contaminated: BundleExecutor = { async exec(argv, options) {
      const result = await executor.exec(argv, options);
      if (result.success && argv.includes("unbundle")) {
        await git("--git-dir", `${contaminatedDirectory}/verify.git`, "fetch", "-q", repo, "private-candidate");
      }
      return result;
    } };
    await expect(createAcceptedBundle(contaminated, { remote, token: "fixture", commit, tree, directory: contaminatedDirectory })).rejects.toThrow("no download was published");
    const resolved = await createAcceptedBundle(executor, { remote, token: "fixture", commit, tree: null, directory: unknownTreeDirectory });
    expect(resolved.tree).toBe(tree);
    const importedClone=join(root,"imported-clone");
    await git("-c","init.defaultBranch=master","clone","-q",resolved.path,importedClone);
    await git("-C",importedClone,"fsck","--full");
    expect(await git("-C",importedClone,"rev-parse","HEAD")).toBe(commit);
    expect((await native.exec(["git","-C",importedClone,"cat-file","-e",privateBlob])).success).toBe(false);
    const receipt = await createAcceptedBundle(executor, { remote, token: "fixture", commit, tree, directory });
    expect(receipt.commit).toBe(commit);
    expect(receipt.tree).toBe(tree);
    expect((await git("bundle", "list-heads", receipt.path)).split("\n").sort()).toEqual([`${commit} HEAD`, `${commit} refs/heads/main`].sort());
    const clone = join(root, "clone");
    await git("-c", "init.defaultBranch=master", "clone", "-q", receipt.path, clone);
    await git("-C", clone, "fsck", "--full");
    expect((await native.exec(["git", "-C", clone, "cat-file", "-e", privateBlob])).success).toBe(false);
    expect(await Bun.file(join(clone, "private.txt")).exists()).toBe(false);
    const acceptedRef = "refs/heads/release/staging";
    const branchBundle = await createAcceptedBundle(executor, { remote, token: "fixture", commit, tree, directory: branchDirectory, acceptedRef, acceptedRootVersion: 3 });
    expect(branchBundle).toMatchObject({ commit, tree, ref: acceptedRef, acceptedRef, acceptedRootVersion: 3 });
    expect((await git("bundle", "list-heads", branchBundle.path)).split("\n").sort()).toEqual([`${commit} HEAD`, `${commit} ${acceptedRef}`].sort());
    const branchClone = join(root, "branch-clone");
    await git("clone", "-q", branchBundle.path, branchClone);
    expect(await git("-C", branchClone, "symbolic-ref", "HEAD")).toBe(acceptedRef);
    expect(await git("-C", branchClone, "rev-parse", "HEAD")).toBe(commit);
    expect((await native.exec(["git", "-C", branchClone, "cat-file", "-e", privateBlob])).success).toBe(false);
    await git("-C", branchClone, "fsck", "--full");
    passed=true;
  } catch(error){try{await Bun.write(join(root,"native-command-diagnostics.json"),JSON.stringify(diagnostics,null,2));}catch{/* Retain original failure when storage is exhausted. */}console.error(`Failed accepted-bundle fixture retained: ${[root,directory,unknownTreeDirectory,mismatchDirectory,contaminatedDirectory].join(" | ")}`);throw error;}
  finally { if(passed){await rm(root, { recursive: true, force: true }); await rm(directory, { recursive: true, force: true }); await rm(unknownTreeDirectory, { recursive: true, force: true }); await rm(mismatchDirectory, { recursive: true, force: true }); await rm(contaminatedDirectory, { recursive: true, force: true }); await rm(branchDirectory, { recursive: true, force: true }); }}
},60_000);
