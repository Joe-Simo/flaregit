import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiJson } from "../api";
import { navigate, timeAgo } from "../router";
import {RepositoryNotifications} from "../components/RepositoryNotifications";
import {Button} from "@/components/ui/button";
import {Tabs,TabsContent,TabsList,TabsTrigger} from "@/components/ui/tabs";
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

  const requestSequence=useRef(0),requestController=useRef<AbortController|null>(null),activeFilter=useRef(filter);
  activeFilter.current=filter;
  const [loading,setLoading]=useState(false);
  const load = useCallback(() => {
    if(activeFilter.current!==filter)return;
    const sequence=++requestSequence.current;requestController.current?.abort();const controller=new AbortController();requestController.current=controller;
    setItems([]);setError(null);setLoading(true);onCount(0);
    void apiJson<{ items: Item[]; unread: { direct: number } }>(`/inbox?filter=${filter}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])})
      .then((r) => {if(sequence!==requestSequence.current||activeFilter.current!==filter)return;setItems(r.items);onCount(r.unread.direct);setCursor((c)=>Math.min(c,Math.max(0,r.items.length-1)));})
      .catch((e: Error) => {if(sequence!==requestSequence.current||controller.signal.aborted)return;setItems([]);onCount(0);setError(e.message);})
      .finally(()=>{if(sequence===requestSequence.current)setLoading(false);});
  }, [filter, onCount]);
  useEffect(()=>{load();return()=>{requestSequence.current++;requestController.current?.abort();};}, [load]);

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
      <Tabs value={filter} onValueChange={value=>{const next=FILTERS.find(([key])=>key===value)?.[0];if(next){setFilter(next);setCursor(0);}}}>
      <TabsList className="flex w-full sm:w-fit">
        {FILTERS.map(([key, label], i) => (
          <TabsTrigger key={key} value={key} className="flex-1 gap-1 px-2 sm:flex-none sm:px-3">
            {label} <kbd className="text-xs opacity-60">{i + 1}</kbd>
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={filter}>
      <div className="divide-y divide-border rounded-md border border-border" aria-label="Notifications">
        {loading&&<p role="status" className="px-3 py-6 text-sm text-center text-muted-foreground">Loading notifications…</p>}
        {!loading&&!error&&items.length === 0 && <p className="px-3 py-6 text-sm text-center text-muted-foreground">{filter === "direct" ? "Inbox zero. Nothing needs you." : "Nothing here."}</p>}
        {items.map((it, i) => (
          <div key={it.id} className={`px-3 py-2 flex flex-wrap items-center gap-3 text-sm ${i === cursor ? "bg-muted/60" : ""}`} onClick={() => setCursor(i)}>
            <div className="min-w-0 flex-1 basis-full sm:basis-0">
              <div className="truncate">{it.title}</div>
              <div className="text-xs text-muted-foreground">{it.project_name} · {timeAgo(it.created_at)}</div>
            </div>
            <div className="flex w-full flex-wrap gap-1 shrink-0 sm:w-auto">
              {!it.type.startsWith('discussion.reply.public.')&&<RepositoryNotifications key={it.project_id} projectId={it.project_id} projectName={it.project_name}/>}
              <Button size="sm" variant="ghost" onClick={(e)=>{e.stopPropagation();navigate(inboxDestination(it));}} aria-label={`Open ${it.title}`}>Open</Button>
              <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); void act(it, "archived"); }}>Archive</Button>
              {filter !== "snoozed" && <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); void act(it, "snoozed"); }}>Snooze</Button>}
            </div>
          </div>
        ))}
      </div>
      </TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground"><kbd>j</kbd>/<kbd>k</kbd> move · <kbd>e</kbd> archive · <kbd>s</kbd> snooze until the next activity in that repository · <kbd>u</kbd> move back · <kbd>Enter</kbd> open · <kbd>1</kbd>–<kbd>4</kbd> switch list</p>
    </div>
  );
}
