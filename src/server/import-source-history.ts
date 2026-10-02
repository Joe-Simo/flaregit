import { validateImportSource } from "./import-source";
import { q } from "./shell";
import type { GitHistoryInventory } from "./migration-receipt";
import { verifyImportedHistory, type HistoryBinding, type ImportHistoryResult } from "./import-history";
export interface HistoryExecutor {
  exec(command: string, options?: { env?: Record<string, string>; timeout?: number }): Promise<{ success: boolean; stdout: string; stderr: string }>;
}
/** Invoke in a durable Workflow step with a dedicated sandbox, then destroy the sandbox.
 * Source capture is limited to the trusted github.com public Git provider; arbitrary hosts
 * remain unavailable until enforced network egress controls exist. Redirects are disabled.
 */
export async function capturePublicSourceHistory(executor: HistoryExecutor, source: string, branch: string): Promise<GitHistoryInventory | null> {
  const url = validateImportSource(source);
  if (url.hostname !== "github.com" || !/^\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+(?:\.git)?\/?$/.test(url.pathname)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes("..") || branch.includes("//") || branch.endsWith(".lock")) throw new Error("Invalid source branch");
  const directory = `/tmp/flaregit-import-history-${crypto.randomUUID()}`;
  const env = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "0" };
  const run = async (command: string) => {
    const result = await executor.exec(command, { env, timeout: 60_000 });
    if (!result.success || result.stdout.length > 2_000_000) throw new Error("Source history capture unavailable");
    return result.stdout.trim();
  };
  try {
    await run(`git -c core.hooksPath=/dev/null -c http.followRedirects=false -c protocol.allow=never -c protocol.https.allow=always clone --quiet --bare --single-branch --branch ${q(branch)} -- ${q(url.toString())} ${q(directory)}`);
    const git = (args: string) => run(`git --git-dir ${q(directory)} ${args}`);
    const head = await git(`rev-parse --verify ${q(`refs/heads/${branch}^{commit}`)}`);
    if (!/^[a-f0-9]{40}$/.test(head)) return null;
    const shallow = await git("rev-parse --is-shallow-repository");
    // Capture at most 1001 to make truncation explicit. Never execute customer files.
    const lines = (await git(`log --max-count=1001 --format='%H %T %P' ${q(head)}`)).split("\n");
    const commits: GitHistoryInventory["commits"] = {};
    for (const line of lines.slice(0, 1000)) {
      const [hash, tree, ...parents] = line.split(" ");
      if (!hash || !tree || !/^[a-f0-9]{40}$/.test(hash) || !/^[a-f0-9]{40}$/.test(tree) || parents.some((parent) => !/^[a-f0-9]{40}$/.test(parent))) return null;
      commits[hash] = { tree, parents };
    }
    return { capturedAt: new Date().toISOString(), refs: { [`refs/heads/${branch}`]: head }, commits, shallow: shallow !== "false" || lines.length > 1000 };
  } catch { return null; }
  finally { await executor.exec(`rm -rf -- ${q(directory)}`, { env, timeout: 5000 }); }
}
export async function inspectImportedHistory(executor: HistoryExecutor, binding: HistoryBinding, job: { source: string; canonicalRepoName: string }, head: string, branch: string): Promise<ImportHistoryResult> {
  return verifyImportedHistory(binding, job.canonicalRepoName, branch, head, await capturePublicSourceHistory(executor, job.source, branch));
}
