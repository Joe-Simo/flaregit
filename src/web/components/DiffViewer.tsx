import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "../api";
import type { DiffRequest, DiffRow } from "../diff.worker";

export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  aHash?: string;
  bHash?: string;
}
export interface BlobResult { binary: boolean; truncated: boolean; size: number; content: string }

type FileState = { rows?: DiffRow[]; note?: string; collapsed: boolean };
type FlatRow =
  | { kind: "file"; file: FileChange; fileIndex: number; adds: number; dels: number }
  | { kind: "line"; fileIndex: number; rowIndex: number; row: DiffRow }
  | { kind: "note"; fileIndex: number; text: string };

const ROW_HEIGHT = 20;
const STATUS_COLOR: Record<FileChange["status"], string> = { added: "text-emerald-700 dark:text-emerald-400", modified: "text-amber-700 dark:text-amber-400", deleted: "text-red-700 dark:text-red-400" };

/**
 * Virtualized review canvas: only the rows in view are in the DOM, diffs are computed in a Web Worker,
 * file contents load lazily, and everything is reachable from the keyboard.
 */
/** Memoised so a row that scrolls back into view does not re-parse its highlighted HTML. */
const CodeLine = React.memo(function CodeLine({ text, html }: { text: string; html?: string }) {
  return html ? <span className="hljs-line" dangerouslySetInnerHTML={{ __html: html }} /> : <span>{text}</span>;
});

export function DiffViewer({ files, loadBlob, onLineClick, commented, onReadyChange }: {
  files: FileChange[];
  loadBlob: (hash: string) => Promise<BlobResult>;
  /** Click a line number to start a comment anchored to that line. */
  onLineClick?: (path: string, line: number) => void;
  /** "path:line" keys that already have comments. */
  commented?: Set<string>;
  onReadyChange?: (ready: boolean) => void;
}) {
  const [state, setState] = useState<Record<number, FileState>>({});
  const [revision, setRevision] = useState(0);
  const [loadFailure, setLoadFailure] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [,refreshRetry]=useState(0);
  const loadedRows=useRef(new Map<string,DiffRow[]>());
  const lastLoader=useRef(loadBlob);
  useEffect(()=>{if(retryAt===null)return;const timer=setTimeout(()=>refreshRetry(value=>value+1),Math.min(2147483647,Math.max(0,retryAt-Date.now())));return()=>clearTimeout(timer);},[retryAt]);
  const [stateFiles, setStateFiles] = useState(files);
  const [helpOpen, setHelpOpen] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const endIntent=useRef<FileChange[]|null>(null);

  const flat = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    files.forEach((file, fileIndex) => {
      const st = stateFiles === files ? state[fileIndex] : undefined;
      const rows = st?.rows ?? [];
      out.push({ kind: "file", file, fileIndex, adds: rows.filter((r) => r.t === "+").length, dels: rows.filter((r) => r.t === "-").length });
      if (st?.collapsed) return;
      if (st?.note) out.push({ kind: "note", fileIndex, text: st.note });
      else if (!st?.rows) out.push({ kind: "note", fileIndex, text: "Loading…" });
      else st.rows.forEach((row,rowIndex)=>out.push({ kind: "line", fileIndex, rowIndex, row }));
    });
    return out;
  }, [files, state, stateFiles]);

  const viewportRows = useRef({ files, flat });
  const fileIdentityKeys=useMemo(()=>files.map(file=>JSON.stringify([file.path,file.aHash,file.bHash])),[files]);
  const getItemKey = useCallback((index:number) => {
    const item=flat[index]!;
    return `${fileIdentityKeys[item.fileIndex]}:${item.kind==="file"?"header":item.kind==="line"?item.rowIndex:0}`;
  },[flat,fileIdentityKeys]);
  const virtualizer = useVirtualizer({ count: flat.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW_HEIGHT, overscan: 30, getItemKey, anchorTo: "end" });
  useLayoutEffect(()=>{
    if(viewportRows.current.files!==files){endIntent.current=null;virtualizer.scrollToOffset(0);}
    viewportRows.current={files,flat};
    if(endIntent.current===files)virtualizer.scrollToEnd();
  },[files,flat,virtualizer]);

  // Compute each file's diff in the worker, three at a time.
  useEffect(() => {
    if(lastLoader.current!==loadBlob){loadedRows.current.clear();lastLoader.current=loadBlob;}
    const fileKey=(file:FileChange)=>JSON.stringify([file.path,file.aHash,file.bHash]);
    setState(Object.fromEntries(files.flatMap((file,index)=>{const rows=loadedRows.current.get(fileKey(file));return rows ? [[index,{collapsed:false,rows}]] : [];}))); setStateFiles(files); setLoadFailure(false);setRetryAt(null);
    let worker: Worker;
    try { worker = new Worker("/diff.worker.js", { type: "module" }); }
    catch { setLoadFailure(true); setState(Object.fromEntries(files.map((_, index) => [index, { collapsed: false, note: "Could not start the background diff worker. Retry the diff." }]))); return; }
    workerRef.current = worker;
    let cancelled = false;
    let workerFailure: Error | null = null;
    const pending = new Map<number, { resolve: (rows: DiffRow[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    const failWorker = () => {
      if (cancelled) return;
      workerFailure = new Error("The background diff worker failed or did not respond. Retry the diff."); setLoadFailure(true);
      for (const job of pending.values()) { clearTimeout(job.timer); job.reject(workerFailure); }
      pending.clear(); worker.terminate();
    };
    worker.onerror = failWorker; worker.onmessageerror = failWorker;
    worker.onmessage = (event: MessageEvent<{ id: number; rows: DiffRow[] }>) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      clearTimeout(job.timer); pending.delete(event.data.id); job.resolve(event.data.rows);
    };
    const diffInWorker = (id: number, a: string, b: string, path: string) => new Promise<DiffRow[]>((resolve, reject) => {
      if (workerFailure) { reject(workerFailure); return; }
      const timer = setTimeout(failWorker, 30_000);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, a, b, path } satisfies DiffRequest); } catch { failWorker(); }
    });

    let capacityFailure: string | null=null;
    const queue = files.flatMap((file,index)=>loadedRows.current.has(fileKey(file)) ? [] : [index]);
    const takeNext = () => {
      if(endIntent.current===files){const lastPending=queue.indexOf(files.length-1);if(lastPending>=0)return queue.splice(lastPending,1)[0];}
      const current=viewportRows.current,element=parentRef.current;
      if(current.files===files&&element){
        const first=Math.floor(element.scrollTop/ROW_HEIGHT),last=Math.ceil((element.scrollTop+element.clientHeight)/ROW_HEIGHT);
        const visible=new Set(current.flat.slice(first,last+1).map(row=>row.fileIndex));
        const pendingVisible=queue.findIndex(index=>visible.has(index));
        if(pendingVisible>=0)return queue.splice(pendingVisible,1)[0];
      }
      return queue.shift();
    };
    const runOne = async () => {
      for (let i = takeNext(); i !== undefined && !cancelled; i = takeNext()) {
        const f = files[i]!;
        if(capacityFailure){setState(previous=>({...previous,[i]:{collapsed:false,note:capacityFailure+" This file was not loaded; retry after capacity becomes available."}}));continue;}
        if (workerFailure) { setState((previous) => ({ ...previous, [i]: { collapsed: false, note: workerFailure!.message } })); continue; }
        try {
          const [a, b] = await Promise.all([
            f.aHash ? loadBlob(f.aHash) : Promise.resolve<BlobResult>({ binary: false, truncated: false, size: 0, content: "" }),
            f.bHash ? loadBlob(f.bHash) : Promise.resolve<BlobResult>({ binary: false, truncated: false, size: 0, content: "" }),
          ]);
          if (cancelled) return;
          if (a.binary || b.binary) setState((s) => ({ ...s, [i]: { collapsed: false, note: "Binary file not shown" } }));
          else if (a.truncated || b.truncated) setState((s) => ({ ...s, [i]: { collapsed: false, note: `File is ${((Math.max(a.size, b.size)) / 1048576).toFixed(1)} MB, beyond the 4 MB inline limit. Fetch it with flaregit cat or clone the repository.` } }));
          else {
            const rows = await diffInWorker(i, a.content, b.content, f.path);
            if (!cancelled) {loadedRows.current.set(fileKey(f),rows);setState((s) => ({ ...s, [i]: { collapsed: false, rows } }));}
          }
        } catch (err) {
          if (!cancelled) { if(err instanceof ApiError && [429,413,503].includes(err.status)){capacityFailure=err.message;if(err.retryAfter!==null)setRetryAt(Date.now()+err.retryAfter*1000);}setLoadFailure(true); setState((s) => ({ ...s, [i]: { collapsed: false, note: err instanceof Error ? err.message : "Could not load" } })); }
        }
      }
    };
    void Promise.all([runOne(), runOne(), runOne()]);
    return () => {
      cancelled = true;
      for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error("Review changed")); }
      pending.clear(); worker.terminate(); workerRef.current = null;
    };
  }, [files, loadBlob, revision]);

  const ready = stateFiles === files && !loadFailure && files.every((_, index) => { const item = state[index]; return item && (item.rows !== undefined || item.note !== undefined); });
  useEffect(() => { onReadyChange?.(ready); }, [ready, onReadyChange]);

  const fileStarts = useMemo(() => flat.flatMap((r, i) => (r.kind === "file" ? [i] : [])), [flat]);
  const hunkStarts = useMemo(() => flat.flatMap((r, i) => (r.kind === "line" && r.row.t === "h" ? [i] : [])), [flat]);

  const currentIndex = useCallback(() => Math.max(0, Math.floor((parentRef.current?.scrollTop ?? 0) / ROW_HEIGHT)), []);
  const jump = useCallback((starts: number[], dir: 1 | -1) => {
    endIntent.current=null;
    const here = currentIndex();
    const target = dir === 1 ? starts.find((i) => i > here) : [...starts].reverse().find((i) => i < here);
    if (target !== undefined) virtualizer.scrollToOffset(target * ROW_HEIGHT);
  }, [virtualizer, currentIndex]);

  const toggleCurrent = useCallback(() => {
    const here = currentIndex();
    const row = flat[here];
    if (!row) return;
    setState((s) => ({ ...s, [row.fileIndex]: { ...(s[row.fileIndex] ?? { collapsed: false }), collapsed: !(s[row.fileIndex]?.collapsed ?? false) } }));
  }, [flat, currentIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j") jump(fileStarts, 1);
      else if (e.key === "k") jump(fileStarts, -1);
      else if (e.key === "n") jump(hunkStarts, 1);
      else if (e.key === "p") jump(hunkStarts, -1);
      else if (e.key === "c") toggleCurrent();
      else if (e.key === "g") {endIntent.current=null;virtualizer.scrollToOffset(0);}
      else if (e.key === "G") {endIntent.current=files;virtualizer.scrollToEnd();}
      else if (e.key === "?") setHelpOpen((v) => !v);
      else if (e.key === "Escape") setHelpOpen(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jump, fileStarts, hunkStarts, toggleCurrent, virtualizer, files]);

  if (files.length === 0) return <p className="text-sm text-muted-foreground">No file changes.</p>;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border text-xs text-muted-foreground bg-muted/20">
        <span>{files.length} file{files.length === 1 ? "" : "s"} changed</span>
        {loadFailure && <Button size="sm" variant="outline" disabled={retryAt!==null && retryAt>Date.now()} onClick={() => setRevision((value) => value + 1)}>Retry diff files</Button>}
        <button className="flex items-center gap-1 hover:text-foreground" onClick={() => setHelpOpen((v) => !v)}><Keyboard className="h-3.5 w-3.5" /> shortcuts (?)</button>
      </div>
      {retryAt!==null && retryAt>Date.now() && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">Read capacity is temporarily unavailable. Retry after {new Date(retryAt).toLocaleTimeString()}.</p>}
      {helpOpen && (
        <div className="px-3 py-2 text-xs border-b border-border bg-muted/30 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1">
          <span><kbd>j</kbd>/<kbd>k</kbd> next/previous file</span>
          <span><kbd>n</kbd>/<kbd>p</kbd> next/previous hunk</span>
          <span><kbd>c</kbd> collapse file</span>
          <span><kbd>g</kbd>/<kbd>G</kbd> top/bottom</span>
        </div>
      )}
      <div ref={parentRef} onWheel={(event)=>{if(event.deltaY<0)endIntent.current=null;}} onTouchStart={()=>{endIntent.current=null;}} onPointerDown={()=>{endIntent.current=null;}} onScroll={(event)=>{const element=event.currentTarget;if(endIntent.current===files&&element.scrollHeight-element.clientHeight-element.scrollTop>ROW_HEIGHT)endIntent.current=null;}} className="h-[70vh] overflow-auto font-mono text-[11px] sm:text-xs touch-pan-x touch-pan-y" tabIndex={0} aria-label="Diff">
        <div style={{ height: virtualizer.getTotalSize(), width: "max-content", minWidth: "100%", position: "relative" }}>
          {virtualizer.getVirtualItems().map((v) => {
            const r = flat[v.index]!;
            const style: React.CSSProperties = { position: "absolute", top: 0, left: 0, minWidth: "100%", height: ROW_HEIGHT, transform: `translateY(${v.start}px)` };
            if (r.kind === "file") {
              const collapsed = state[r.fileIndex]?.collapsed;
              return (
                <div key={v.key} style={style} className="flex items-center gap-2 px-3 bg-muted/50 border-y border-border sticky z-10">
                  {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  <span className={STATUS_COLOR[r.file.status]}>{r.file.status[0]!.toUpperCase()}</span>
                  <span className="font-semibold">{r.file.path}</span>
                  <span className="text-emerald-700 dark:text-emerald-400">+{r.adds}</span>
                  <span className="text-red-700 dark:text-red-400">−{r.dels}</span>
                </div>
              );
            }
            if (r.kind === "note") return <div key={v.key} style={style} className="px-3 text-muted-foreground">{r.text}</div>;
            const { row } = r;
            const bg = row.t === "+" ? "bg-emerald-500/10" : row.t === "-" ? "bg-red-500/10" : row.t === "h" ? "bg-sky-500/10 text-sky-700 dark:text-sky-300" : "";
            return (
              <div key={v.key} style={style} className={`flex whitespace-pre ${bg}`}>
                <span className="hidden sm:block w-10 shrink-0 text-right pr-2 text-muted-foreground select-none">{row.a ?? ""}</span>
                {(() => {
                  const line = row.b ?? row.a;
                  const path = files[r.fileIndex]!.path;
                  const has = line !== undefined && commented?.has(`${path}:${line}`);
                  return onLineClick && line !== undefined ? (
                    <button className={`sticky left-0 z-10 bg-background w-9 sm:w-10 shrink-0 text-right pr-2 select-none hover:text-orange-700 dark:hover:text-orange-400 ${has ? "text-orange-700 dark:text-orange-400 font-bold" : "text-muted-foreground"}`} aria-label={`Comment on ${path} ${row.b === undefined ? "base" : "candidate"} line ${line}`} onClick={() => onLineClick(path, line)}>{line}</button>
                  ) : (
                    <span className="sticky left-0 z-10 bg-background w-9 sm:w-10 shrink-0 text-right pr-2 text-muted-foreground select-none">{line ?? ""}</span>
                  );
                })()}
                <span className="w-4 shrink-0 select-none">{row.t === "h" ? "" : row.t}</span>
                <CodeLine text={row.text} html={row.html} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
