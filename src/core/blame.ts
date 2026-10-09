import {diffArrays} from "diff";

/** Line-level blame and file history over an in-memory, linear commit history. */

export const MAX_BLAME_LINES = 5000;
export const MAX_HISTORY_COMMITS = 1000;

export interface Commit {
  readonly sha: string;
  readonly parent: string | null;
  readonly author: string;
  readonly timestamp: string;
  /** Full file contents at this commit. A path with no entry is absent at this commit. */
  readonly files: Readonly<Record<string, string>>;
}

export interface BlameLine {
  readonly line: number;
  readonly text: string;
  readonly sha: string;
  readonly author: string;
  readonly timestamp: string;
}

type Failure = {readonly ok: false; readonly error: string};
export type BlameResult = {readonly ok: true; readonly lines: readonly BlameLine[]} | Failure;
export type FileHistoryResult = {readonly ok: true; readonly commits: readonly Commit[]} | Failure;
export type LineUrlResult = {readonly ok: true; readonly url: string} | Failure;

interface Pending {
  readonly line: number;
  readonly text: string;
  /** Index of this line within the version of the file the walk is currently examining. */
  readonly position: number;
}

/**
 * Attributes each line of `path` at `atSha` to the commit that introduced it. The walk moves from `atSha`
 * toward the root. At each step, lines not matched by the longest common subsequence against the parent's
 * version of the file were introduced by the child; lines still unexplained at the root were introduced there.
 */
export function blame(history: readonly Commit[], path: string, atSha: string): BlameResult {
  const linear = linearHistory(history);
  if (!linear.ok) return linear;
  const commits = linear.commits;

  const targetIndex = commits.findIndex((commit) => commit.sha === atSha);
  const target = commits[targetIndex];
  if (!target) return {ok: false, error: `Commit ${atSha} is not in the history`};
  if (contentOf(target, path) === undefined) return {ok: false, error: `${path} is absent at commit ${atSha}`};
  const targetFile = linesAt(target, path);
  if (!targetFile.ok) return targetFile;

  const resolved: BlameLine[] = [];
  let pending: Pending[] = targetFile.lines.map((text, index) => ({line: index + 1, text, position: index}));
  let childLines = targetFile.lines;
  for (let index = targetIndex; index > 0 && pending.length > 0; index--) {
    const child = commits[index];
    const parent = commits[index - 1];
    if (!child || !parent) break;
    const parentFile = linesAt(parent, path);
    if (!parentFile.ok) return parentFile;
    const parentOf = matchToParent(parentFile.lines, childLines);
    const stillUnexplained: Pending[] = [];
    for (const entry of pending) {
      const parentPosition = parentOf[entry.position] ?? -1;
      if (parentPosition >= 0) stillUnexplained.push({...entry, position: parentPosition});
      else resolved.push(attribute(entry, child));
    }
    pending = stillUnexplained;
    childLines = parentFile.lines;
  }

  const root = commits[0];
  if (!root) return {ok: false, error: "History is empty"};
  for (const entry of pending) resolved.push(attribute(entry, root));
  return {ok: true, lines: resolved.sort((a, b) => a.line - b.line)};
}

/**
 * Commits where the file's content differs from its parent's, newest first. Creating or deleting the file
 * counts as a change. Commits that only touch other paths are skipped.
 */
export function fileHistory(history: readonly Commit[], path: string): FileHistoryResult {
  const linear = linearHistory(history);
  if (!linear.ok) return linear;
  let previous: string | undefined;
  let everPresent = false;
  const changed: Commit[] = [];
  for (const commit of linear.commits) {
    const content = contentOf(commit, path);
    if (content !== undefined) everPresent = true;
    if (content !== previous) changed.push(commit);
    previous = content;
  }
  if (!everPresent) return {ok: false, error: `${path} does not exist in this history`};
  return {ok: true, commits: changed.reverse()};
}

/** Permalink to one line of a file at a commit. Refuses malformed shas, absolute or traversing paths and non-positive lines. */
export function lineUrl(repoBase: string, sha: string, path: string, line: number): LineUrlResult {
  if (!/^[a-f0-9]{40}$/.test(sha)) return {ok: false, error: "A permalink needs a full 40-character lowercase hex commit sha"};
  if (path === "" || path.startsWith("/") || path.includes("..")) return {ok: false, error: "A permalink needs a relative path without .."};
  if (!Number.isSafeInteger(line) || line < 1) return {ok: false, error: "A permalink needs a line number of at least 1"};
  const encodedPath = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return {ok: true, url: `${repoBase}/blob/${sha}/${encodedPath}#L${line}`};
}

/** Orders the history oldest first. Refuses oversized histories, duplicate or missing commits, forks and cycles. */
function linearHistory(history: readonly Commit[]): {readonly ok: true; readonly commits: readonly Commit[]} | Failure {
  if (history.length > MAX_HISTORY_COMMITS) return {ok: false, error: `History has ${history.length} commits; the limit is ${MAX_HISTORY_COMMITS}`};
  if (history.length === 0) return {ok: true, commits: []};
  const bySha = new Map<string, Commit>();
  for (const commit of history) {
    if (bySha.has(commit.sha)) return {ok: false, error: `Commit ${commit.sha} appears more than once`};
    bySha.set(commit.sha, commit);
  }
  const parentShas = new Set<string>();
  for (const commit of history) {
    if (commit.parent === null) continue;
    if (!bySha.has(commit.parent)) return {ok: false, error: `Commit ${commit.sha} has a parent that is not in the history`};
    parentShas.add(commit.parent);
  }
  const tip = history.filter((commit) => !parentShas.has(commit.sha));
  const newest = tip[0];
  if (tip.length !== 1 || !newest) return {ok: false, error: "History must be a single linear chain"};
  const newestFirst: Commit[] = [];
  const seen = new Set<string>();
  let cursor: Commit | undefined = newest;
  while (cursor) {
    if (seen.has(cursor.sha)) return {ok: false, error: "History contains a cycle"};
    seen.add(cursor.sha);
    newestFirst.push(cursor);
    cursor = cursor.parent === null ? undefined : bySha.get(cursor.parent);
  }
  if (newestFirst.length !== history.length) return {ok: false, error: "History must be a single linear chain"};
  return {ok: true, commits: newestFirst.reverse()};
}

/** The file's lines at a commit. An absent file has no lines. A file over the blame bound is refused. */
function linesAt(commit: Commit, path: string): {readonly ok: true; readonly lines: string[]} | Failure {
  const lines = splitLines(contentOf(commit, path) ?? "");
  if (lines.length > MAX_BLAME_LINES) return {ok: false, error: `${path} at commit ${commit.sha} has ${lines.length} lines; blame refuses files over ${MAX_BLAME_LINES}`};
  return {ok: true, lines};
}

function contentOf(commit: Commit, path: string): string | undefined {
  return Object.hasOwn(commit.files, path) ? commit.files[path] : undefined;
}

/** A trailing newline ends the last line rather than starting an empty one. */
function splitLines(content: string): string[] {
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** For each child line, the index of the parent line it matches in a longest common subsequence, or -1 when the child introduced it. */
function matchToParent(parentLines: string[], childLines: string[]): number[] {
  const matches = new Array<number>(childLines.length).fill(-1);
  let parentIndex = 0;
  let childIndex = 0;
  for (const change of diffArrays(parentLines, childLines)) {
    const count = change.value.length;
    if (change.added) {
      childIndex += count;
    } else if (change.removed) {
      parentIndex += count;
    } else {
      for (let offset = 0; offset < count; offset++) matches[childIndex + offset] = parentIndex + offset;
      parentIndex += count;
      childIndex += count;
    }
  }
  return matches;
}

function attribute(entry: Pending, commit: Commit): BlameLine {
  return {line: entry.line, text: entry.text, sha: commit.sha, author: commit.author, timestamp: commit.timestamp};
}
