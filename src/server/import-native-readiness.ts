import { isSafeRef } from "../core/sanitize";
import { q } from "./shell";

export interface ImportNativeExecutor {
  exec(command: string): Promise<{ success: boolean; stdout: string; stderr: string }>;
}
export interface ImportNativeSnapshot { head: string; branch: string; tree: string }
const sha = /^[a-f0-9]{40}$/;

/** The caller owns funding, credentials, bounded execution and durable shutdown.
 * Reads only: no checkout, source execution, branch aliases or remote writes.
 */
export async function inspectNativeImport(executor: ImportNativeExecutor, remote: string, requestedBranch: string, directory: string): Promise<ImportNativeSnapshot> {
  if (!/^\/tmp\/flaregit-import-ready-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(directory)) throw new Error("Invalid import inspection workspace");
  const url = new URL(remote);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || /[\x00-\x1f\x7f\\]/.test(remote)) throw new Error("Invalid imported repository remote");
  if (requestedBranch && !isSafeRef(requestedBranch)) throw new Error("Invalid selected import branch");
  const read = async (command: string) => {
    const result = await executor.exec(command);
    if (!result.success || result.stdout.length > 32768) throw new Error("Native import readiness unavailable");
    return result.stdout.trim();
  };
  const advertisement = await read(`git ls-remote --symref ${q(remote)} ${q(requestedBranch ? `refs/heads/${requestedBranch}` : "HEAD")}`);
  let branch = requestedBranch;
  let selected = advertisement;
  if (!branch) {
    const symbolic = advertisement.split("\n").filter(line => line.startsWith("ref: ") && line.endsWith("\tHEAD"));
    if (symbolic.length > 1) throw new Error("Imported default branch is ambiguous");
    if (symbolic.length === 1) {
      const fullRef = symbolic[0]!.slice(5, -5);
      if (!fullRef.startsWith("refs/heads/") || !isSafeRef(fullRef.slice(11))) throw new Error("Imported default branch is not safe");
      branch = fullRef.slice(11);
      selected = await read(`git ls-remote ${q(remote)} ${q(fullRef)}`);
      const matching = selected.split("\n").filter(line => line.endsWith(`\t${fullRef}`));
      if (matching.length > 1) throw new Error("Imported default branch is ambiguous");
      if (!matching.length) branch = "";
    }
    if (!branch) {
      // Some imported providers retain a dangling HEAD. Only a sole genuine
      // branch is an unambiguous replacement; tags and SDK metadata never vote.
      selected = await read(`git ls-remote --heads ${q(remote)} ${q("refs/heads/*")}`);
      const heads = selected ? selected.split("\n") : [];
      if (heads.length !== 1) throw new Error("Imported default branch is not advertised unambiguously");
      const [hash, fullRef, extra] = heads[0]!.split("\t");
      if (!hash || !sha.test(hash) || !fullRef?.startsWith("refs/heads/") || !isSafeRef(fullRef.slice(11)) || extra !== undefined) throw new Error("Imported default branch is not advertised unambiguously");
      branch = fullRef.slice(11);
    }
  }
  const ref = `refs/heads/${branch}`;
  const lines = selected.split("\n").filter(line => line.endsWith(`\t${ref}`));
  if (lines.length !== 1) throw new Error("Selected import branch is unavailable");
  const head = lines[0]!.split("\t")[0]!;
  if (!sha.test(head)) throw new Error("Selected import branch commit is invalid");
  await read(`git init --quiet --bare ${q(directory)} && git -C ${q(directory)} fetch --quiet --no-tags ${q(remote)} ${q(`${ref}:refs/flaregit/import-readiness`)}`);
  const fetchedHead = await read(`git -C ${q(directory)} rev-parse --verify ${q("refs/flaregit/import-readiness^{commit}")}`);
  if (fetchedHead !== head) throw new Error("Selected import branch changed during inspection");
  const tree = await read(`git -C ${q(directory)} rev-parse --verify ${q(`${head}^{tree}`)}`);
  if (!sha.test(tree)) throw new Error("Imported commit tree is unavailable");
  return { head, branch, tree };
}
