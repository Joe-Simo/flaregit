export interface CommentAnchor { path: string; line: number; commit: string }
export interface ConversationDraft { body: string; anchor: CommentAnchor | null; intent: { payload: string; key: string } | null }
interface Scope { identity: string; projectId: string; subject: string }
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const keyFor = (scope: Scope) => `flaregit.conversation.${JSON.stringify([scope.identity, scope.projectId, scope.subject])}`;
export function commentContent(subject: string, body: string, anchor: CommentAnchor | null) {
  return { subject, body: body.trim(), ...(anchor ? { path: anchor.path, line: anchor.line, commit: anchor.commit } : {}) };
}
export function reanchorConversationDraft(subject: string, draft: ConversationDraft, anchor: CommentAnchor): ConversationDraft {
  const payload = JSON.stringify(commentContent(subject, draft.body, anchor));
  return { ...draft, anchor, intent: draft.intent?.payload === payload ? draft.intent : null };
}
export async function dispatchRecoverableComment<T>(persist: () => boolean, dispatch: () => Promise<T>): Promise<T> {
  if (!persist()) throw new Error("The original comment request could not be saved in this browser session. Restore browser storage and retry; no comment was sent.");
  return dispatch();
}
export function readConversationDraft(storage: Storage, scope: Scope): ConversationDraft | null {
  try {
    const raw = storage.getItem(keyFor(scope));
    if (!raw || raw.length > 100_000) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const draft = value as Record<string, unknown>;
    if (draft.identity !== scope.identity || draft.projectId !== scope.projectId || draft.subject !== scope.subject || typeof draft.body !== "string" || draft.body.length > 10_000) return null;
    const anchor = draft.anchor as Partial<CommentAnchor> | null;
    if (anchor !== null && (!anchor || typeof anchor.path !== "string" || anchor.path.length > 4096 || !Number.isSafeInteger(anchor.line) || (anchor.line ?? 0) < 1 || typeof anchor.commit !== "string" || !/^[a-f0-9]{40}$/.test(anchor.commit))) return null;
    const checkedAnchor: CommentAnchor | null = anchor ? { path: anchor.path!, line: anchor.line!, commit: anchor.commit! } : null;
    const intent = draft.intent as { payload?: unknown; key?: unknown } | null;
    if (intent !== null && (!intent || typeof intent.key !== "string" || !/^[a-f0-9-]{36}$/.test(intent.key) || intent.payload !== JSON.stringify(commentContent(scope.subject, draft.body, checkedAnchor)))) return null;
    return { body: draft.body, anchor: checkedAnchor, intent: intent as ConversationDraft["intent"] };
  } catch { return null; }
}
export function saveConversationDraft(storage: Storage, scope: Scope, draft: ConversationDraft): boolean {
  try {
    const key=keyFor(scope),raw=JSON.stringify({ ...scope, ...draft });
    storage.setItem(key,raw);
    return storage.getItem(key)===raw;
  } catch { return false; }
}
export function clearConversationDraft(storage: Storage, scope: Scope): void {
  try { storage.removeItem(keyFor(scope)); } catch { /* Confirmed server save still succeeds. */ }
}
export function clearSessionConversationDrafts(identity: string): void {
  try {
    const prefix = `flaregit.conversation.[${JSON.stringify(identity)},`;
    const keys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index));
    for (const key of keys) if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
  } catch { /* Storage can be unavailable; other identities never restore this scope. */ }
}
