/** F07 slice: discussion moderation and question/answer marking. */

export interface DiscussionComment {
  readonly id: string;
  readonly authorId: string;
  readonly body: string;
}

export interface Discussion {
  readonly category: "general" | "question";
  readonly authorId: string;
  readonly locked: boolean;
  readonly pinned: boolean;
  readonly answerId?: string;
  readonly comments: readonly DiscussionComment[];
}

export interface AuditEntry {
  readonly actorId: string;
  readonly action: "lock" | "unlock" | "pin" | "unpin";
}

export type DiscussionResult =
  | {readonly ok: true; readonly discussion: Discussion; readonly audit?: AuditEntry}
  | {readonly ok: false; readonly error: string};

/** Moderation is limited to maintainers and always produces an audit entry. */
export function moderate(discussion: Discussion, actorId: string, isMaintainer: boolean, action: AuditEntry["action"]): DiscussionResult {
  if (!isMaintainer) return {ok: false, error: "Only maintainers can moderate"};
  const next = {
    lock: {...discussion, locked: true},
    unlock: {...discussion, locked: false},
    pin: {...discussion, pinned: true},
    unpin: {...discussion, pinned: false},
  }[action];
  return {ok: true, discussion: next, audit: {actorId, action}};
}

/** Only the asker or a maintainer can mark an answer, and only in the question category. */
export function markAnswer(discussion: Discussion, actorId: string, isMaintainer: boolean, commentId: string): DiscussionResult {
  if (discussion.category !== "question") return {ok: false, error: "Only questions can have answers"};
  if (actorId !== discussion.authorId && !isMaintainer) return {ok: false, error: "Only the asker or a maintainer can mark an answer"};
  if (!discussion.comments.some((comment) => comment.id === commentId)) return {ok: false, error: "That comment does not exist"};
  return {ok: true, discussion: {...discussion, answerId: commentId}};
}

/** Locked discussions refuse new comments. */
export function reply(discussion: Discussion, comment: DiscussionComment): DiscussionResult {
  if (discussion.locked) return {ok: false, error: "This discussion is locked"};
  if (!comment.body.trim()) return {ok: false, error: "A comment needs text"};
  return {ok: true, discussion: {...discussion, comments: [...discussion.comments, comment]}};
}
