import React, { useEffect, useRef, useState } from "react";
import { ChevronRight, File, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiJson, ApiError } from "../api";
import { timeAgo } from "../router";

interface Commit { hash: string; message: string; author: { name: string }; committedAt: number }
interface Entry { name: string; type: "blob" | "tree" }

export function CodeTab({ projectId }: { projectId: string }) { return <CodeBrowser key={projectId} projectId={projectId} />; }
function CodeBrowser({ projectId }: { projectId: string }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [file, setFile] = useState<{ path: string; content: string; binary: boolean; truncated: boolean; size: number } | null>(null);
  const [commit, setCommit] = useState<Commit | null>(null);
  const [error, setError] = useState<{ message: string; target: string; isFile: boolean; ref?: string; status?: number; retryAt?: number } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const requestSequence=useRef(0), requestController=useRef<AbortController | null>(null), loadedRevision=useRef<string | undefined>(undefined);
  const [,refreshRetry]=useState(0);
  useEffect(()=>{if(!error?.retryAt)return;const timer=setTimeout(()=>refreshRetry(value=>value+1),Math.min(2147483647,Math.max(0,error.retryAt-Date.now())));return()=>clearTimeout(timer);},[error]);
  const open = async (target: string, isFile: boolean, ref: string | null | undefined=loadedRevision.current) => {
    const sequence=++requestSequence.current;requestController.current?.abort();const controller=new AbortController();requestController.current=controller;
    const suffix=ref ? `&ref=${encodeURIComponent(ref)}` : "";
    setError(null);
    setLoading(target || "root");
    try {
      if (isFile) {
        const r = await apiJson<{ commit: Commit; path: string; content: string; binary: boolean; truncated: boolean; size: number }>(`/p/${projectId}/blob?path=${encodeURIComponent(target)}${suffix}`,{signal:controller.signal});
        if(sequence!==requestSequence.current)return;
        if(ref && r.commit.hash!==ref)throw new Error("The returned file does not match the requested revision. Refresh before continuing.");
        loadedRevision.current=r.commit.hash;
        setCommit(r.commit);
        setFile(r);
      } else {
        const r = await apiJson<{ commit: Commit; entries: Entry[] }>(`/p/${projectId}/tree?path=${encodeURIComponent(target)}${suffix}`,{signal:controller.signal});
        if(sequence!==requestSequence.current)return;
        if(ref && r.commit.hash!==ref)throw new Error("The returned folder does not match the requested revision. Refresh before continuing.");
        loadedRevision.current=r.commit.hash;
        setCommit(r.commit);
        setEntries(r.entries);
        setFile(null);
        setPath(target);
      }
    } catch (e) {
      if(sequence===requestSequence.current && !controller.signal.aborted)setError({message:e instanceof Error ? e.message : "Could not load",target,isFile,ref:ref ?? undefined,status:e instanceof ApiError ? e.status : undefined,retryAt:e instanceof ApiError && e.retryAfter !== null ? Date.now()+e.retryAfter*1000 : undefined});
    } finally {
      if(sequence===requestSequence.current)setLoading(null);
    }
  };

  useEffect(() => {
    void open("", false);
    return()=>{requestSequence.current++;requestController.current?.abort();};
  }, [projectId]);

  const crumbs = path.split("/").filter(Boolean);
  const dir = file ? file.path.split("/").slice(0, -1).join("/") : path;

  return (
    <div className="space-y-3 min-w-0">
      <h2 className="sr-only">Code</h2>
      <nav aria-label="Path" className="flex items-center gap-1 text-sm flex-wrap min-w-0">
        <button className="font-semibold hover:underline" onClick={() => void open("", false)}>root</button>
        {(file ? file.path.split("/") : crumbs).map((c, i, all) => {
          const target = all.slice(0, i + 1).join("/");
          const isLast = i === all.length - 1;
          return (
            <span key={target} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="h-3 w-3 opacity-50 shrink-0" aria-hidden />
              <button className="hover:underline break-all text-left" aria-current={isLast ? "location" : undefined} onClick={() => void open(target, file !== null && isLast)}>{c}</button>
            </span>
          );
        })}
      </nav>
      {commit && (
        <div className="text-xs text-muted-foreground break-words">
          Viewing commit <code className="text-foreground">{commit.hash.slice(0, 7)}</code> · {commit.author.name} · {timeAgo(commit.committedAt)} · {commit.message.split("\n")[0]}
        </div>
      )}
      <Button size="sm" variant="ghost" disabled={loading !== null} onClick={()=>void open(file?.path ?? path, file !== null, null)}>Refresh latest accepted revision</Button>
      {loading && entries !== null && <p role="status" className="text-xs text-muted-foreground break-all">Loading {loading}…</p>}
      {error && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive flex flex-wrap items-center justify-between gap-2">
          <span className="break-words min-w-0">Could not open {error.isFile ? "file" : "folder"} <code>{error.target || "root"}</code>{error.ref && <> at <code>{error.ref.slice(0,7)}</code></>}. {error.message}{(file || entries) && <span className="block mt-1 text-xs">Showing the last loaded {file ? `file ${file.path}` : `folder ${path || "root"}`} at {commit?.hash.slice(0,7)}.</span>}{error.status===413 && <span className="block mt-1 text-xs">This request exceeds inline browsing limits. Use Git to inspect the complete repository.</span>}{error.retryAt && error.retryAt>Date.now() && <span className="block mt-1 text-xs">Retry is available after {new Date(error.retryAt).toLocaleTimeString()}.</span>}</span>
          {error.status!==413 && <Button size="sm" variant="outline" disabled={loading !== null || Boolean(error.retryAt && error.retryAt>Date.now())} onClick={() => void open(error.target, error.isFile, error.ref ?? null)}>Retry this request</Button>}
        </div>
      )}
      {file ? (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-2 border-b border-border text-xs text-muted-foreground flex flex-wrap justify-between gap-2">
              <span className="break-all min-w-0">{file.path}</span>
              <button className="hover:underline shrink-0" onClick={() => void open(dir, false)}>Back to folder</button>
            </div>
            {file.binary ? (
              <p className="p-4 text-sm text-muted-foreground">Binary file ({file.size} bytes)</p>
            ) : file.truncated ? (
              <p className="p-4 text-sm text-muted-foreground">File too large to display ({Math.round(file.size / 1024)} KB)</p>
            ) : file.content.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Empty file</p>
            ) : (
              <pre className="p-4 text-xs overflow-auto max-h-[60vh] leading-relaxed" tabIndex={0} aria-label={`Contents of ${file.path}`}><code>{file.content}</code></pre>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 divide-y divide-border">
            {entries === null && !error && <p role="status" className="p-4 text-sm text-muted-foreground">Loading files…</p>}
            {entries === null && error && <p className="p-4 text-sm text-muted-foreground">Files could not be loaded.</p>}
            {entries?.length === 0 && <p className="p-4 text-sm text-muted-foreground">Empty folder</p>}
            {path && (
              <button className="w-full text-left px-4 py-2 text-sm hover:bg-muted/40" aria-label="Parent folder" onClick={() => void open(path.split("/").slice(0, -1).join("/"), false)}>..</button>
            )}
            {entries?.map((e) => (
              <button key={e.name} className="w-full flex items-center gap-2 text-left px-4 py-2 text-sm hover:bg-muted/40 min-w-0" onClick={() => void open(path ? `${path}/${e.name}` : e.name, e.type === "blob")}>
                {e.type === "tree" ? <Folder className="h-4 w-4 text-sky-400 shrink-0" aria-label="Folder" /> : <File className="h-4 w-4 opacity-60 shrink-0" aria-label="File" />}
                <span className="break-all min-w-0">{e.name}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
