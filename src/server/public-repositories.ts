import type { ArtifactsRepoCapability } from "../artifacts/cloudflare.js";
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
const validatePath = (path: string) => {
  if (path.length > 4096 || /[\x00-\x1f\x7f\\]/.test(path) || path.startsWith("/") || path.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("Invalid repository path");
  }
};

/** Read-only projection. Never returns capabilities, connection settings or private task context.
 * The caller must obtain the grant from durable repository state, never request JSON.
 * No filename filter can make publishing committed secrets safe: owner confirmation covers all history.
 */
export async function readPublicRepository(
  repo: ArtifactsRepoCapability,
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
  if (request.kind === "directory" || request.kind === "file") validatePath(request.path ?? "");
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
