import React, { useCallback, useEffect, useState } from "react";
import { apiJson } from "../api";
import { navigate, timeAgo } from "../router";
import {Button} from "@/components/ui/button";
import {inboxDestination,inboxShortcutAllowed,INBOX_INTERACTIVE_TARGETS} from "../inbox-navigation";

interface Item { id: number; project_id: string; project_name: string; kind: "direct" | "activity"; type: string; title: string; created_at: string }
type Filter = "direct" | "activity" | "snoozed" | "archived";
const FILTERS: Array<[Filter, string]> = [["direct", "Needs you"], ["activity", "Activity"], ["snoozed", "Snoozed"], ["archived", "Archived"]];

/** Keyboard-first triage: j/k move, e archives, s snoozes until the next activity in that repository, Enter opens. */
export function Inbox({ onCount }: { onCount: (n: number) => void }) {
  const [filter, setFilter] = useState<Filter>("direct");
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiJson<{ items: Item[]; unread: { direct: number } }>(`/inbox?filter=${filter}`)
      .then((r) => { setItems(r.items); onCount(r.unread.direct); setCursor((c) => Math.min(c, Math.max(0, r.items.length - 1))); })
      .catch((e: Error) => setError(e.message));
  }, [filter, onCount]);
  useEffect(load, [load]);

  const act = useCallback(async (item: Item | undefined, state: "archived" | "snoozed" | "unread") => {
    if (!item) return;
    setItems((cur) => cur.filter((i) => i.id !== item.id)); // optimistic
    await apiJson(`/inbox/${item.id}`, { method: "POST", json: { state } }).catch(() => load());
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!inboxShortcutAllowed(e,e.target instanceof Element&&!!e.target.closest(INBOX_INTERACTIVE_TARGETS))) return;
      const item = items[cursor];
      if (e.key === "j") setCursor((c) => Math.min(c + 1, Math.max(0,items.length - 1)));
      else if (e.key === "k") setCursor((c) => Math.max(c - 1, 0));
      else if (e.key === "e") void act(item, "archived");
      else if (e.key === "s") void act(item, "snoozed");
      else if (e.key === "u") void act(item, "unread");
      else if (e.key === "Enter" && item) { e.preventDefault(); navigate(inboxDestination(item)); }
      else if (e.key >= "1" && e.key <= "4") { setFilter(FILTERS[Number(e.key) - 1]![0]); setCursor(0); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, cursor, act]);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4">
      <h1 className="text-xl font-bold">Inbox</h1>
      {error && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
      <div className="flex gap-1 text-sm" role="tablist">
        {FILTERS.map(([key, label], i) => (
          <button key={key} role="tab" aria-selected={filter === key} className={`px-3 py-1 rounded-md ${filter === key ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`} onClick={() => { setFilter(key); setCursor(0); }}>
            {label} <kbd className="text-xs opacity-60">{i + 1}</kbd>
          </button>
        ))}
      </div>
      <div className="divide-y divide-border rounded-md border border-border" aria-label="Notifications">
        {items.length === 0 && <p className="px-3 py-6 text-sm text-center text-muted-foreground">{filter === "direct" ? "Inbox zero. Nothing needs you." : "Nothing here."}</p>}
        {items.map((it, i) => (
          <div key={it.id} className={`px-3 py-2 flex items-center gap-3 text-sm ${i === cursor ? "bg-muted/60" : ""}`} onClick={() => setCursor(i)}>
            <div className="min-w-0 flex-1">
              <div className="truncate">{it.title}</div>
              <div className="text-xs text-muted-foreground">{it.project_name} · {timeAgo(it.created_at)}</div>
            </div>
            <div className="flex gap-1 shrink-0">
              <Button size="sm" variant="ghost" onClick={(e)=>{e.stopPropagation();navigate(inboxDestination(it));}} aria-label={`Open ${it.title}`}>Open</Button>
              <button className="px-2 py-1 rounded border border-border text-xs hover:bg-muted" onClick={(e) => { e.stopPropagation(); void act(it, "archived"); }}>Archive</button>
              {filter !== "snoozed" && <button className="px-2 py-1 rounded border border-border text-xs hover:bg-muted" onClick={(e) => { e.stopPropagation(); void act(it, "snoozed"); }}>Snooze</button>}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground"><kbd>j</kbd>/<kbd>k</kbd> move · <kbd>e</kbd> archive · <kbd>s</kbd> snooze until the next activity in that repository · <kbd>u</kbd> move back · <kbd>Enter</kbd> open · <kbd>1</kbd>–<kbd>4</kbd> switch list</p>
    </div>
  );
}
