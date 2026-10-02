import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createExecutionBoundary, executionEnv } from "./execution.js";

/** Trusted supervisor: contributor Bun macros/plugins run under a separate UID.
 * Output is copied only after all processes of that UID are killed, and symlinks
 * are never followed when exporting assets back to the privileged parent.
 */
export function buildPreview(source: string, destination: string) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "flaregit-preview-"));
  const snapshot = path.join(work, "candidate"), home = path.join(work, "home"), output = path.join(work, "output");
  let boundary: ReturnType<typeof createExecutionBoundary> | undefined;
  try {
    fs.mkdirSync(home); fs.mkdirSync(output);
    const cloned = spawnSync("git", ["clone", "--quiet", "--no-hardlinks", source, snapshot], { encoding: "utf8" });
    if (cloned.status !== 0) throw new Error("Preview snapshot could not be cloned");
    const tip = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" });
    const checked = spawnSync("git", ["-C", snapshot, "checkout", "--quiet", "--detach", tip.stdout.trim()], { encoding: "utf8" });
    if (tip.status !== 0 || checked.status !== 0) throw new Error("Preview snapshot could not restore its exact commit");
    fs.symlinkSync(path.resolve(import.meta.dirname, "..", "..", "..", "node_modules"), path.join(snapshot, "node_modules"), "dir");
    boundary = createExecutionBoundary(work, [snapshot, home, output], source);
    const invocation = boundary.command(process.execPath, ["build", "index.html", "--outdir", output, "--minify", "--env=disable"]);
    const built = spawnSync(invocation.executable, invocation.args, { cwd: snapshot, env: executionEnv(home), timeout: 120_000, encoding: "utf8", maxBuffer: 1_000_000 });
    boundary.dispose(); boundary = undefined;
    if (built.status !== 0) throw new Error("Preview build failed in contributor isolation");
    fs.rmSync(destination, { recursive: true, force: true }); fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
    const exportDirectory = (from: string, to: string) => {
      for (const name of fs.readdirSync(from)) {
        const input = path.join(from, name), target = path.join(to, name), stat = fs.lstatSync(input);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error("Preview output contains a link or non-file asset");
        if (stat.isDirectory()) { fs.mkdirSync(target, { mode: 0o700 }); exportDirectory(input, target); }
        else { const descriptor = fs.openSync(input, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.writeFileSync(target, fs.readFileSync(descriptor), { mode: 0o600 }); } finally { fs.closeSync(descriptor); } }
      }
    };
    exportDirectory(output, destination);
    if (!fs.existsSync(path.join(destination, "index.html"))) throw new Error("Preview build produced no index.html");
  } finally { boundary?.dispose(); fs.rmSync(work, { recursive: true, force: true }); }
}
if (import.meta.main) {
  const [, , source, destination] = process.argv;
  if (!source || !destination) throw new Error("Preview supervisor requires source and output directories");
  buildPreview(path.resolve(source), path.resolve(destination));
}
