/** Local wiki store: append-only page revisions with optimistic concurrency, paginated history, line diffs and reverts. */

export const MAX_BODY_CHARACTERS = 100_000;
export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 200;
export const MAX_DIFF_LINES = 2_000;

const SLUG_PATTERN = /^[a-z0-9-]{1,80}$/;

export interface WikiRevision {
  /** Sequential within a page, starting at 1. */
  readonly id: number;
  readonly slug: string;
  readonly author: string;
  readonly body: string;
  /** ISO 8601 time from the store's clock. */
  readonly timestamp: string;
  /** The revision this one was saved on top of, or null for a page's first revision. */
  readonly parentRevision: number | null;
}

export type WikiErrorCode =
  | "invalid-slug"
  | "invalid-author"
  | "invalid-body"
  | "invalid-revision"
  | "invalid-limit"
  | "invalid-cursor"
  | "not-found"
  | "conflict"
  | "diff-too-large";

export interface WikiFailure {
  readonly ok: false;
  readonly code: WikiErrorCode;
  readonly error: string;
}

export type WikiResult<T> = {readonly ok: true; readonly value: T} | WikiFailure;

export interface SaveRequest {
  readonly author: string;
  readonly body: string;
  /** The head revision the caller edited, or null when the page does not exist yet. */
  readonly expectedRevision: number | null;
}

export interface HistoryOptions {
  /** Revisions per page, from 1 to 200. Defaults to 50. */
  readonly limit?: number;
  /** Return only revisions with an id below this one. Pass the previous page's nextBefore. */
  readonly before?: number;
}

export interface HistoryPage {
  /** Newest first. */
  readonly revisions: readonly WikiRevision[];
  /** Pass as `before` to fetch the next older page, or null when this page reaches the first revision. */
  readonly nextBefore: number | null;
}

export interface LineDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly unchanged: readonly string[];
}

/**
 * The contract every wiki store implements. Methods are async so a durable store can replace the
 * in-memory one. `save` must check expectedRevision and append in one atomic step.
 */
export interface WikiStore {
  save(slug: string, request: SaveRequest): Promise<WikiResult<WikiRevision>>;
  history(slug: string, options?: HistoryOptions): Promise<WikiResult<HistoryPage>>;
  /** Returns the requested revision, or the head when no revision id is given. */
  read(slug: string, revisionId?: number): Promise<WikiResult<WikiRevision>>;
  diff(slug: string, fromRevision: number, toRevision: number): Promise<WikiResult<LineDiff>>;
  /** Appends a new revision that copies an older body. Existing history is never changed. */
  revert(slug: string, toRevision: number, actor: string): Promise<WikiResult<WikiRevision>>;
}

function failure(code: WikiErrorCode, error: string): WikiFailure {
  return {ok: false, code, error};
}

/** Lowercases the slug and rejects anything outside a-z, 0-9 and hyphens. Slashes, dots and whitespace are refused, which also blocks path traversal. */
export function normalizeSlug(input: string): WikiResult<string> {
  if (typeof input !== "string") return failure("invalid-slug", "A slug must be a string");
  const slug = input.toLowerCase();
  if (!SLUG_PATTERN.test(slug)) return failure("invalid-slug", "A slug is 1-80 characters of lowercase letters, digits and hyphens");
  return {ok: true, value: slug};
}

function checkAuthor(author: string): WikiFailure | null {
  return typeof author === "string" && author.trim() !== "" ? null : failure("invalid-author", "An author is required");
}

/** Counts code points, so an emoji is one character. Code points never outnumber UTF-16 units, so short bodies skip the count. */
function checkBody(body: string): WikiFailure | null {
  if (typeof body !== "string") return failure("invalid-body", "A page body must be a string");
  const tooLong = body.length > MAX_BODY_CHARACTERS && [...body].length > MAX_BODY_CHARACTERS;
  return tooLong ? failure("invalid-body", `A page body may be at most ${MAX_BODY_CHARACTERS} characters`) : null;
}

function isRevisionId(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

/** An empty body has no lines, so emptying a page removes lines instead of adding a blank one. */
function linesOf(body: string): string[] {
  return body === "" ? [] : body.split("\n");
}

/** Longest-common-subsequence diff over lines. Callers bound both sides, so the table of lengths fits in Uint16. */
function lineDiff(from: readonly string[], to: readonly string[]): LineDiff {
  const width = to.length + 1;
  // suffix[i * width + j] is the LCS length of from[i..] and to[j..].
  const suffix = new Uint16Array((from.length + 1) * width);
  const lcs = (i: number, j: number): number => suffix[i * width + j] ?? 0;
  for (let i = from.length - 1; i >= 0; i--) {
    for (let j = to.length - 1; j >= 0; j--) {
      suffix[i * width + j] = from[i] === to[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1));
    }
  }
  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];
  let i = 0;
  let j = 0;
  while (i < from.length && j < to.length) {
    if (from[i] === to[j]) {
      unchanged.push(from[i]!);
      i++;
      j++;
    } else if (lcs(i + 1, j) >= lcs(i, j + 1)) {
      removed.push(from[i]!);
      i++;
    } else {
      added.push(to[j]!);
      j++;
    }
  }
  while (i < from.length) removed.push(from[i++]!);
  while (j < to.length) added.push(to[j++]!);
  return {added, removed, unchanged};
}

export class InMemoryWikiStore implements WikiStore {
  private readonly pages = new Map<string, WikiRevision[]>();
  private readonly clock: () => Date;

  constructor(options: {readonly clock?: () => Date} = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  async save(slugInput: string, request: SaveRequest): Promise<WikiResult<WikiRevision>> {
    const slug = normalizeSlug(slugInput);
    if (!slug.ok) return slug;
    if (request.expectedRevision !== null && !isRevisionId(request.expectedRevision)) {
      return failure("invalid-revision", "expectedRevision must be null or a positive integer");
    }
    const problem = checkAuthor(request.author) ?? checkBody(request.body);
    if (problem) return problem;

    const revisions = this.pages.get(slug.value) ?? [];
    const head = revisions.at(-1)?.id ?? null;
    if (request.expectedRevision !== head) {
      return failure("conflict", `The page is at revision ${head ?? "none"}, but this save was based on ${request.expectedRevision ?? "none"}; reload and merge before saving`);
    }
    const revision: WikiRevision = Object.freeze({
      id: revisions.length + 1,
      slug: slug.value,
      author: request.author.trim(),
      body: request.body,
      timestamp: this.clock().toISOString(),
      parentRevision: head,
    });
    revisions.push(revision);
    this.pages.set(slug.value, revisions);
    return {ok: true, value: revision};
  }

  async history(slugInput: string, options: HistoryOptions = {}): Promise<WikiResult<HistoryPage>> {
    const slug = normalizeSlug(slugInput);
    if (!slug.ok) return slug;
    const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
      return failure("invalid-limit", `limit must be an integer from 1 to ${MAX_HISTORY_LIMIT}`);
    }
    if (options.before !== undefined && !isRevisionId(options.before)) return failure("invalid-cursor", "before must be a positive revision id");
    const revisions = this.pages.get(slug.value);
    if (!revisions) return failure("not-found", "That page does not exist");

    // Ids are index + 1, so the page covers indexes [start, newest) and its oldest id is start + 1.
    const newest = options.before === undefined ? revisions.length : Math.min(options.before - 1, revisions.length);
    const start = Math.max(0, newest - limit);
    return {ok: true, value: {revisions: revisions.slice(start, newest).reverse(), nextBefore: start > 0 ? start + 1 : null}};
  }

  async read(slugInput: string, revisionId?: number): Promise<WikiResult<WikiRevision>> {
    const slug = normalizeSlug(slugInput);
    if (!slug.ok) return slug;
    const revisions = this.pages.get(slug.value);
    if (!revisions) return failure("not-found", "That page does not exist");
    const id = revisionId ?? revisions.length;
    if (!isRevisionId(id)) return failure("invalid-revision", "A revision id is a positive integer");
    const revision = revisions[id - 1];
    return revision ? {ok: true, value: revision} : failure("not-found", `Revision ${id} does not exist`);
  }

  async diff(slugInput: string, fromRevision: number, toRevision: number): Promise<WikiResult<LineDiff>> {
    const slug = normalizeSlug(slugInput);
    if (!slug.ok) return slug;
    if (!isRevisionId(fromRevision) || !isRevisionId(toRevision)) return failure("invalid-revision", "A revision id is a positive integer");
    const revisions = this.pages.get(slug.value);
    if (!revisions) return failure("not-found", "That page does not exist");
    const from = revisions[fromRevision - 1];
    const to = revisions[toRevision - 1];
    if (!from || !to) return failure("not-found", "A revision in that diff does not exist");

    const fromLines = linesOf(from.body);
    const toLines = linesOf(to.body);
    if (fromLines.length > MAX_DIFF_LINES || toLines.length > MAX_DIFF_LINES) {
      return failure("diff-too-large", `A diff compares at most ${MAX_DIFF_LINES} lines per side`);
    }
    return {ok: true, value: lineDiff(fromLines, toLines)};
  }

  async revert(slugInput: string, toRevision: number, actor: string): Promise<WikiResult<WikiRevision>> {
    const slug = normalizeSlug(slugInput);
    if (!slug.ok) return slug;
    if (!isRevisionId(toRevision)) return failure("invalid-revision", "A revision id is a positive integer");
    const revisions = this.pages.get(slug.value);
    if (!revisions) return failure("not-found", "That page does not exist");
    const target = revisions[toRevision - 1];
    if (!target) return failure("not-found", `Revision ${toRevision} does not exist`);
    // Reading the head and appending happen in one synchronous step, so the head expected here is still current.
    return this.save(slug.value, {author: actor, body: target.body, expectedRevision: revisions.length});
  }
}
