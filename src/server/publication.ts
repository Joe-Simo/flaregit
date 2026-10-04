import { gitAuthEnv, q } from "./shell.js";

/** Real remote history settles an ambiguous push response; no branch mutation occurs here. */
export async function publicationInHistory(
  exec: (command: string, env?: Record<string, string>) => Promise<{ success: boolean; exitCode: number; stdout?: string }>,
  directory: string, remote: string, token: string, branch: string, commit: string, allowMissing = false,
): Promise<boolean> {
  if (allowMissing) {
    const observed = await exec(`git -C ${q(directory)} ls-remote --refs ${q(remote)} ${q(`refs/heads/${branch}`)}`, gitAuthEnv(token));
    if (!observed.success || observed.stdout === undefined) throw new Error("Canonical publication state unavailable; publication remains pending");
    if (observed.stdout.trim() === "") return false;
    const rows = observed.stdout.trim().split("\n");
    if (rows.length !== 1 || !new RegExp(`^[a-f0-9]{40}\\t`).test(rows[0]!) || rows[0]!.split("\t")[1] !== `refs/heads/${branch}`) throw new Error("Canonical publication ref proof is invalid");
  }
  const fetched = await exec(`git -C ${q(directory)} fetch --quiet ${q(remote)} ${q(`+refs/heads/${branch}:refs/flaregit/recovery-head`)}`, gitAuthEnv(token));
  if (!fetched.success) throw new Error("Canonical publication state unavailable; publication remains pending");
  const proof = await exec(`git -C ${q(directory)} merge-base --is-ancestor ${q(commit)} refs/flaregit/recovery-head`);
  if (proof.exitCode === 0) return true;
  if (proof.exitCode === 1) return false;
  throw new Error("Canonical ancestry inspection failed; publication remains pending");
}
