import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiJson } from "../api";
import { timeAgo } from "../router";

export interface Comment { id: number; author: string; body: string; path: string | null; line: number | null; commit: string | null; created_at: string }

/** One conversation thread (issue, change or candidate). Comments can be anchored to a file line from the diff. */
export function Conversation({ projectId, subject, anchor, onAnchorUsed, onLoaded }: {
  projectId: string;
  subject: string;
  anchor?: { path: string; line: number } | null;
  onAnchorUsed?: () => void;
  onLoaded?: (comments: Comment[]) => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiJson<Comment[]>(`/p/${projectId}/comments?subject=${encodeURIComponent(subject)}`)
      .then((c) => { setComments(c); onLoaded?.(c); })
      .catch((e: Error) => setError(e.message));
  }, [projectId, subject, onLoaded]);
  useEffect(load, [load]);

  const send = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiJson(`/p/${projectId}/comments`, { method: "POST", json: { subject, body: draft, ...(anchor ? { path: anchor.path, line: anchor.line } : {}) } });
      setDraft("");
      onAnchorUsed?.();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Comment not saved");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Conversation" className="space-y-3">
      <ol className="space-y-2">
        {comments.map((c) => (
          <li key={c.id} className="rounded-md border border-border p-3 text-sm">
            <div className="text-xs text-muted-foreground mb-1">
              <span className="font-medium text-foreground">{c.author}</span> · {timeAgo(c.created_at)}
              {c.path && <> · <code>{c.path}{c.line ? `:${c.line}` : ""}</code></>}
              {c.commit && <> · <code>{c.commit.slice(0, 7)}</code></>}
            </div>
            <p className="whitespace-pre-wrap break-words">{c.body}</p>
          </li>
        ))}
        {comments.length === 0 && <li className="text-sm text-muted-foreground">No comments yet.</li>}
      </ol>
      <div className="space-y-2">
        {anchor && (
          <p className="text-xs text-muted-foreground">Commenting on <code>{anchor.path}:{anchor.line}</code> <button className="underline" onClick={onAnchorUsed}>clear</button></p>
        )}
        <textarea className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" rows={3} maxLength={10000} value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) void send(); }}
          placeholder="Write a comment (⌘/Ctrl+Enter to send)" aria-label="Comment" />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button size="sm" disabled={saving || !draft.trim()} onClick={send}>{saving ? "Saving…" : "Comment"}</Button>
      </div>
    </section>
  );
}
