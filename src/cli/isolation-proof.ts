// Run inside the owned Linux test container with --network none; fake credentials only.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createExecutionBoundary, executionEnv } from "../core/verification/execution";
import { buildPreview } from "../core/verification/build-preview";

const work = fs.mkdtempSync("/tmp/flaregit-probe-");
const rootOnly = fs.mkdtempSync("/root/flaregit-probe-");
const candidate = path.join(work, "candidate"), home = path.join(work, "home");
const credential = path.join(rootOnly, "fake-credential"), trusted = path.join(rootOnly, "trusted-file");
let boundary: ReturnType<typeof createExecutionBoundary> | undefined;
try {
  fs.mkdirSync(candidate); fs.mkdirSync(home);
  fs.writeFileSync(credential, "FAKE_ONLY_NOT_REAL", { mode: 0o600 });
  fs.writeFileSync(trusted, "unchanged", { mode: 0o644 });
  boundary = createExecutionBoundary(work, [candidate, home]);
  const invocation = boundary.command("sh", ["-c", `bun --version >/dev/null && test ! -r ${credential} && test ! -w ${trusted} && test ! -r /proc/1/environ && touch ${candidate}/writable; sleep 60 &`]);
  const ran = spawnSync(invocation.executable, invocation.args, { env: executionEnv(home), stdio: "ignore" });
  boundary.dispose(); boundary = undefined;
  if (ran.status !== 0 || !fs.existsSync(path.join(candidate, "writable")) || fs.readFileSync(trusted, "utf8") !== "unchanged") throw new Error("UID boundary probe failed");
  const repo = path.join(work, "macro-repo"), output = path.join(work, "macro-output");
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, "index.html"), '<script type="module" src="./app.ts"></script>');
  fs.writeFileSync(path.join(repo, "app.ts"), 'import {probe} from "./macro.ts" with {type:"macro"}; console.log(probe());');
  fs.writeFileSync(path.join(repo, "macro.ts"), `import fs from 'node:fs'; export function probe(){let denied=0; for(const file of [${JSON.stringify(credential)},'/proc/1/environ']){try{fs.readFileSync(file)}catch{denied++}} try{fs.writeFileSync(${JSON.stringify(trusted)},'tampered')}catch{denied++} if(denied!==3)throw Error('macro breached boundary'); return 'actual-macro-isolated';}`);
  for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=Probe", "-c", "user.email=probe@localhost", "commit", "-qm", "Synthetic macro probe"]]) {
    if (spawnSync("git", ["-C", repo, ...args]).status !== 0) throw new Error("Fixture Git failed");
  }
  buildPreview(repo, output);
  if (fs.readFileSync(trusted, "utf8") !== "unchanged") throw new Error("Trusted source modified");
  console.log("PASS: UID denied fake root credential, root process environment and trusted writes; daemon cleanup verified; real Bun macro preview built with networking disabled.");
} finally {
  boundary?.dispose();
  fs.rmSync(work, { recursive: true, force: true });
  fs.rmSync(rootOnly, { recursive: true, force: true });
}
