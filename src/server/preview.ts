import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { gitOrThrow } from "../core/pipeline/git.js";

const PLATFORM_ROOT = path.resolve(import.meta.dirname, "..", "..");
const building = new Map<string, Promise<string>>();

/**
 * Build the application exactly as it exists at `commit` (bundling only; no contributor code runs) and
 * return the output directory. Builds are keyed by commit hash and immutable.
 */
export function ensureBuild(canonicalRemote: string, commit: string, cacheDir: string): Promise<string> {
  if (!/^[0-9a-f]{40}$/.test(commit)) return Promise.reject(new Error("invalid commit"));
  const outdir = path.join(cacheDir, commit);
  if (fs.existsSync(path.join(outdir, "index.html"))) return Promise.resolve(outdir);
  let job = building.get(commit);
  if (!job) {
    job = build(canonicalRemote, commit, outdir).finally(() => building.delete(commit));
    building.set(commit, job);
  }
  return job;
}

async function build(remote: string, commit: string, outdir: string): Promise<string> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "flaregit-preview-"));
  try {
    gitOrThrow(work, ["clone", "--quiet", "--no-hardlinks", remote, path.join(work, "src")]);
    const dir = path.join(work, "src");
    gitOrThrow(dir, ["checkout", "--quiet", "--detach", commit]);
    fs.symlinkSync(path.join(PLATFORM_ROOT, "node_modules"), path.join(dir, "node_modules"), "dir");
    const tmpOut = `${outdir}.tmp-${process.pid}`;
    fs.rmSync(tmpOut, { recursive: true, force: true });
    const res = await Bun.build({ entrypoints: [path.join(dir, "index.html")], outdir: tmpOut, minify: true });
    if (!res.success) throw new Error(`Build failed for ${commit}: ${res.logs.map(String).join("; ")}`);
    fs.rmSync(outdir, { recursive: true, force: true });
    fs.renameSync(tmpOut, outdir);
    return outdir;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
