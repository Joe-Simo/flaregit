/** Revisioned snippets with explicit visibility. Revisions are append-only. */

export type Visibility = "public" | "secret" | "private";

export interface Revision {
  readonly number: number;
  readonly content: string;
}

export interface Snippet {
  readonly id: string;
  readonly ownerId: string;
  readonly visibility: Visibility;
  readonly revisions: readonly Revision[];
}

/** Visibility is always chosen explicitly; there is no default. */
export function createSnippet(id: string, ownerId: string, visibility: Visibility, content: string): Snippet {
  return {id, ownerId, visibility, revisions: [{number: 1, content}]};
}

/** Appends a new revision; earlier revisions are never modified or removed. */
export function addRevision(snippet: Snippet, content: string): Snippet {
  return {...snippet, revisions: [...snippet.revisions, {number: snippet.revisions.length + 1, content}]};
}

/** Listing for anyone but the owner shows public snippets only; the owner sees all of theirs. */
export function listFor(snippets: readonly Snippet[], viewerId: string | undefined, ownerId: string): Snippet[] {
  return snippets.filter((snippet) => snippet.ownerId === ownerId && (snippet.visibility === "public" || snippet.ownerId === viewerId));
}

/**
 * Raw access rules:
 * - the owner can always read;
 * - public snippets are readable by anyone;
 * - secret snippets are unlisted but readable by anyone who holds the link (`viaLink`);
 * - private snippets are readable by the owner only, link or not.
 */
export function canReadRaw(snippet: Snippet, viewerId: string | undefined, viaLink: boolean): boolean {
  if (snippet.ownerId === viewerId) return true;
  if (snippet.visibility === "public") return true;
  return snippet.visibility === "secret" && viaLink;
}

export function latest(snippet: Snippet): Revision {
  const last = snippet.revisions[snippet.revisions.length - 1];
  if (!last) throw new Error("A snippet always has at least one revision");
  return last;
}
