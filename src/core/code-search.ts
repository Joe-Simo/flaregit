/** F03 slice: permission-filtered code search with explicit paging and no silent truncation. */

export const CODE_SEARCH_MAX_QUERY = 200;
export const CODE_SEARCH_PAGE_SIZE = 50;
export const CODE_SEARCH_MAX_MATCHES = 1000;

export type FileAccess = "members" | "owner";

export interface SearchableFile {
  readonly path: string;
  readonly text: string;
  readonly access: FileAccess;
}

export interface SearchActor {
  readonly role: "owner" | "member" | null;
}

export interface CodeMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export type CodeSearchResult =
  | {
      readonly ok: true;
      readonly matches: CodeMatch[];
      readonly nextCursor: string | null;
      /** True only when every visible file was scanned and no limit was reached. */
      readonly complete: boolean;
      readonly reason: string | null;
      readonly scannedFiles: number;
    }
  | { readonly ok: false; readonly status: 400; readonly error: string };

/** Accepts a literal, case-insensitive query. Empty and over-long queries are refused. */
export function validateCodeSearchQuery(query: unknown): { readonly ok: true; readonly query: string } | { readonly ok: false; readonly error: string } {
  if (typeof query !== "string") return {ok: false, error: "A search query is required"};
  const trimmed = query.trim();
  if (trimmed.length === 0) return {ok: false, error: "A search query is required"};
  if (trimmed.length > CODE_SEARCH_MAX_QUERY) return {ok: false, error: `Search queries are limited to ${CODE_SEARCH_MAX_QUERY} characters`};
  return {ok: true, query: trimmed.toLowerCase()};
}

function visibleTo(file: SearchableFile, actor: SearchActor): boolean {
  if (file.access === "members") return actor.role === "owner" || actor.role === "member";
  return actor.role === "owner";
}

/**
 * Searches only files the actor may read. Results are ordered by path then line, paged by an offset cursor, and capped:
 * when a cap is reached the response says so, so callers never mistake a partial result for a complete one.
 */
export function searchCode(input: {
  files: readonly SearchableFile[];
  query: unknown;
  actor: SearchActor;
  cursor?: string | null;
}): CodeSearchResult {
  const valid = validateCodeSearchQuery(input.query);
  if (!valid.ok) return {ok: false, status: 400, error: valid.error};
  const visible = input.files.filter((file) => visibleTo(file, input.actor)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const all: CodeMatch[] = [];
  let capped = false;
  for (const file of visible) {
    const lines = file.text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index]!.toLowerCase().includes(valid.query)) continue;
      if (all.length >= CODE_SEARCH_MAX_MATCHES) {
        capped = true;
        break;
      }
      all.push({path: file.path, line: index + 1, text: lines[index]!});
    }
    if (capped) break;
  }
  const start = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
  if (!Number.isSafeInteger(start) || start < 0 || start > all.length) return {ok: false, status: 400, error: "The search cursor is not valid"};
  const page = all.slice(start, start + CODE_SEARCH_PAGE_SIZE);
  const more = start + CODE_SEARCH_PAGE_SIZE < all.length;
  const nextCursor = more ? String(start + CODE_SEARCH_PAGE_SIZE) : null;
  const complete = !capped && !more;
  const reason = capped ? `Only the first ${CODE_SEARCH_MAX_MATCHES} matches are returned; narrow the query` : null;
  return {ok: true, matches: page, nextCursor, complete, reason, scannedFiles: visible.length};
}
