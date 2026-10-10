import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { MetadataArchives } from "../../server/metadata-archive";
import { Label } from "@/components/ui/label";
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { apiJson } from "../api";
import { navigate, timeAgo } from "../router";
import { normalizeSlug, checkBody, type WikiRevision } from "@/core/wiki";

type WikiPage = WikiRevision & { archiveOrigin?: ReturnType<MetadataArchives["origin"]> };
function ImportedWikiOrigin({page}:{page:WikiPage}){const origin=page.archiveOrigin;if(!origin)return null;return <div className="space-y-2 text-xs"><p className="text-muted-foreground">Imported contribution · unverified contributor</p>{origin.sourceAuthor&&<p className="text-muted-foreground break-words">Claimed source author: {origin.sourceAuthor}</p>}<Collapsible><CollapsibleTrigger asChild><Button size="sm" variant="ghost" className="h-auto p-0 text-xs">Archive provenance</Button></CollapsibleTrigger><CollapsibleContent className="space-y-1 mt-2 text-muted-foreground break-all"><p>Source repository: {origin.source.projectId}</p><p>Source Git head: {origin.source.head}</p><p>Source resource: {origin.sourceResourceId}</p><p>Archive SHA-256: {origin.archiveDigest}</p></CollapsibleContent></Collapsible></div>;}

type Page = Omit<WikiRevision, "body">;
type History = { revisions: Page[]; nextBefore: number | null };
export function WikiTab({ projectId, slug, readOnly }: { projectId: string; slug?: string; readOnly: boolean }) {
  const lifetime = useRef(new AbortController());
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort(); }, []);
  const base = `/p/${encodeURIComponent(projectId)}/wiki`;
  const [pages, setPages] = useState<Page[] | null>(null);
  const [page, setPage] = useState<WikiPage | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSlug, setNewSlug] = useState("");
  const [history, setHistory] = useState<History | null>(null);
  const [preview, setPreview] = useState<WikiPage | null>(null);
  const [restore, setRestore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(null); setPage(null); setPages(null); setHistory(null); setPreview(null); setEditing(false);
    const load = async () => {
      try {
        if (slug) { const value = await apiJson<WikiPage>(`${base}/${encodeURIComponent(slug)}`, { signal: controller.signal }); setPage(value); setDraft(value.body); }
        else setPages((await apiJson<{ pages: Page[] }>(base, { signal: controller.signal })).pages);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load wiki"); }
    };
    void load(); return () => controller.abort();
  }, [base, slug, revision]);
  useEffect(() => {
    if (!editing) return;
    const guard = (event: BeforeUnloadEvent) => { if (draft !== page?.body) event.preventDefault(); };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [editing, draft, page]);
  const mutate = async (path: string, method: "PUT" | "POST", json: object) => {
    setBusy(true); setError(null);
    try { const saved = await apiJson<WikiPage>(path, { method, json, signal: lifetime.current.signal }); setPage(saved); setDraft(saved.body); setEditing(false); setHistory(null); setPreview(null); setRestore(null); return saved; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save page"); return null; }
    finally { setBusy(false); }
  };
  const loadHistory = async (before?: number) => {
    setBusy(true); setError(null);
    try { const value = await apiJson<History>(`${base}/${encodeURIComponent(slug!)}/history?limit=20${before ? `&before=${before}` : ""}`, { signal: lifetime.current.signal }); setHistory(current => before && current ? { ...value, revisions: [...current.revisions, ...value.revisions] } : value); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load history"); }
    finally { setBusy(false); }
  };
  return <section className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div>{slug && <Button variant="link" className="px-0 h-auto text-muted-foreground" onClick={() => navigate(`/p/${projectId}/wiki`)}>All pages</Button>}<h2 className="text-xl font-semibold mt-1">{slug ?? "Wiki"}</h2></div><div className="flex gap-2">{!slug && !readOnly && <Button size="sm" onClick={() => setCreating(true)}>New page</Button>}{page && !editing && <><Button size="sm" variant="outline" disabled={busy} onClick={() => history ? setHistory(null) : void loadHistory()}>History</Button>{!readOnly && <Button size="sm" onClick={() => { setPreview(null); setDraft(page.body); setEditing(true); }}>Edit page</Button>}</>}</div></div>
    {readOnly && <p className="text-sm text-muted-foreground">This repository is read-only. Wiki pages and history remain available.</p>}
    {error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{error}</p>{!editing && <Button size="sm" variant="outline" onClick={() => setRevision(value => value + 1)}>Retry</Button>}</div>}
    {!error && !pages && !page && <p role="status" className="text-sm text-muted-foreground">Loading wiki…</p>}
    {pages && (pages.length ? <div className="divide-y divide-border">{pages.map(item => <a key={item.slug} href={`#/p/${projectId}/wiki?page=${encodeURIComponent(item.slug)}`} className="block py-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="font-medium">{item.slug}</span><p className="text-xs text-muted-foreground mt-1">Revision {item.id} · Updated {timeAgo(item.timestamp)}</p></a>)}</div> : <p className="text-sm text-muted-foreground py-8">No wiki pages yet. Document setup, decisions, and shared knowledge here.</p>)}
    {page && <>{editing ? <form className="space-y-3" onSubmit={event => { event.preventDefault(); const problem = checkBody(draft); if (problem) { setError(problem.error); return; } void mutate(`${base}/${encodeURIComponent(page.slug)}`, "PUT", { body: draft, expectedRevision: page.id }); }}><Label htmlFor="wiki-body">Page content</Label><Textarea id="wiki-body" className="min-h-80 font-mono text-sm" value={draft} onChange={event => setDraft(event.target.value)} disabled={busy} /><p className="text-xs text-muted-foreground">Editing revision {page.id}. If another member saves first, your draft stays here so you can merge their changes.</p><div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || readOnly || draft === page.body}>{busy ? "Saving…" : "Save page"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button><Button type="button" variant="ghost" disabled={busy} onClick={async () => { setBusy(true); try { const latest = await apiJson<WikiPage>(`${base}/${encodeURIComponent(page.slug)}`, { signal: lifetime.current.signal }); setPage(latest); setPreview(latest); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load latest revision"); } finally { setBusy(false); } }}>Load latest for comparison</Button></div>{preview && <div className="border-t border-border pt-4"><h3 className="font-medium text-sm">Latest saved content · revision {preview.id}</h3><pre className="whitespace-pre-wrap break-words text-sm mt-3">{preview.body || "This page is empty."}</pre></div>}</form> : <><p className="text-xs text-muted-foreground">Revision {(preview ?? page).id} · {timeAgo((preview ?? page).timestamp)}</p>{preview && <div className="flex flex-wrap gap-2 items-center"><p className="text-sm text-muted-foreground">Viewing a previous revision.</p><Button variant="outline" size="sm" onClick={() => setPreview(null)}>Return to latest</Button>{!readOnly && preview.id !== page.id && <Button variant="outline" size="sm" onClick={() => setRestore(preview.id)}>Restore this revision</Button>}</div>}<ImportedWikiOrigin page={preview ?? page}/><article className="whitespace-pre-wrap break-words leading-7 text-sm py-4">{(preview ?? page).body || <span className="text-muted-foreground">This page is empty.</span>}</article></>}
    {history && <div className="border-t border-border pt-5 space-y-3"><h3 className="font-medium">Revision history</h3>{history.revisions.map(item => <div key={item.id} className="flex justify-between gap-3 items-center py-2"><span className="text-sm">Revision {item.id}<span className="block text-xs text-muted-foreground">{timeAgo(item.timestamp)}</span></span><Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { setPreview(await apiJson<WikiPage>(`${base}/${encodeURIComponent(page.slug)}?revision=${item.id}`, { signal: lifetime.current.signal })); setEditing(false); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load revision"); } finally { setBusy(false); } }}>View</Button></div>)}{history.nextBefore && <Button size="sm" variant="outline" disabled={busy} onClick={() => void loadHistory(history.nextBefore!)}>Older revisions</Button>}</div>}</>}
    <Dialog open={creating} onOpenChange={setCreating}><DialogHeader><DialogTitle>New wiki page</DialogTitle><DialogDescription>Choose a page address using letters, numbers, and hyphens.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={event => { event.preventDefault(); const checked = normalizeSlug(newSlug); if (!checked.ok) { setError(checked.error); return; } void mutate(`${base}/${checked.value}`, "PUT", { body: "", expectedRevision: null }).then(saved => { if (saved) { setCreating(false); navigate(`/p/${projectId}/wiki?page=${encodeURIComponent(saved.slug)}`); } }); }}><Label htmlFor="wiki-slug">Page address</Label><Input id="wiki-slug" value={newSlug} onChange={event => setNewSlug(event.target.value)} maxLength={80} placeholder="getting-started" required />{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<Button type="submit" disabled={busy || readOnly}>Create page</Button></form></Dialog>
    <Dialog open={restore !== null} onOpenChange={open => { if (!open) setRestore(null); }}><DialogHeader><DialogTitle>Restore revision {restore}</DialogTitle><DialogDescription>This creates a new revision with the older content. Existing history remains available.</DialogDescription></DialogHeader><div className="flex gap-2"><Button disabled={busy || readOnly} onClick={() => { if (page && restore) void mutate(`${base}/${encodeURIComponent(page.slug)}/revert`, "POST", { toRevision: restore, expectedRevision: page.id }); }}>Restore revision</Button><Button variant="outline" disabled={busy} onClick={() => setRestore(null)}>Cancel</Button></div></Dialog>
  </section>;
}
