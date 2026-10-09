/** F04 slice: review drafts and anchored threads. Drafts stay private to their author until published. */

export const MAX_COMMENT_CHARACTERS = 65536;

export interface ThreadComment {
  readonly authorId: string;
  readonly body: string;
  readonly published: boolean;
}

export interface ReviewThread {
  readonly id: string;
  readonly path: string;
  readonly line: number;
  readonly comments: ThreadComment[];
  readonly resolved: boolean;
}

export type ThreadResult = { readonly ok: true; readonly thread: ReviewThread } | { readonly ok: false; readonly error: string };

/** Starts a thread on one line, or appends a draft to an existing thread. Drafts are unpublished and visible only to their author. */
export function addDraftComment(
  threads: readonly ReviewThread[],
  input: {readonly threadId?: string; readonly path?: string; readonly line?: number; readonly authorId: string; readonly body: unknown},
): ThreadResult {
  if (typeof input.body !== "string" || input.body.trim().length === 0) return {ok: false, error: "A comment needs text"};
  if (input.body.length > MAX_COMMENT_CHARACTERS) return {ok: false, error: `Comments are limited to ${MAX_COMMENT_CHARACTERS} characters`};
  const comment: ThreadComment = {authorId: input.authorId, body: input.body, published: false};
  if (input.threadId === undefined) {
    const path = input.path;
    const line = input.line;
    if (typeof path !== "string" || !path || path.includes("..") || path.startsWith("/")) return {ok: false, error: "Threads must be anchored to a repository-relative path"};
    if (typeof line !== "number" || !Number.isSafeInteger(line) || line < 1) return {ok: false, error: "Threads must be anchored to a line of at least 1"};
    return {ok: true, thread: {id: `thread-${threads.length + 1}`, path, line, comments: [comment], resolved: false}};
  }
  const existing = threads.find((thread) => thread.id === input.threadId);
  if (!existing) return {ok: false, error: "That thread does not exist"};
  return {ok: true, thread: {...existing, comments: [...existing.comments, comment]}};
}

/** Publishes only the given author's drafts in a thread; other authors' drafts stay private. */
export function publishDrafts(thread: ReviewThread, authorId: string): ThreadResult {
  const drafts = thread.comments.filter((comment) => comment.authorId === authorId && !comment.published);
  if (drafts.length === 0) return {ok: false, error: "There are no drafts to publish"};
  return {
    ok: true,
    thread: {...thread, comments: thread.comments.map((comment) => (comment.authorId === authorId && !comment.published ? {...comment, published: true} : comment))},
  };
}

/** Lists what a viewer may see: every published comment, plus their own drafts. */
export function visibleComments(thread: ReviewThread, viewerId: string | null): ThreadComment[] {
  return thread.comments.filter((comment) => comment.published || (viewerId !== null && comment.authorId === viewerId));
}

/** Resolves a thread; only someone who has published a comment in it may resolve it. */
export function resolveThread(thread: ReviewThread, actorId: string): ThreadResult {
  if (!thread.comments.some((comment) => comment.published && comment.authorId === actorId) && !thread.comments.some((comment) => comment.published)) {
    return {ok: false, error: "Only a participant can resolve a thread"};
  }
  if (thread.resolved) return {ok: false, error: "The thread is already resolved"};
  return {ok: true, thread: {...thread, resolved: true}};
}
