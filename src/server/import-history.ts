import { compareMigrationHistory, type GitHistoryInventory, type MigrationReceipt } from "./migration-receipt";
export interface HistoryReader {
  log(options: { ref: string; limit: number }): Promise<Array<{ hash: string }>>;
  readCommit(hash: string): Promise<{ hash: string; treeHash: string; parents: string[] } | null>;
  [Symbol.dispose](): void;
}
export interface HistoryBinding { get(name: string): Promise<HistoryReader> }
export type ImportHistoryResult = { status: "unavailable" | "incomplete"; detail: string } | { status: "verified" | "mismatch"; receipt: MigrationReceipt; detail: string };
const HASH = /^[a-f0-9]{40}$/;
export class HistoryMetadataLimitError extends Error {
  constructor() { super("History metadata exceeds the bounded inspection capacity"); this.name = "HistoryMetadataLimitError"; }
}
export interface HistoryChunk {
  commits: GitHistoryInventory["commits"];
  missing: string[];
}
/** A bounded explicit frontier read. The caller durably saves each chunk before advancing. */
export async function captureArtifactsHistoryChunk(
  binding: HistoryBinding,
  name: string,
  hashes: readonly string[],
  beforeRead: (hash: string, index: number) => Promise<void>,
  knownHashes: readonly string[] = [],
  authorize: () => Promise<void> = async () => {},
): Promise<HistoryChunk> {
  if (!hashes.length || hashes.length > 128 || new Set(hashes).size !== hashes.length || hashes.some(hash => !HASH.test(hash))) throw new Error("Invalid history inspection frontier");
  if (knownHashes.length > 25_000 || knownHashes.some(hash => !HASH.test(hash))) throw new Error("Invalid captured history boundary");
  const deadline = Date.now() + 10_000;
  const bounded = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("History chunk deadline reached")), Math.max(1, deadline - Date.now())); })]);
    } finally { if (timer) clearTimeout(timer); }
  };
  await bounded(authorize());
  using repo = await bounded(binding.get(name));
  await bounded(authorize());
  const commits: HistoryChunk["commits"] = {}, missing: string[] = [];
  const pending = [...hashes], visited = new Set<string>(), known = new Set(knownHashes);
  for (const hash of hashes) known.delete(hash);
  while (pending.length && visited.size < 128) {
    const hash = pending.shift()!;
    if (visited.has(hash) || known.has(hash)) continue;
    const index = visited.size;
    visited.add(hash);
    if (Date.now() >= deadline) throw new Error("History chunk deadline reached");
    await bounded(beforeRead(hash, index));
    await bounded(authorize());
    const commit = await bounded(repo.readCommit(hash));
    await bounded(authorize());
    if (!commit) { missing.push(hash); continue; }
    if (commit.parents.length > 256) throw new HistoryMetadataLimitError();
    if (commit.hash !== hash || !HASH.test(commit.treeHash) || commit.parents.some(parent => !HASH.test(parent))) throw new Error("Invalid imported commit metadata");
    commits[hash] = { tree: commit.treeHash, parents: [...commit.parents] };
    pending.push(...commit.parents);
  }
  return { commits, missing };
}
/** Read only ancestry at a pinned head; never checks out or executes imported source. */
export async function captureArtifactsHistory(binding: HistoryBinding, name: string, branch: string, expectedHead: string): Promise<GitHistoryInventory | null> {
  if (!HASH.test(expectedHead) || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes("..") || branch.includes("//") || branch.endsWith(".lock")) throw new Error("Invalid import history scope");
  const deadline = Date.now() + 5000;
  const timeout = async <T>(operation: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("History inspection deadline")), Math.max(1, deadline - Date.now())); })]); }
    finally { if (timer) clearTimeout(timer); }
  };
  try {
    using repo = await timeout(binding.get(name));
    const ref = `refs/heads/${branch}`;
    if (!(await timeout(repo.readCommit(expectedHead)))) return null;
    const commits: GitHistoryInventory["commits"] = {};
    const seen = new Set<string>();
    const pending = [expectedHead];
    let incomplete = false;
    while (pending.length) {
      const hash = pending.pop()!;
      if (seen.has(hash)) continue;
      if (seen.size >= 1000 || Date.now() >= deadline) { incomplete = true; break; }
      seen.add(hash);
      const commit = await timeout(repo.readCommit(hash));
      if (!commit || commit.hash !== hash || !HASH.test(commit.treeHash) || commit.parents.some((parent) => !HASH.test(parent))) { incomplete = true; continue; }
      commits[hash] = { tree: commit.treeHash, parents: commit.parents };
      pending.push(...commit.parents);
    }
    if (!(await timeout(repo.readCommit(expectedHead)))) return null;
    return { refs: { [ref]: expectedHead }, commits, shallow: incomplete, capturedAt: new Date().toISOString() };
  } catch { return null; }
}
/** Source inventory must come from trusted native Git capture, never a submitted customer JSON body. */
export async function verifyImportedHistory(binding: HistoryBinding, name: string, branch: string, expectedHead: string, source: GitHistoryInventory | null): Promise<ImportHistoryResult> {
  if (!source) return { status: "unavailable", detail: "Source history was not captured. Native source capture currently supports only public github.com repositories without redirects; other hosts remain unverified. A readable imported head is not complete migration proof." };
  const destination = await captureArtifactsHistory(binding, name, branch, expectedHead);
  if (!destination) return { status: "unavailable", detail: "Imported history inspection is unavailable or its branch changed; retry without deleting the repository." };
  const receipt = compareMigrationHistory(source, destination, [`refs/heads/${branch}`]);
  if (receipt.status === "incomplete") return { status: "incomplete", detail: "History inspection reached a bound or missing ancestry; complete selected-branch migration remains unverified." };
  return { status: receipt.status, receipt, detail: receipt.detail };
}
