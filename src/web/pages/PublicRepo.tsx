import React, { useCallback, useEffect, useState } from "react";
import { GitBranch, Folder, FileText, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeSelector } from "../ThemeProvider";
import { DiffViewer, type BlobResult, type FileChange } from "../components/DiffViewer";
import { navigate, timeAgo } from "../router";

interface Meta { id: string; name: string; acceptedCommit: string; visibility: "public" }
interface Commit { hash: string; message: string; author: { name: string }; parents: string[]; committedAt: number }
interface Entry { name: string; type: "blob" | "tree"; hash: string; mode: string }
async function readPublic<T>(projectId: string, endpoint: string, query: URLSearchParams = new URLSearchParams()): Promise<T> {
  const response = await fetch(`/api/public/${encodeURIComponent(projectId)}/${endpoint}${query.size ? `?${query}` : ""}`, { credentials: "omit", cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 404 ? "This repository is not public or is unavailable." : response.status === 409 ? "Published repository state changed while loading. Retry to read its current state." : await response.text() || "Could not load public repository");
  return response.json() as Promise<T>;
}

export function PublicRepo({ projectId, params = new URLSearchParams(), onSignIn }: { projectId: string; params?: URLSearchParams; onSignIn?: () => void }) {
  const view = params.get("view") === "history" ? "history" : params.get("view") === "diff" ? "diff" : "code";
  const path = params.get("path") ?? "";
  const selectedCommit = params.get("commit") ?? "";
  const fileSelected = params.get("file") === "1";
  const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
  const from = params.get("from") ?? "", to = params.get("to") ?? "";
  const [meta, setMeta] = useState<Meta | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [file, setFile] = useState<BlobResult | null>(null);
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [changes, setChanges] = useState<FileChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const commit = selectedCommit || meta?.acceptedCommit || "";
  const go = (next: Record<string, string>) => navigate(`/public/${projectId}?${new URLSearchParams(next)}`);
  useEffect(() => {
    let active = true; setMeta(null); setError(null);
    void readPublic<Meta>(projectId, "meta").then((value) => { if (active) setMeta(value); }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load repository"); });
    return () => { active = false; };
  }, [projectId, revision]);
  useEffect(() => {
    if (!meta || !commit) return;
    let active = true; setEntries(null); setFile(null); setCommits(null); setChanges(null); setError(null);
    const load = async () => {
      if (view === "history") { const result = await readPublic<{ commits: Commit[] }>(projectId, "history", new URLSearchParams({ offset: String(offset), limit: "30" })); if (active) setCommits(result.commits); }
      else if (view === "diff") { const result = await readPublic<{ changes: FileChange[] }>(projectId, "diff", new URLSearchParams({ from, to })); if (active) setChanges(result.changes); }
      else if (fileSelected) { const result = await readPublic<{ file: BlobResult }>(projectId, "file", new URLSearchParams({ commit, path })); if (active) setFile(result.file); }
      else { const result = await readPublic<{ entries: Entry[] }>(projectId, "tree", new URLSearchParams({ commit, path })); if (active) setEntries(result.entries); }
    };
    void load().catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load published source"); });
    return () => { active = false; };
  }, [projectId, meta, commit, path, fileSelected, view, offset, from, to]);
  const loadBlob = useCallback(async (hash: string) => {
    const match = changes?.find((change) => change.aHash === hash || change.bHash === hash);
    if (!match) throw new Error("File is not part of this public comparison");
    const ref = match.aHash === hash ? from : to;
    return (await readPublic<{ file: BlobResult }>(projectId, "file", new URLSearchParams({ commit: ref, path: match.path }))).file;
  }, [changes, from, to, projectId]);
  return <div className="min-h-screen bg-background text-foreground font-sans">
    <header className="h-14 border-b border-border px-5 sm:px-8 flex items-center justify-between gap-3"><a href="/" className="flex items-center gap-2 font-semibold"><GitBranch className="h-5 w-5 text-primary" aria-hidden="true" />FlareGit</a><div className="flex items-center gap-3"><ThemeSelector compact />{onSignIn ? <Button size="sm" variant="ghost" onClick={onSignIn}>Sign in to contribute</Button> : <a href={`/#/p/${encodeURIComponent(projectId)}`} className="text-sm underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Sign in to contribute</a>}</div></header>
    <main className="max-w-6xl mx-auto px-5 sm:px-8 py-8 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6"><h1 className="text-xl font-medium break-words">{meta?.name ?? "Public repository"}</h1>{meta && <span className="text-xs text-muted-foreground">Public · accepted <code>{meta.acceptedCommit.slice(0, 12)}</code></span>}</div>
      {meta && <nav aria-label="Public repository sections" className="flex gap-1 border-b border-border mb-5"><Button variant="ghost" aria-current={view === "code" ? "page" : undefined} onClick={() => go({ view: "code" })}>Source</Button><Button variant="ghost" aria-current={view === "history" ? "page" : undefined} onClick={() => go({ view: "history" })}>History</Button></nav>}
      {error && <div role="alert" className="text-sm text-destructive border border-border rounded-md p-3 flex flex-wrap items-center justify-between gap-2"><span>{error}</span><Button size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>Retry</Button></div>}
      {!error && (!meta || (view === "code" && !entries && !file) || (view === "history" && !commits) || (view === "diff" && !changes)) && <p role="status" className="text-sm text-muted-foreground">Loading published repository…</p>}
      {meta && view === "code" && <div className="mb-4 flex flex-wrap gap-2 items-center text-sm"><Button size="sm" variant="ghost" disabled={!path} onClick={() => go({ view: "code", commit, path: path.split("/").slice(0, -1).join("/") })}><ArrowLeft className="h-3.5 w-3.5 mr-1" aria-hidden="true" />Parent</Button><code className="text-xs break-all">{path || "/"}</code><span className="ml-auto text-xs text-muted-foreground">Commit <code>{commit.slice(0, 12)}</code></span></div>}
      {entries && <ul className="divide-y divide-border border-y border-border">{entries.map((entry) => <li key={entry.name}><Button variant="ghost" className="w-full h-auto py-3 rounded-none justify-start whitespace-normal text-left" onClick={() => go({ view: "code", commit, path: path ? `${path}/${entry.name}` : entry.name, ...(entry.type === "blob" ? { file: "1" } : {}) })}>{entry.type === "tree" ? <Folder className="h-4 w-4 mr-3 shrink-0 text-muted-foreground" aria-hidden="true" /> : <FileText className="h-4 w-4 mr-3 shrink-0 text-muted-foreground" aria-hidden="true" />}<span className="break-all text-sm">{entry.name}</span></Button></li>)}{entries.length === 0 && <li className="py-4 text-sm text-muted-foreground">This directory is empty.</li>}</ul>}
      {file && (file.binary ? <p className="text-sm text-muted-foreground">Binary file · {file.size.toLocaleString()} bytes. Inline text preview is unavailable.</p> : file.truncated ? <p className="text-sm text-muted-foreground">File exceeds the 4 MiB inline preview limit.</p> : <pre className="max-h-[65vh] overflow-auto border border-border rounded-md p-4 text-xs leading-6 font-mono" aria-label={path}>{file.content}</pre>)}
      {commits && <><ul className="divide-y divide-border">{commits.map((item) => <li key={item.hash} className="py-4 flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h2 className="text-sm font-medium break-words">{item.message.split("\n")[0]}</h2><p className="mt-1 text-xs text-muted-foreground break-words">{item.author.name} · {timeAgo(item.committedAt)} · <code>{item.hash.slice(0, 12)}</code></p></div><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => go({ view: "code", commit: item.hash })}>Browse</Button>{item.parents[0] && <Button size="sm" variant="outline" onClick={() => go({ view: "diff", from: item.parents[0]!, to: item.hash })}>Diff</Button>}</div></li>)}</ul><div className="mt-5 flex gap-2"><Button size="sm" variant="outline" disabled={offset === 0} onClick={() => go({ view: "history", offset: String(Math.max(0, offset - 30)) })}>Newer commits</Button><Button size="sm" variant="outline" disabled={commits.length < 30} onClick={() => go({ view: "history", offset: String(offset + 30) })}>Older commits</Button></div></>}
      {changes && <><p className="text-xs text-muted-foreground mb-3">Comparing <code>{from.slice(0, 12)}</code> to <code>{to.slice(0, 12)}</code></p>{changes.length ? <DiffViewer key={`${from}:${to}`} files={changes} loadBlob={loadBlob} /> : <p className="text-sm text-muted-foreground">No changed files.</p>}</>}
    </main>
  </div>;
}
