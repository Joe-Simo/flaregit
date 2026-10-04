import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiJson } from "../api";
import { timeAgo } from "../router";

export interface Comment { id: number; author: string; body: string; path: string | null; line: number | null; commit: string | null; created_at: string }

interface CommentPage { comments: Comment[]; nextCursor: string | null; hasMore: boolean }

const alertCls = "rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive";

/** One conversation thread (issue, change or candidate). Comments can be anchored to a file line from the diff. */
export function Conversation({ projectId, subject, anchor, onAnchorUsed, onLoaded, title }: {
  projectId: string;
  /** Renders a heading for the thread; omit when the caller already provides one. */
  title?: string;
  subject: string;
  anchor?: { path: string; line: number; commit: string } | null;
  onAnchorUsed?: () => void;
  onLoaded?: (comments: Comment[]) => void;
}) {
  const currentCursor = useRef<string | null>(null);
  const [newerCursors, setNewerCursors] = useState<(string | null)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const requestIntent = useRef<{ payload: string; key: string } | null>(null);
  const sending = useRef(false), pageLock = useRef(false);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const draftId = useId();
  const anchorId = useId();
  const draftInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (anchor) draftInput.current?.focus({ preventScroll: true });
  }, [anchor?.path, anchor?.line, anchor?.commit]);
  const lifetime = useRef(0);
  const readSequence = useRef(0);
  useEffect(() => { lifetime.current++; return () => { lifetime.current++; readSequence.current++; }; }, [projectId, subject]);

  const load = useCallback(async () => {
    const generation = lifetime.current, sequence = ++readSequence.current;
    setLoadError(null);
    try {
      const page = await apiJson<CommentPage>(`/p/${projectId}/comments?subject=${encodeURIComponent(subject)}&page=1`);
      const c = page.comments;
      if (generation !== lifetime.current || sequence !== readSequence.current) return;
      setComments(c); setNextCursor(page.nextCursor); setNewerCursors([]); currentCursor.current = null; setPageError(null);
    } catch (e) {
      if (generation === lifetime.current && sequence === readSequence.current) setLoadError(e instanceof Error ? e.message : "Could not load comments");
    }
  }, [projectId, subject]);
  useEffect(() => { if (comments) onLoaded?.(comments); }, [comments, onLoaded]);
  useEffect(() => { void load(); }, [load]);

  const loadPage = async (direction: "older" | "newer") => {
    if (pageLock.current || (direction === "older" ? !nextCursor : newerCursors.length === 0)) return;
    const cursor = direction === "older" ? nextCursor : newerCursors.at(-1) ?? null, generation = lifetime.current, sequence = readSequence.current;
    pageLock.current = true; setPaging(true); setPageError(null);
    try {
      const page = await apiJson<CommentPage>(`/p/${projectId}/comments?subject=${encodeURIComponent(subject)}&page=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (generation !== lifetime.current || sequence !== readSequence.current) return;
      setComments(page.comments);
      const previousCursor = currentCursor.current;
      setNewerCursors(previous => direction === "older" ? [...previous, previousCursor] : previous.slice(0, -1));
      currentCursor.current = cursor; setNextCursor(page.nextCursor);
    } catch { if (generation === lifetime.current && sequence === readSequence.current) setPageError("This comment page could not be loaded. Your current conversation and draft are preserved; retry this page."); }
    finally { pageLock.current = false; if (generation === lifetime.current) setPaging(false); }
  };

  const send = async () => {
    if (sending.current || !draft.trim()) return;
    const content = { subject, body: draft.trim(), ...(anchor ? { path: anchor.path, line: anchor.line, commit: anchor.commit } : {}) };
    const payload = JSON.stringify(content);
    if (requestIntent.current?.payload !== payload) requestIntent.current = { payload, key: crypto.randomUUID() };
    const idempotencyKey = requestIntent.current.key; sending.current = true;
    const generation = lifetime.current;
    readSequence.current++;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiJson<Comment>(`/p/${projectId}/comments`, { method: "POST", json: { ...content, idempotencyKey } });
      if (generation !== lifetime.current) return;
      requestIntent.current = null; setDraft("");
      setSaved(true);
      onAnchorUsed?.();
      await load();
    } catch (e) {
      if (generation === lifetime.current) setError(`Comment save could not be confirmed. Your draft is preserved; retrying unchanged content reuses the same request. ${e instanceof Error ? e.message : ""}`);
    } finally {
      sending.current = false;
      if (generation === lifetime.current) setSaving(false);
    }
  };

  return (
    <section aria-label={title ?? "Conversation"} className="space-y-3 min-w-0">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {loadError && (
        <div role="alert" className={`${alertCls} flex flex-wrap items-center justify-between gap-2`}>
          <span className="break-words min-w-0">{loadError}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
        </div>
      )}
      {comments === null && !loadError && <p role="status" className="text-sm text-muted-foreground">Loading comments…</p>}
      {comments && <div className="flex flex-wrap gap-2 items-center"><Button type="button" variant="ghost" size="sm" disabled={saving || paging} onClick={() => void load()}>Refresh latest comments</Button>{nextCursor && <Button type="button" variant="outline" size="sm" disabled={paging || saving} onClick={() => void loadPage("older")}>{paging ? "Loading comments…" : pageError ? "Retry older comments" : "Load older comments"}</Button>}{newerCursors.length > 0 && <Button type="button" variant="outline" size="sm" disabled={paging || saving} onClick={() => void loadPage("newer")}>Newer comments</Button>}{nextCursor && <p className="text-xs text-muted-foreground">Older comments are available. Showing up to 100 comments per page.</p>}</div>}
      {pageError && <p role="alert" className={alertCls}>{pageError}</p>}
      {comments && (
        <ol className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border border-border p-3 text-sm">
              <div className="text-xs text-muted-foreground mb-1 break-words">
                <span className="font-medium text-foreground">{c.author}</span> · {timeAgo(c.created_at)}
                {c.path && <> · <code className="break-all">{c.path}{c.line ? `:${c.line}` : ""}</code></>}
                {c.commit && <> · <code title={c.commit}>{c.commit.slice(0, 7)}</code></>}
              </div>
              <p className="whitespace-pre-wrap break-words">{c.body}</p>
            </li>
          ))}
          {comments.length === 0 && <li className="text-sm text-muted-foreground">No comments yet.</li>}
        </ol>
      )}
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        {anchor && (
          <p id={anchorId} className="text-xs text-muted-foreground break-all">Commenting on <code>{anchor.path}:{anchor.line}</code> at <code title={anchor.commit}>{anchor.commit.slice(0, 7)}</code> <button type="button" className="underline" onClick={onAnchorUsed}>clear</button></p>
        )}
        <label htmlFor={draftId} className="sr-only">Comment</label>
        <textarea ref={draftInput} id={draftId} aria-describedby={anchor ? anchorId : undefined} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" rows={3} maxLength={10000} value={draft} disabled={saving}
          onChange={(e) => { setDraft(e.target.value); setSaved(false); }}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
          placeholder="Write a comment (⌘/Ctrl+Enter to send)" />
        {error && <div role="alert" className={alertCls}>{error}</div>}
        {saved && <p role="status" className="text-xs text-emerald-300">Comment posted.</p>}
        <Button type="submit" size="sm" disabled={saving || !draft.trim()}>{saving ? "Saving…" : "Comment"}</Button>
      </form>
    </section>
  );
}
