import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ChevronRight, File, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiJson, ApiError } from "../api";
import { timeAgo } from "../router";
import {CodeInspection} from '../components/CodeInspection';

import type {FileHistoryPage} from "../../server/browse";
import type {BranchSelection} from "../branch-browser";
const BranchControls=lazy(async()=>({default:(await import("../components/BranchControls")).BranchControls}));

interface Commit { hash: string; message: string; author: { name: string }; committedAt: number }
interface Entry { name: string; type: "blob" | "tree" }

export function UnbornCodeState(){return <Card><CardContent className="p-5 space-y-2"><h3 className="text-sm font-semibold">No accepted commit yet</h3><p className="text-sm text-muted-foreground">The recorded default branch has no accepted history. Create a contribution, push its first commit, and review it before acceptance.</p></CardContent></Card>;}

export function CodeTab({ projectId,isOwner=false,acceptedCommit,params }: { projectId: string;isOwner?:boolean;acceptedCommit?:string|null;params?:URLSearchParams }) { const ref=params?.get("ref"),path=params?.get("path"),line=Number(params?.get("line"));const link=ref&&/^[a-f0-9]{40}$/.test(ref)&&path?{ref,path,line:Number.isSafeInteger(line)&&line>0?line:undefined}:undefined;return <CodeBrowser key={`${projectId}:${link?.ref??""}:${link?.path??""}:${link?.line??""}`} projectId={projectId} acceptedCommit={acceptedCommit} isOwner={isOwner} link={link}/>; }
function CodeBrowser({ projectId,isOwner,acceptedCommit,link }: { projectId: string;isOwner:boolean;acceptedCommit?:string|null;link?:{ref:string;path:string;line?:number} }) {
  const [selection,setSelection]=useState<BranchSelection|null>(null);
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [file, setFile] = useState<{ path: string; content: string; binary: boolean; truncated: boolean; size: number } | null>(null);
  const [history, setHistory] = useState<FileHistoryPage | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historySequence=useRef(0), historyController=useRef<AbortController | null>(null);
  const [commit, setCommit] = useState<Commit | null>(null);
  const [error, setError] = useState<{ message: string; target: string; isFile: boolean; ref?: string; status?: number; retryAt?: number } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const requestSequence=useRef(0), requestController=useRef<AbortController | null>(null), loadedRevision=useRef<string | undefined>(undefined);
  const [,refreshRetry]=useState(0);
  useEffect(()=>{if(!error?.retryAt)return;const timer=setTimeout(()=>refreshRetry(value=>value+1),Math.min(2147483647,Math.max(0,error.retryAt-Date.now())));return()=>clearTimeout(timer);},[error]);
  const open = async (target: string, isFile: boolean, ref: string | null | undefined=loadedRevision.current) => {
    if(acceptedCommit===null&&!ref){setEntries(null);setFile(null);setCommit(null);setPath("");setError(null);setLoading(null);return true;}
    historySequence.current++;historyController.current?.abort();setHistory(null);setHistoryError(null);setHistoryLoading(false);
    const sequence=++requestSequence.current;requestController.current?.abort();const controller=new AbortController();requestController.current=controller;
    const suffix=ref ? `&ref=${encodeURIComponent(ref)}` : "";
    setError(null);
    setLoading(target || "root");
    try {
      if (isFile) {
        const r = await apiJson<{ commit: Commit; path: string; content: string; binary: boolean; truncated: boolean; size: number }>(`/p/${projectId}/blob?path=${encodeURIComponent(target)}${suffix}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
        if(sequence!==requestSequence.current)return false;
        if(ref && r.commit.hash!==ref)throw new Error("The returned file does not match the requested revision. Refresh before continuing.");
        loadedRevision.current=r.commit.hash;
        setCommit(r.commit);
        setFile(r);
      } else {
        const r = await apiJson<{ commit: Commit; entries: Entry[] }>(`/p/${projectId}/tree?path=${encodeURIComponent(target)}${suffix}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
        if(sequence!==requestSequence.current)return false;
        if(ref && r.commit.hash!==ref)throw new Error("The returned folder does not match the requested revision. Refresh before continuing.");
        loadedRevision.current=r.commit.hash;
        setCommit(r.commit);
        setEntries(r.entries);
        setFile(null);
        setPath(target);
      }
      return true;
    } catch (e) {
      if(sequence===requestSequence.current && !controller.signal.aborted)setError({message:e instanceof Error ? e.message : "Could not load",target,isFile,ref:ref ?? undefined,status:e instanceof ApiError ? e.status : undefined,retryAt:e instanceof ApiError && e.retryAfter !== null ? Date.now()+e.retryAfter*1000 : undefined});
      return false;
    } finally {
      if(sequence===requestSequence.current)setLoading(null);
    }
  };

  useEffect(() => {
    if(selection===null)void open(link?.path??"", Boolean(link),link?.ref??acceptedCommit);
    return()=>{requestSequence.current++;requestController.current?.abort();historySequence.current++;historyController.current?.abort();};
  }, [projectId,acceptedCommit===null]);

  const loadHistory = async (offset=0) => {
    if (!file || !commit) return;
    const sequence=++historySequence.current;
    historyController.current?.abort();const controller=new AbortController();historyController.current=controller;
    setHistoryLoading(true);setHistoryError(null);
    try {
      const result=await apiJson<FileHistoryPage>(`/p/${projectId}/commits?path=${encodeURIComponent(file.path)}&ref=${commit.hash}&limit=10&offset=${offset}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      if(sequence!==historySequence.current)return;
      if(result.commit!==commit.hash||result.path!==file.path)throw new Error("History did not match the viewed file revision.");
      setHistory(result);
    }catch(error){if(sequence===historySequence.current&&!controller.signal.aborted)setHistoryError(error instanceof Error?error.message:"History could not be loaded");}
    finally{if(sequence===historySequence.current)setHistoryLoading(false);}
  };

  const codeHref=(target:string,line?:number)=>`/p/${encodeURIComponent(projectId)}/code?${new URLSearchParams({ref:commit?.hash??'',path:target,...(line?{line:String(line)}:{})})}`;
  useEffect(()=>{if(link?.line&&file?.path===link.path)document.getElementById(`code-line-${link.line}`)?.scrollIntoView({block:'center'});},[file,link?.line]);
  const crumbs = path.split("/").filter(Boolean);
  const dir = file ? file.path.split("/").slice(0, -1).join("/") : path;

  return (
    <div className="space-y-3 min-w-0">
      <h2 className="sr-only">Code</h2>
      <Suspense fallback={<p role="status" className="text-xs text-muted-foreground">Loading branch controls…</p>}><BranchControls projectId={projectId} isOwner={isOwner} selection={selection} viewedCommit={commit?.hash??null} onSelect={async next=>{const opened=await open("",false,next.commit);if(opened)setSelection(next);return opened;}}/></Suspense>
      {acceptedCommit===null&&!commit&&<UnbornCodeState/>}
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
      <Button size="sm" variant="ghost" disabled={loading !== null} onClick={()=>void open(file?.path ?? path, file !== null, selection&&!selection.accepted?selection.commit:null)}>Refresh {selection&&!selection.accepted?"pinned branch snapshot":"latest accepted revision"}</Button>
      {commit&&<CodeInspection key={`${commit.hash}:${file?.path??''}`} projectId={projectId} commit={commit.hash} path={file&&!file.binary&&!file.truncated?file.path:undefined} onOpen={(target,line)=>{window.location.hash=codeHref(target,line);}}/>}
      {loading && entries !== null && <p role="status" className="text-xs text-muted-foreground break-all">Loading {loading}…</p>}
      {error && (
        <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive flex flex-wrap items-center justify-between gap-2">
          <span className="break-words min-w-0">Could not open {error.isFile ? "file" : "folder"} <code>{error.target || "root"}</code>{error.ref && <> at <code>{error.ref.slice(0,7)}</code></>}. {error.message}{(file || entries) && <span className="block mt-1 text-xs">Showing the last loaded {file ? `file ${file.path}` : `folder ${path || "root"}`} at {commit?.hash.slice(0,7)}.</span>}{error.status===413 && <span className="block mt-1 text-xs">This request exceeds inline browsing limits. Use Git to inspect the complete repository.</span>}{error.retryAt && error.retryAt>Date.now() && <span className="block mt-1 text-xs">Retry is available after {new Date(error.retryAt).toLocaleTimeString()}.</span>}</span>
          {error.status!==413 && <Button size="sm" variant="outline" disabled={loading !== null || Boolean(error.retryAt && error.retryAt>Date.now())} onClick={() => void open(error.target, error.isFile, error.ref ?? null)}>Retry this request</Button>}
        </div>
      )}
      {acceptedCommit===null&&!commit?null:file ? (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-2 border-b border-border text-xs text-muted-foreground flex flex-wrap justify-between gap-2">
              <span className="break-all min-w-0">{file.path} <a className="underline ml-2" href={`/#${codeHref(file.path)}`}>Permalink</a></span>
              <div className="flex items-center gap-3"><Button size="sm" variant="ghost" disabled={historyLoading||loading!==null} onClick={()=>void loadHistory()}>File history</Button><Button size="sm" variant="ghost" onClick={() => void open(dir, false)}>Back to folder</Button></div>
            </div>
            {historyLoading&&<p role="status" className="px-4 py-2 text-xs text-muted-foreground">Loading file history…</p>}
            {historyError&&<p role="alert" className="px-4 py-2 text-sm text-destructive">{historyError}</p>}
            {history&&<section aria-label="File history" className="px-4 py-3 border-b border-border space-y-2">
              <p className="text-xs text-muted-foreground">Compared to each commit’s first parent. Renames are not followed.</p>
              {history.commits.length===0&&<p className="text-sm">No changes to this path in these {history.scanned} commits.</p>}
              <ul className="space-y-2">{history.commits.map(item=><li key={item.hash} className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm break-words">{item.message.split("\n")[0]}</p><p className="text-xs text-muted-foreground">{item.author.name} · {timeAgo(item.committedAt)} · {item.hash.slice(0,7)}</p></div><Button size="sm" variant="outline" onClick={()=>void open(item.pathExists?file.path:"",item.pathExists,item.hash)}>{item.pathExists?"Browse revision":"Browse commit"}</Button></li>)}</ul>
              {history.nextOffset!==null&&<Button size="sm" variant="outline" disabled={historyLoading} onClick={()=>void loadHistory(history.nextOffset!)}>Older commits</Button>}
              {history.nextOffset===null&&<p className="text-xs text-muted-foreground">End of history for this path.</p>}
            </section>}
            {file.binary ? (
              <p className="p-4 text-sm text-muted-foreground">Binary file ({file.size} bytes)</p>
            ) : file.truncated ? (
              <p className="p-4 text-sm text-muted-foreground">File too large to display ({Math.round(file.size / 1024)} KB)</p>
            ) : file.content.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Empty file</p>
            ) : (
              <pre className="p-4 text-xs overflow-auto max-h-[60vh] leading-relaxed" tabIndex={0} aria-label={`Contents of ${file.path}`}><code>{file.content.split('\n').map((text,index)=><span id={`code-line-${index+1}`} key={index} className={`block ${link?.line===index+1?'bg-primary/15':''}`}><a className="inline-block w-10 mr-3 text-right text-muted-foreground hover:text-foreground select-none" aria-label={`Permalink to line ${index+1}`} aria-current={link?.line===index+1?'location':undefined} href={`/#${codeHref(file.path,index+1)}`}>{index+1}</a>{text||' '}</span>)}</code></pre>
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
