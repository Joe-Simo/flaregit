import type { ArtifactsRepoCapability } from "../artifacts/cloudflare.js";

export interface CommitInfo {
  hash: string;
  treeHash: string;
  message: string;
  author: { name: string; email: string };
  parents: string[];
  committedAt: number;
}

export interface TreeEntry {
  name: string;
  type: "blob" | "tree";
  hash: string;
  mode: string;
}

const HEX40 = /^[0-9a-f]{40}$/;
const MAX_BLOB_BYTES = 4 * 1024 * 1024;

const asCommit = (c: Record<string, any>): CommitInfo => ({
  hash: c.hash,
  treeHash: c.treeHash,
  message: String(c.message ?? ""),
  author: { name: c.author?.name ?? "", email: c.author?.email ?? "" },
  parents: c.parents ?? [],
  committedAt: c.committedAt ?? c.authoredAt ?? 0,
});

export async function listCommits(repo: ArtifactsRepoCapability, ref: string | undefined, limit: number, offset: number): Promise<CommitInfo[]> {
  const opts: Record<string, unknown> = { limit: Math.min(Math.max(limit, 1), 100), offset: Math.max(offset, 0) };
  if (ref && ref !== "HEAD") opts.ref = HEX40.test(ref) ? ref : ref;
  let rows = await repo.log(opts);
  if (rows.length === 0 && ref && !HEX40.test(ref) && !ref.startsWith("refs/")) rows = await repo.log({ ...opts, ref: `refs/heads/${ref}` });
  return rows.map(asCommit);
}

export async function resolveCommit(repo: ArtifactsRepoCapability, ref: string | undefined): Promise<CommitInfo | null> {
  if (ref && HEX40.test(ref)) {
    const c = await repo.readCommit(ref);
    return c ? asCommit(c) : null;
  }
  const [head] = await listCommits(repo, ref, 1, 0);
  return head ?? null;
}

const cleanPath = (path: string | undefined): string[] => {
  const parts = (path ?? "").split("/").filter(Boolean);
  if (parts.some((p) => p === ".." || p === ".")) throw new Error("Invalid path");
  return parts;
};

async function entriesAt(repo: ArtifactsRepoCapability, commit: CommitInfo, segments: string[]): Promise<TreeEntry[]> {
  let entries = (await repo.readTree(commit.treeHash)) as TreeEntry[] | null;
  if (!entries) throw new Error("Tree not found");
  for (const seg of segments) {
    const next = entries.find((e) => e.name === seg && e.type === "tree");
    if (!next) throw new Error("Path not found");
    entries = (await repo.readTree(next.hash)) as TreeEntry[] | null;
    if (!entries) throw new Error("Path not found");
  }
  return entries;
}

export async function listDirectory(repo: ArtifactsRepoCapability, commit: CommitInfo, path: string | undefined): Promise<TreeEntry[]> {
  const entries = await entriesAt(repo, commit, cleanPath(path));
  // Folders first, then files, each alphabetical (the order people expect from a code browser).
  return [...entries].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "tree" ? -1 : 1));
}

export async function readFileText(
  repo: ArtifactsRepoCapability,
  commit: CommitInfo,
  path: string
): Promise<{ binary: boolean; truncated: boolean; size: number; content: string }> {
  const segments = cleanPath(path);
  const name = segments.pop();
  if (!name) throw new Error("Path required");
  const entries = await entriesAt(repo, commit, segments);
  const entry = entries.find((e) => e.name === name && e.type === "blob");
  if (!entry) throw new Error("File not found");
  const blob = await repo.readBlob(entry.hash);
  if (!blob) throw new Error("File not found");
  if (blob.size > MAX_BLOB_BYTES) return { binary: false, truncated: true, size: blob.size, content: "" };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.subarray(0, 8000).includes(0)) return { binary: true, truncated: false, size: blob.size, content: "" };
  return { binary: false, truncated: false, size: blob.size, content: new TextDecoder().decode(bytes) };
}

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  aHash?: string;
  bHash?: string;
  mode?: string;
}

const MAX_CHANGED_FILES = 5000;

/** Tree-to-tree comparison using only hashes: unchanged subtrees are skipped without being read. */
export async function diffTrees(
  repo: ArtifactsRepoCapability,
  treeA: string | undefined,
  treeB: string | undefined,
  prefix = "",
  out: FileChange[] = []
): Promise<FileChange[]> {
  if (out.length > MAX_CHANGED_FILES) throw new Error("Diff exceeds the supported 5,000-file inspection limit; no complete diff was recorded");
  const [a, b] = await Promise.all([treeA ? repo.readTree(treeA) : Promise.resolve([]), treeB ? repo.readTree(treeB) : Promise.resolve([])]);
  if ((treeA && !a) || (treeB && !b)) throw new Error("Could not read a repository tree; retry the diff");
  const aMap = new Map((a ?? []).map((e) => [e.name, e as TreeEntry]));
  const bMap = new Map((b ?? []).map((e) => [e.name, e as TreeEntry]));
  const names = [...new Set([...aMap.keys(), ...bMap.keys()])].sort();
  for (const name of names) {
    const ea = aMap.get(name);
    const eb = bMap.get(name);
    const path = prefix ? `${prefix}/${name}` : name;
    if (ea && eb && ea.hash === eb.hash && ea.type === eb.type) continue;
    if (ea?.type === "tree" || eb?.type === "tree") {
      if (ea?.type === "tree" || eb?.type === "tree") {
        await diffTrees(repo, ea?.type === "tree" ? ea.hash : undefined, eb?.type === "tree" ? eb.hash : undefined, path, out);
      }
      if (ea?.type === "blob") out.push({ path, status: "deleted", aHash: ea.hash });
      if (eb?.type === "blob") out.push({ path, status: "added", bHash: eb.hash, mode: eb.mode });
      continue;
    }
    out.push({ path, status: !ea ? "added" : !eb ? "deleted" : "modified", aHash: ea?.hash, bHash: eb?.hash, mode: (eb ?? ea)?.mode });
    if (out.length > MAX_CHANGED_FILES) throw new Error("Diff exceeds the supported 5,000-file inspection limit; no complete diff was recorded");
  }
  if (out.length > MAX_CHANGED_FILES) throw new Error("Diff exceeds the supported 5,000-file inspection limit; no complete diff was recorded");
  return out;
}

export async function readBlobByHash(repo: ArtifactsRepoCapability, hash: string): Promise<{ binary: boolean; truncated: boolean; size: number; content: string }> {
  const blob = await repo.readBlob(hash);
  if (!blob) throw new Error("Blob not found");
  if (blob.size > MAX_BLOB_BYTES) return { binary: false, truncated: true, size: blob.size, content: "" };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.subarray(0, 8000).includes(0)) return { binary: true, truncated: false, size: blob.size, content: "" };
  return { binary: false, truncated: false, size: blob.size, content: new TextDecoder().decode(bytes) };
}
