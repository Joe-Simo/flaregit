import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CornerDownLeft, Search, X } from "lucide-react";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { publicSearchCatalog, type SearchResult } from "../search-catalog";
import type { CommunityTopic } from "../../server/platform-community";
import "./search.css";

export type SearchLoader = (query: string, signal: AbortSignal) => Promise<{ results: SearchResult[]; incomplete?: boolean }>;
const loadPublicSearch: SearchLoader = async (query, signal) => {
  const response = await fetch(`/api/community?q=${encodeURIComponent(query)}&sort=latest`, { signal, credentials: "omit", cache: "no-store" });
  if (!response.ok) throw new Error("Community search unavailable");
  const data = await response.json() as { topics: CommunityTopic[]; scope: string };
  return { results: data.topics.filter(topic => !topic.removed).map(topic => ({ id: topic.id, title: topic.title, description: topic.body.slice(0, 240), group: "Community", href: `/community#topic=${topic.id}` })) };
};
export function SearchDialog({ open, onOpenChange, load = loadPublicSearch, onNavigate }: { open: boolean; onOpenChange: (open: boolean) => void; load?: SearchLoader; onNavigate?: (href: string) => void }) {
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<SearchResult[]>([]);
  const [incomplete, setIncomplete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const normalized = query.trim().toLowerCase();
  const results = normalized ? [...publicSearchCatalog.filter(item => `${item.title} ${item.description} ${item.searchText ?? ""}`.toLowerCase().includes(normalized)), ...remote] : [];
  const close = () => onOpenChange(false);
  const visit = (result: SearchResult) => { close(); if (onNavigate) onNavigate(result.href); else window.location.assign(result.href); };
  useEffect(() => {
    if (!open) return;
    setQuery(""); setRemote([]); setFailed(false); setSelected(0);
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => {
    setRemote([]); setSelected(0); setFailed(false); setLoading(false); setIncomplete(false);
    if (!open || !normalized || !load) return;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => { void load(query.trim(), controller.signal).then(response => { if (!controller.signal.aborted) { setRemote(response.results); setIncomplete(response.incomplete ?? false); } }).catch(() => { if (!controller.signal.aborted) setFailed(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, normalized, load, query]);
  useEffect(() => { panel.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [selected]);
  const active = Math.min(selected, Math.max(0, results.length - 1));
  return <Dialog open={open} onOpenChange={onOpenChange} className="flare-search-dialog" backdropClassName="flare-search-backdrop"><div ref={panel}>
    <DialogTitle className="sr-only">Search FlareGit</DialogTitle>
    <div className="flare-search-input"><Search size={22} aria-hidden /><input ref={input} role="combobox" aria-label="Search FlareGit" aria-expanded={results.length > 0} aria-controls={`${id}-results`} aria-autocomplete="list" aria-activedescendant={results[active] ? `${id}-result-${active}` : undefined} placeholder="Search FlareGit…" maxLength={200} value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSelected(current => results.length ? (current + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length : 0); } else if (event.key === "Enter" && results[active]) { event.preventDefault(); visit(results[active]); } }} /><Button variant="ghost" size="icon" onClick={close} aria-label="Close search"><X size={17} /></Button></div>
    <div className="flare-search-body">{!normalized ? <div className="flare-search-empty"><Search size={48} strokeWidth={1.8} aria-hidden /><p>Start typing to search</p></div> : <><div id={`${id}-results`} role="listbox" aria-label="Search results">{results.map((result, index) => <div key={result.id} id={`${id}-result-${index}`} role="option" aria-selected={active === index} className="flare-search-result" onMouseEnter={() => setSelected(index)} onClick={() => visit(result)}><span className="flare-search-result-icon"><Search size={18} aria-hidden /></span><div><span className="flare-search-group">{result.group}</span><strong>{result.title}</strong><p>{result.description}</p></div><CornerDownLeft size={16} className="flare-search-return" aria-hidden /></div>)}</div>{loading && <p className="flare-search-status" role="status">Searching…</p>}{incomplete && <p className="flare-search-status" role="status">Showing a limited set of matches. Open a repository to browse more.</p>}{failed && <p className="flare-search-status" role="status">Additional results are unavailable. Page and guide results remain available.</p>}{!results.length && !loading && <div className="flare-search-empty"><Search size={42} aria-hidden /><p>No results for “{query.trim()}”</p></div>}</>}</div>
    <footer className="flare-search-footer"><span><kbd><ArrowUp size={12} /></kbd><kbd><ArrowDown size={12} /></kbd> Navigate</span><span><kbd><CornerDownLeft size={12} /></kbd> Select</span><span><kbd>Esc</kbd> Close</span><span className="flare-search-source">FlareGit search</span></footer>
  </div></Dialog>;
}
export function PublicSearchButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => { const listener = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(true); } }; window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); }, []);
  return <><Button variant="ghost" size="icon" aria-label="Search FlareGit, Command or Control K" onClick={() => setOpen(true)}><Search size={17} /></Button><SearchDialog open={open} onOpenChange={setOpen} /></>;
}
