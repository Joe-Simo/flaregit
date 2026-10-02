import { gitAuthEnv, q } from "./shell.js";

/** Real remote history settles an ambiguous push response; no branch mutation occurs here. */
export async function publicationInHistory(
  exec: (command: string, env?: Record<string, string>) => Promise<{ success: boolean; exitCode: number }>,
  directory: string, remote: string, token: string, branch: string, commit: string,
): Promise<boolean> {
  const fetched = await exec(`git -C ${q(directory)} fetch --quiet ${q(remote)} ${q(`+refs/heads/${branch}:refs/flaregit/recovery-head`)}`, gitAuthEnv(token));
  if (!fetched.success) throw new Error("Canonical publication state unavailable; publication remains pending");
  const proof = await exec(`git -C ${q(directory)} merge-base --is-ancestor ${q(commit)} refs/flaregit/recovery-head`);
  if (proof.exitCode === 0) return true;
  if (proof.exitCode === 1) return false;
  throw new Error("Canonical ancestry inspection failed; publication remains pending");
}
