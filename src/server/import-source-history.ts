import { validateImportSource } from "./import-source";
import { q } from "./shell";
import type { GitHistoryInventory } from "./migration-receipt";
import { HistoryMetadataLimitError, verifyImportedHistory, type HistoryBinding, type ImportHistoryResult } from "./import-history";
export interface HistoryExecutor {
  exec(command: string, options?: { env?: Record<string, string>; timeout?: number }): Promise<{ success: boolean; stdout: string; stderr: string }>;
}
/** Invoke in a durable Workflow step with a dedicated sandbox, then destroy the sandbox.
 * Source capture is limited to the trusted github.com public Git provider; arbitrary hosts
 * remain unavailable until enforced network egress controls exist. Redirects are disabled.
 */
export async function capturePublicSourceHistory(executor: HistoryExecutor, source: string, branch: string, expectedHead?: string): Promise<GitHistoryInventory | null> {
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
    if (expectedHead && !/^[a-f0-9]{40}$/.test(expectedHead)) throw new Error("Invalid source snapshot");
    const pinnedHead = expectedHead ?? head;
    if (expectedHead && (await git(`rev-parse --verify ${q(`${expectedHead}^{commit}`)}`)) !== expectedHead) return null;
    const shallow = await git("rev-parse --is-shallow-repository");
    // Capture at most 1001 to make truncation explicit. Never execute customer files.
    const lines = (await git(`log --max-count=1001 --format='%H %T %P' ${q(pinnedHead)}`)).split("\n");
    const commits: GitHistoryInventory["commits"] = {};
    for (const line of lines.slice(0, 1000)) {
      const [hash, tree, ...parents] = line.split(" ");
      if (!hash || !tree || !/^[a-f0-9]{40}$/.test(hash) || !/^[a-f0-9]{40}$/.test(tree) || parents.some((parent) => !/^[a-f0-9]{40}$/.test(parent))) return null;
      commits[hash] = { tree, parents };
    }
    return { capturedAt: new Date().toISOString(), refs: { [`refs/heads/${branch}`]: pinnedHead }, commits, shallow: shallow !== "false" || lines.length > 1000 };
  } catch { return null; }
  finally {
    try { const cleanup = await executor.exec(`rm -rf -- ${q(directory)}`, { env, timeout: 5000 }); if (!cleanup.success) console.warn("Import history temporary clone cleanup failed"); }
    catch { console.warn("Import history temporary clone cleanup failed"); }
  }
}
export async function inspectImportedHistory(executor: HistoryExecutor, binding: HistoryBinding, job: { source: string; canonicalRepoName: string }, head: string, branch: string): Promise<ImportHistoryResult> {
  return verifyImportedHistory(binding, job.canonicalRepoName, branch, head, await capturePublicSourceHistory(executor, job.source, branch));
}

export const SOURCE_HISTORY_CHUNK_LIMIT = 256;
const sourceHistoryEnv = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "0" };
function sourceHistoryDirectory(directory: string): void {
  if (!/^\/tmp\/flaregit-import-history-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(directory)) throw new Error("Invalid source history workspace");
}
async function sourceHistoryRead(executor: HistoryExecutor, command: string, beforeRead: () => Promise<void>, limit = 2_000_000): Promise<string> {
  await beforeRead();
  const result = await executor.exec(command, { env: sourceHistoryEnv, timeout: 60_000 });
  await beforeRead();
  if (result.stdout.length > limit) throw new HistoryMetadataLimitError();
  if (!result.success) throw new Error("Source history capture unavailable");
  return result.stdout.trim();
}
/** Full bare clone for a durable traversal. The caller funds, owns and removes this
 * exact workspace; no checkout, hooks, source execution or mutable branch fallback. */
export async function preparePublicSourceHistoryClone(executor: HistoryExecutor, source: string, branch: string, expectedHead: string, directory: string, beforeRead: () => Promise<void> = async () => {}): Promise<{ head: string; ref: string; shallow: boolean } | null> {
  sourceHistoryDirectory(directory);
  if (!/^[a-f0-9]{40}$/.test(expectedHead)) throw new Error("Invalid source snapshot");
  const url = validateImportSource(source);
  if (url.hostname !== "github.com" || !/^\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+(?:\.git)?\/?$/.test(url.pathname)) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes("..") || branch.includes("//") || branch.endsWith(".lock")) throw new Error("Invalid source branch");
  await sourceHistoryRead(executor, `git -c core.hooksPath=/dev/null -c http.followRedirects=false -c protocol.allow=never -c protocol.https.allow=always clone --quiet --bare --single-branch --branch ${q(branch)} -- ${q(url.toString())} ${q(directory)}`, beforeRead);
  const git = (args: string) => sourceHistoryRead(executor, `git --git-dir ${q(directory)} ${args}`, beforeRead);
  // The imported SHA may precede today's branch head, but must exist unchanged.
  if (await git(`rev-parse --verify ${q(`${expectedHead}^{commit}`)}`) !== expectedHead) throw new Error("Pinned source commit unavailable");
  const shallow = await git("rev-parse --is-shallow-repository");
  if (shallow !== "true" && shallow !== "false") throw new Error("Invalid source history state");
  return { head: expectedHead, ref: `refs/heads/${branch}`, shallow: shallow === "true" };
}
/** Inspect only the explicit persisted frontier. Parents are returned in native
 * Git order; the durable ledger controls traversal, deduplication and completion. */
export async function readSourceHistoryChunk(executor: HistoryExecutor, directory: string, frontier: readonly string[], beforeRead: () => Promise<void> = async () => {}): Promise<{ commits: GitHistoryInventory["commits"]; shallow: boolean }> {
  sourceHistoryDirectory(directory);
  if (!frontier.length || frontier.length > SOURCE_HISTORY_CHUNK_LIMIT || new Set(frontier).size !== frontier.length || frontier.some(hash => !/^[a-f0-9]{40}$/.test(hash))) throw new Error("Invalid source history frontier");
  const git = (args: string) => sourceHistoryRead(executor, `git --git-dir ${q(directory)} ${args}`, beforeRead, 512 * 1024);
  const shallow = await git("rev-parse --is-shallow-repository");
  if (shallow !== "true" && shallow !== "false") throw new Error("Invalid source history state");
  const output = await git(`log --no-walk=unsorted --format='%H %T %P' ${frontier.map(q).join(" ")} --`);
  const commits: GitHistoryInventory["commits"] = {};
  for (const line of output.split("\n")) {
    const [hash, tree, ...parents] = line.trim().split(" ");
    if (!hash || !tree || !frontier.includes(hash) || commits[hash] || !/^[a-f0-9]{40}$/.test(tree) || parents.some(parent => !/^[a-f0-9]{40}$/.test(parent))) throw new Error("Invalid source history chunk");
    if (parents.length > 256) throw new HistoryMetadataLimitError();
    commits[hash] = { tree, parents };
  }
  if (Object.keys(commits).length !== frontier.length) throw new Error("Source history frontier incomplete");
  return { commits, shallow: shallow === "true" };
}

/** Bounded reachable traversal reduces native calls for long linear histories.
 * A missing requested root or parent is NOT completion: the durable ledger must
 * retain it in its frontier until separately captured or already proven. */
export async function readSourceHistoryTraversalChunk(executor: HistoryExecutor, directory: string, frontier: readonly string[], beforeRead: () => Promise<void> = async () => {}): Promise<{ commits: GitHistoryInventory["commits"]; shallow: boolean }> {
  sourceHistoryDirectory(directory);
  if (!frontier.length || frontier.length > SOURCE_HISTORY_CHUNK_LIMIT || new Set(frontier).size !== frontier.length || frontier.some(hash => !/^[a-f0-9]{40}$/.test(hash))) throw new Error("Invalid source history frontier");
  const git = (args: string) => sourceHistoryRead(executor, `git --git-dir ${q(directory)} ${args}`, beforeRead, 512 * 1024);
  const shallow = await git("rev-parse --is-shallow-repository");
  if (shallow !== "true" && shallow !== "false") throw new Error("Invalid source history state");
  const output = await git(`log --max-count=${SOURCE_HISTORY_CHUNK_LIMIT} --format='%H %T %P' ${frontier.map(q).join(" ")} --`);
  const commits: GitHistoryInventory["commits"] = {};
  for (const line of output.split("\n")) {
    const [hash, tree, ...parents] = line.trim().split(" ");
    if (!hash || !tree || !/^[a-f0-9]{40}$/.test(hash) || commits[hash] || !/^[a-f0-9]{40}$/.test(tree) || parents.some(parent => !/^[a-f0-9]{40}$/.test(parent))) throw new Error("Invalid source history chunk");
    if (parents.length > 256) throw new HistoryMetadataLimitError();
    commits[hash] = { tree, parents };
  }
  const hashes = Object.keys(commits);
  if (!hashes.length || hashes.length > SOURCE_HISTORY_CHUNK_LIMIT) throw new Error("Invalid source history chunk size");
  const reachable = new Set<string>(), pending = [...frontier];
  while (pending.length) { const hash = pending.pop()!; const record = commits[hash]; if (!record || reachable.has(hash)) continue; reachable.add(hash); pending.push(...record.parents); }
  if (hashes.some(hash => !reachable.has(hash))) throw new Error("Source chunk contains unrelated commits");
  return { commits, shallow: shallow === "true" };
}
