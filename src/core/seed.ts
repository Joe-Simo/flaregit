import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ArtifactsClient } from "../artifacts/types.js";
import { gitOrThrow } from "./pipeline/git.js";

/** Create the canonical repository and push the fixture template as its first accepted commit. */
export async function seedCanonicalRepository(
  artifacts: ArtifactsClient,
  repoName: string,
  templateDir: string,
  message = "Initial accepted version"
): Promise<{ remote: string; head: string }> {
  const repo = await artifacts.create(repoName, { description: "FlareGit canonical repository", setDefaultBranch: "main" });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "flaregit-seed-"));
  try {
    gitOrThrow(work, ["init", "--quiet", "--initial-branch", "main"]);
    fs.cpSync(templateDir, work, { recursive: true });
    gitOrThrow(work, ["add", "-A"]);
    gitOrThrow(work, ["-c", "user.name=FlareGit", "-c", "user.email=system@flaregit.com", "commit", "--quiet", "-m", message]);
    gitOrThrow(work, ["push", "--quiet", repo.remote, "main:main"]);
    return { remote: repo.remote, head: gitOrThrow(work, ["rev-parse", "HEAD"]) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
