import { spawnSync, type SpawnOptions } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export function executionEnv(home: string): NodeJS.ProcessEnv {
  return { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: home, TMPDIR: home, NODE_ENV: "test", CI: "1" };
}

function walk(root: string, action: (file: string, stat: fs.Stats) => void) {
  const stat = fs.lstatSync(root); action(root, stat);
  if (stat.isDirectory()) for (const name of fs.readdirSync(root)) walk(path.join(root, name), action);
}

/** Separate OS identity for contributor execution. The privileged supervisor owns
 * original Git and platform files; each run owns only its disposable snapshot.
 * Local non-Linux/non-root execution is explicitly weaker and never production.
 */
export function createExecutionBoundary(work: string, writablePaths: string[], protectedRepo?: string) {
  const isolated = process.platform === "linux" && process.getuid?.() === 0;
  if (!isolated && (process.env.NODE_ENV !== "test" || process.env.FLAREGIT_REQUIRE_ISOLATION === "1")) throw new Error("Contributor execution requires Linux UID isolation; same-user execution is available only in the explicitly trusted NODE_ENV=test harness");
  let uid: number | undefined;
  if (isolated) {
    if (spawnSync("setpriv", ["--version"]).status !== 0 || spawnSync("pkill", ["--version"]).status !== 0) throw new Error("Contributor isolation tools unavailable");
    const occupied = new Set(spawnSync("ps", ["-eo", "uid="], { encoding: "utf8" }).stdout.trim().split(/\s+/).map(Number));
    do { uid = 100_000 + crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000; } while (occupied.has(uid));
    fs.chmodSync(work, 0o755);
    if (protectedRepo) { fs.chownSync(protectedRepo, 0, 0); fs.chmodSync(protectedRepo, 0o700); }
    const platform = path.resolve(import.meta.dirname, "..", "..", "..");
    walk(platform, (file, stat) => {
      if (!stat.isSymbolicLink() && (stat.uid !== 0 || (stat.mode & 0o022) !== 0)) throw new Error(`Trusted platform permissions are unsafe: ${path.relative(platform, file)}`);
    });
    for (const writable of writablePaths) walk(writable, (file, stat) => {
      if (stat.isSymbolicLink()) fs.lchownSync(file, uid!, uid!);
      else { fs.chownSync(file, uid!, uid!); if (stat.isDirectory()) fs.chmodSync(file, 0o700); }
    });
  }
  return {
    isolated,
    command(executable: string, args: string[]) {
      return uid === undefined ? { executable, args } : { executable: "setpriv", args: ["--reuid", String(uid), "--regid", String(uid), "--clear-groups", "--no-new-privs", "--", executable, ...args] };
    },
    options(env: NodeJS.ProcessEnv): SpawnOptions { return { env, detached: isolated }; },
    dispose() {
      // Kill descendants even if they daemonized into another process group.
      if (uid === undefined) return;
      for (let attempt = 0; attempt < 20; attempt++) {
        const killed = spawnSync("pkill", ["-KILL", "-u", String(uid)]);
        if (killed.status !== 0 && killed.status !== 1) throw new Error("Contributor process cleanup failed; output cannot be exported");
        const listed = spawnSync("ps", ["-eo", "uid=,stat="], { encoding: "utf8" });
        if (listed.status !== 0) throw new Error("Contributor cleanup could not be verified; output cannot be exported");
        const active = listed.stdout.trim().split("\n").some((line) => {
          const [owner, status] = line.trim().split(/\s+/);
          // Zombies cannot execute or mutate output; their privileged reaper owns cleanup.
          return Number(owner) === uid && !status?.startsWith("Z");
        });
        if (!active) return;
        spawnSync("sleep", ["0.01"]);
      }
      throw new Error("Contributor descendants remain active; output cannot be exported");
    },
  };
}
export type ExecutionBoundary = ReturnType<typeof createExecutionBoundary>;
