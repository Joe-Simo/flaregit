import { isSafeRef } from "../core/sanitize.js";
import type { RepositoryReadCapability } from "./repository-read-budget.js";
import { diffTrees, listCommits, listDirectory, readFileText, type CommitInfo } from "./browse.js";

/** Stored only after an authenticated owner confirms that accepted source and history become public. */
export interface PublicRepositoryGrant {
  visibility: "public";
  confirmedByOwner: true;
  acceptedCommit: string;
}
export type PublicBrowseRequest =
  | { kind: "history"; offset?: number; limit?: number }
  | { kind: "directory"; commit?: string; path?: string }
  | { kind: "file"; commit?: string; path: string }
  | { kind: "diff"; from: string; to: string };

const HASH = /^[0-9a-f]{40}$/;
const MAX_HISTORY_INSPECTION = 1000;
const publicCommit = ({ hash, treeHash, message, author, parents, committedAt }: CommitInfo) => ({
  hash, treeHash, message, author: { name: author.name }, parents, committedAt,
});
export class RepositoryBrowseRequestError extends Error {
  constructor(message: string, readonly status: 400 | 413 = 400) { super(message); }
}
export const validateRepositoryPath = (path: string) => {
  if (path.length > 4096) throw new RepositoryBrowseRequestError("Repository path exceeds the supported request size", 413);
  if ( /[\x00-\x1f\x7f\\]/.test(path) || path.startsWith("/") || path.split("/").some((part) => part === "." || part === "..")) {
    throw new RepositoryBrowseRequestError("Invalid repository path");
  }
};

/** Read-only projection. Never returns capabilities, connection settings or private task context.
 * The caller must obtain the grant from durable repository state, never request JSON.
 * No filename filter can make publishing committed secrets safe: owner confirmation covers all history.
 */
export async function readPublicRepository(
  repo: RepositoryReadCapability,
  grant: PublicRepositoryGrant | null | undefined,
  request: PublicBrowseRequest,
) {
  if (grant?.visibility !== "public" || grant.confirmedByOwner !== true || !HASH.test(grant.acceptedCommit)) {
    throw new Error("Repository not found");
  }
  if (request.kind === "history") {
    const offset = request.offset ?? 0;
    const limit = request.limit ?? 30;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid history pagination");
    return { kind: "history" as const, acceptedCommit: grant.acceptedCommit, commits: (await listCommits(repo, grant.acceptedCommit, limit, offset)).map(publicCommit) };
  }
  const refs = request.kind === "diff" ? [request.from, request.to] : [request.commit ?? grant.acceptedCommit];
  if (refs.some((ref) => !HASH.test(ref))) throw new Error("An immutable accepted-history commit is required");
  if (request.kind === "directory" || request.kind === "file") validateRepositoryPath(request.path ?? "");
  // Raw readCommit(hash) would disclose unaccepted/hidden objects. Resolve only through accepted ancestry.
  const commits = new Map<string, CommitInfo>();
  for (let offset = 0; offset < MAX_HISTORY_INSPECTION; offset += 100) {
    const page = await listCommits(repo, grant.acceptedCommit, 100, offset);
    for (const commit of page) if (refs.includes(commit.hash)) commits.set(commit.hash, commit);
    if (refs.every((ref) => commits.has(ref))) break;
    if (page.length < 100) break;
  }
  const first = commits.get(refs[0]!);
  if (!first || refs.some((ref) => !commits.has(ref))) throw new Error("Commit unavailable in the supported accepted-history inspection window");
  if (request.kind === "directory") return { kind: "directory" as const, commit: first.hash, entries: await listDirectory(repo, first, request.path) };
  if (request.kind === "file") return { kind: "file" as const, commit: first.hash, file: await readFileText(repo, first, request.path) };
  const second = commits.get(request.to)!;
  return { kind: "diff" as const, from: first.hash, to: second.hash, changes: await diffTrees(repo, first.treeHash, second.treeHash) };
}

/** Exact allowlist for unauthenticated HTTP requests; unknown and duplicate query keys fail closed. */
export function parsePublicBrowseRequest(kind: string, query: URLSearchParams): PublicBrowseRequest | { kind: "meta" } {
  const keys: Record<string, readonly string[]> = { meta: [], history: ["offset", "limit"], tree: ["commit", "path"], file: ["commit", "path"], diff: ["from", "to"] };
  const allowed = keys[kind];
  if (!allowed) throw new Error("Unsupported public route");
  for (const key of query.keys()) if (!allowed.includes(key) || query.getAll(key).length !== 1) throw new Error("Invalid public query");
  const commit = query.get("commit") ?? undefined;
  if (commit !== undefined && !HASH.test(commit)) throw new Error("Invalid commit");
  if (kind === "meta") return { kind: "meta" };
  if (kind === "history") {
    const integer = (key: string, fallback: number) => {
      const raw = query.get(key);
      if (raw === null) return fallback;
      if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw new Error("Invalid history pagination");
      const value = Number(raw);
      if (!Number.isSafeInteger(value)) throw new Error("Invalid history pagination");
      return value;
    };
    const offset = integer("offset", 0);
    const limit = integer("limit", 30);
    if (limit < 1) throw new RepositoryBrowseRequestError("Invalid history pagination");
    if (limit > 100 || offset > 1_000_000) throw new RepositoryBrowseRequestError("History pagination exceeds the supported request size", 413);
    return { kind: "history", offset, limit };
  }
  if (kind === "diff") {
    const from = query.get("from") ?? "";
    const to = query.get("to") ?? "";
    if (!HASH.test(from) || !HASH.test(to)) throw new Error("Exact diff commits required");
    return { kind: "diff", from, to };
  }
  const path = query.get("path") ?? "";
  validateRepositoryPath(path);
  if (kind === "file") {
    if (!path) throw new Error("File path required");
    return { kind: "file", commit, path };
  }
  return { kind: "directory", commit, path };
}

export type SignedRepositoryBrowseRequest =
  | { kind: "history"; ref?: string; limit: number; offset: number }
  | { kind: "directory"; ref?: string; path: string }
  | { kind: "file"; ref?: string; path: string }
  | { kind: "diff"; commit?: string; task?: string; candidate?: string }
  | { kind: "blob"; hash: string; task?: string };

/** Validate the complete request before acquiring a provider capability. */
export function parseSignedRepositoryBrowseRequest(route: string, query: URLSearchParams): SignedRepositoryBrowseRequest {
  const keys: Record<string, readonly string[]> = {
    "/commits": ["ref", "limit", "offset"], "/tree": ["ref", "path"], "/blob": ["ref", "path"],
    "/diff": ["commit", "task", "candidate"], "/blob-by-hash": ["hash", "task"],
  };
  const allowed = keys[route];
  if (!allowed) throw new RepositoryBrowseRequestError("Unsupported repository read");
  for (const key of query.keys()) if (!allowed.includes(key) || query.getAll(key).length !== 1) throw new RepositoryBrowseRequestError("Invalid repository query");
  const ref = query.get("ref") ?? undefined;
  if (ref !== undefined && !isSafeRef(ref)) throw new RepositoryBrowseRequestError("Invalid ref");
  const integer = (key: string, fallback: number, maximum: number) => {
    const raw = query.get(key);
    if (raw === null) return fallback;
    if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw new RepositoryBrowseRequestError("Invalid history pagination");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value > maximum) throw new RepositoryBrowseRequestError("History pagination exceeds the supported request size", 413);
    return value;
  };
  if (route === "/commits") {
    const limit = integer("limit", 30, 100), offset = integer("offset", 0, 1_000_000);
    if (limit < 1) throw new RepositoryBrowseRequestError("Invalid history pagination");
    return { kind: "history", ref, limit, offset };
  }
  if (route === "/tree" || route === "/blob") {
    const path = query.get("path") ?? "";
    validateRepositoryPath(path);
    if (route === "/blob" && !path) throw new RepositoryBrowseRequestError("File path required");
    return { kind: route === "/tree" ? "directory" : "file", ref, path };
  }
  const task = query.get("task") ?? undefined;
  const candidate = query.get("candidate") ?? undefined;
  const commit = query.get("commit") ?? undefined;
  if ([task, candidate].some((id) => id !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/.test(id))) throw new RepositoryBrowseRequestError("Invalid contribution identity");
  if (route === "/blob-by-hash") {
    const hash = query.get("hash") ?? "";
    if (!HASH.test(hash)) throw new RepositoryBrowseRequestError("Invalid hash");
    return { kind: "blob", hash, task };
  }
  if ([commit, task, candidate].filter((value) => value !== undefined).length !== 1 || (commit !== undefined && !/^[0-9a-f]{7,40}$/.test(commit))) throw new RepositoryBrowseRequestError("Pass one commit, change or candidate for comparison");
  return { kind: "diff", commit, task, candidate };
}
