import { expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createExecutionBoundary, executionEnv } from "../src/core/verification/execution.js";

const native = process.platform === "linux" && process.getuid?.() === 0;
if (process.env.FLAREGIT_BOUNDARY_PROOF_REQUIRED === "1" && !native) throw new Error("Native boundary proof requires Linux root supervision; weaker harness is forbidden");

(native ? test : test.skip)("production UID boundary rejects root environment and Git mutation, then reaps detached descendants", async () => {
  expect(process.env.FLAREGIT_REQUIRE_ISOLATION).toBe("1");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "flaregit-boundary-proof-"));
  const canonical = path.join(work, "canonical"), snapshot = path.join(work, "snapshot"), home = path.join(work, "home");
  fs.mkdirSync(canonical); fs.mkdirSync(snapshot); fs.mkdirSync(home);
  const initialized = spawnSync("git", ["init", "--quiet", canonical]);
  expect(initialized.status).toBe(0);
  const protectedFile = path.join(canonical, "accepted.txt"); fs.writeFileSync(protectedFile, "accepted history");
  const canary = `synthetic-canary-${crypto.randomUUID()}`;
  const privileged = spawn("sleep", ["30"], { env: { PATH: "/usr/bin:/bin", FLAREGIT_SYNTHETIC_CANARY: canary }, stdio: "ignore" });
  let boundary: ReturnType<typeof createExecutionBoundary> | undefined;
  let daemonPid: number | undefined;
  try {
    expect(privileged.pid).toBeDefined();
    await new Promise<void>((resolve, reject) => { privileged.once("spawn", resolve); privileged.once("error", reject); });
    expect(fs.readFileSync(`/proc/${privileged.pid}/environ`, "utf8")).toContain(canary);
    boundary = createExecutionBoundary(work, [snapshot, home], canonical);
    expect(boundary.isolated).toBe(true);
    const env = executionEnv(home);
    const attempt = boundary.command(process.execPath, ["-e", `
      const [pid,target]=Bun.argv.slice(1);
      let environmentDenied=false, mutationDenied=false;
      try { await Bun.file('/proc/'+pid+'/environ').text(); } catch { environmentDenied=true; }
      try { await Bun.write(target,'unauthorized'); } catch { mutationDenied=true; }
      const child=Bun.spawn(['/usr/bin/setsid','/bin/sleep','30'],{stdin:'ignore',stdout:'ignore',stderr:'ignore'});
      console.log(JSON.stringify({uid:process.getuid(),environmentDenied,mutationDenied,daemonPid:child.pid,hasCanary:process.env.FLAREGIT_SYNTHETIC_CANARY!==undefined}));
      child.unref();
    `, String(privileged.pid), protectedFile]);
    const result = spawnSync(attempt.executable, attempt.args, { ...boundary.options(env), cwd: snapshot, encoding: "utf8", timeout: 5000 });
    expect(result.status).toBe(0);
    const proof = JSON.parse(result.stdout.trim()) as { uid: number; environmentDenied: boolean; mutationDenied: boolean; daemonPid: number; hasCanary: boolean };
    expect(proof.uid).not.toBe(0); expect(proof.environmentDenied).toBe(true); expect(proof.mutationDenied).toBe(true); expect(proof.hasCanary).toBe(false);
    expect(fs.readFileSync(protectedFile, "utf8")).toBe("accepted history");
    daemonPid = proof.daemonPid;
    const before = spawnSync("ps", ["-p", String(daemonPid), "-o", "uid=,stat="], { encoding: "utf8" });
    expect(before.status).toBe(0); expect(Number(before.stdout.trim().split(/\s+/)[0])).toBe(proof.uid);
    boundary.dispose(); boundary = undefined;
    const after = spawnSync("ps", ["-p", String(daemonPid), "-o", "stat="], { encoding: "utf8" });
    expect(after.status !== 0 || after.stdout.trim().startsWith("Z")).toBe(true);
    // A later trusted Git command gets a distinct harmless marker only after cleanup.
    const later = spawnSync("git", ["-C", canonical, "status", "--porcelain"], { env: { PATH: "/usr/bin:/bin", FLAREGIT_SYNTHETIC_CANARY: "later-synthetic-marker" }, encoding: "utf8" });
    expect(later.status).toBe(0); expect(later.stdout).toContain("accepted.txt");
  } finally {
    boundary?.dispose(); privileged.kill("SIGKILL");
    fs.rmSync(work, { recursive: true, force: true });
  }
}, 15000);
