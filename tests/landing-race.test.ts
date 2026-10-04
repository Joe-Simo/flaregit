import { expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// The suite runs 20 by default; the full 500-branch run is `RACE_BRANCHES=500 RACE_TIMEOUT_MS=7200000 bun test tests/landing-race.test.ts`.
const BRANCHES = Number(process.env.RACE_BRANCHES ?? 20);
const PARALLEL = Number(process.env.RACE_PARALLEL ?? 4);

const sh = async (cwd: string, ...argv: string[]) => {
  const p = Bun.spawn(["git", ...argv], { cwd, stdout: "pipe", stderr: "pipe", timeout: 15_000, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e.com" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out: out.trim(), err, code };
};

/**
 * The landing protocol is: build the candidate on top of the observed base, then move the branch with
 * `--force-with-lease=<ref>:<observed base>`. 500 contributors race for one branch; every loser must be told
 * (never silently overwrite) and retry on the new base. Nothing may be lost, orphaned or duplicated.
 */
test(`${BRANCHES} concurrent landings onto one branch: no lost refs, no orphan commits, no desync`, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flaregit-race-"));
  let passed = false;
  const diagnostics: Array<{cwd:string;argv:string[];out:string;err:string;code:number}> = [];
  const run = async(cwd:string,...argv:string[])=>{const result=await sh(cwd,...argv);diagnostics.push({cwd,argv,...result});return result;};
  const requireGit = async(cwd:string,...argv:string[])=>{const result=await run(cwd,...argv);if(result.code!==0)throw new Error(`Native fixture command failed (${result.code}): git ${argv.join(" ")}\n${result.err}`);return result;};
  try {
    const remote = path.join(root, "remote.git");
    await requireGit(root, "init", "--bare", "--initial-branch=main", remote);
    const seed = path.join(root, "seed");
    await requireGit(root, "init", "--initial-branch=main", seed);
    fs.writeFileSync(path.join(seed, "README"), "base\n");
    await requireGit(seed, "add", "-A");
    await requireGit(seed, "commit", "-m", "base");
    await requireGit(seed, "push", remote, "main");

    let rejected = 0;
    const land = async (n: number) => {
      const dir = path.join(root, `w${n}`);
      // Under heavy process load a clone can fail transiently; retry it so the race measures landings, not fork pressure.
      for (let i = 0; i < 5 && (await run(root, "clone", "--quiet", remote, dir)).code !== 0; i++) {
        fs.rmSync(dir, { recursive: true, force: true });
        await Bun.sleep(200 * (i + 1));
      }
      expect(fs.existsSync(path.join(dir, ".git"))).toBe(true);
      for (let attempt = 0; ; attempt++) {
        const base = (await requireGit(dir, "ls-remote", "origin", "refs/heads/main")).out.split("\t")[0]!;
        if(!/^[a-f0-9]{40}$/.test(base))throw new Error("Native fixture did not observe an exact remote base");
        await requireGit(dir, "fetch", "--quiet", "origin", "main");
        await requireGit(dir, "checkout", "--quiet", "--detach", base);
        fs.writeFileSync(path.join(dir, `f${n}.txt`), `contributor ${n}\n`);
        await requireGit(dir, "add", "-A");
        await requireGit(dir, "commit", "--quiet", "-m", `change ${n}`);
        // The change also gets its own branch, as task branches do on the platform.
        await requireGit(dir, "push", "--quiet", "origin", `+HEAD:refs/heads/task/c${n}`);
        const push = await run(dir, "push", "--quiet", `--force-with-lease=refs/heads/main:${base}`, "origin", "HEAD:refs/heads/main");
        if (push.code === 0) return;
        if(!/\[rejected\].*(?:stale info|fetch first|non-fast-forward)/.test(push.err)&&!/cannot lock ref.*(?:expected|is at)/.test(push.err))throw new Error(`Unexpected native lease-push failure (${push.code}): ${push.err}`);
        rejected++;
        expect(attempt).toBeLessThan(2000);
        // A refused contributor backs off with jitter before rebuilding on the new base, as a real client does.
        await Bun.sleep(Math.random() * 40 * Math.min(attempt + 1, 8));
      }
    };

    const queue = Array.from({ length: BRANCHES }, (_, i) => i);
    const workers = await Promise.allSettled(Array.from({ length: PARALLEL }, async () => { for (let n = queue.shift(); n !== undefined; n = queue.shift()) await land(n); }));
    const failedWorker = workers.find((worker) => worker.status === "rejected");
    if(failedWorker?.status === "rejected")throw failedWorker.reason;

    const check = path.join(root, "check");
    await requireGit(root, "clone", "--quiet", remote, check);
    const files = fs.readdirSync(check).filter((f) => /^f\d+\.txt$/.test(f));
    expect(files.length).toBe(BRANCHES); // 0 lost changes
    expect((await requireGit(check, "rev-list", "--count", "main")).out).toBe(String(BRANCHES + 1)); // linear: base + one commit per landing
    const fsck = await requireGit(remote, "fsck", "--no-dangling");
    expect(fsck.code).toBe(0); // object store consistent
    const unmerged = await requireGit(remote, "branch", "--no-merged", "main", "--list", "task/*");
    expect(unmerged.out).toBe(""); // every task tip is reachable from main: no orphan commits
    expect(rejected).toBeGreaterThan(0); // the race was real: losers were refused, not overwritten
    passed = true;
  } catch(error) {
    try{fs.writeFileSync(path.join(root,"native-command-diagnostics.json"),JSON.stringify(diagnostics,null,2));}catch{/* Preserve the original failure even if diagnostic writing also fails. */}
    console.error(`Failed native landing fixture retained: ${root}`);throw error;
  } finally {
    if(passed)fs.rmSync(root, { recursive: true, force: true });
  }
}, Number(process.env.RACE_TIMEOUT_MS ?? 600_000));
