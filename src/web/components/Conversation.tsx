import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiJson } from "../api";
import { timeAgo } from "../router";

export interface Comment { id: number; author: string; body: string; path: string | null; line: number | null; commit: string | null; created_at: string }

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
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const draftId = useId();
  const lifetime = useRef(0);
  const readSequence = useRef(0);
  useEffect(() => { lifetime.current++; return () => { lifetime.current++; readSequence.current++; }; }, [projectId, subject]);

  const load = useCallback(async () => {
    const generation = lifetime.current, sequence = ++readSequence.current;
    setLoadError(null);
    try {
      const c = await apiJson<Comment[]>(`/p/${projectId}/comments?subject=${encodeURIComponent(subject)}`);
      if (generation !== lifetime.current || sequence !== readSequence.current) return;
      setComments(c);
      onLoaded?.(c);
    } catch (e) {
      if (generation === lifetime.current && sequence === readSequence.current) setLoadError(e instanceof Error ? e.message : "Could not load comments");
    }
  }, [projectId, subject, onLoaded]);
  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    if (saving || !draft.trim()) return;
    const generation = lifetime.current;
    readSequence.current++;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiJson(`/p/${projectId}/comments`, { method: "POST", json: { subject, body: draft, ...(anchor ? { path: anchor.path, line: anchor.line, commit: anchor.commit } : {}) } });
      if (generation !== lifetime.current) return;
      setDraft("");
      setSaved(true);
      onAnchorUsed?.();
      await load();
    } catch (e) {
      if (generation === lifetime.current) setError(e instanceof Error ? e.message : "Comment result is unknown. Your draft remains available.");
    } finally {
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
          <p className="text-xs text-muted-foreground break-all">Commenting on <code>{anchor.path}:{anchor.line}</code> at <code title={anchor.commit}>{anchor.commit.slice(0, 7)}</code> <button type="button" className="underline" onClick={onAnchorUsed}>clear</button></p>
        )}
        <label htmlFor={draftId} className="sr-only">Comment</label>
        <textarea id={draftId} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" rows={3} maxLength={10000} value={draft}
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
