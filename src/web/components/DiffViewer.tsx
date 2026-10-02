import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Keyboard } from "lucide-react";
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
  | { kind: "line"; fileIndex: number; row: DiffRow }
  | { kind: "note"; fileIndex: number; text: string };

const ROW_HEIGHT = 20;
const STATUS_COLOR: Record<FileChange["status"], string> = { added: "text-emerald-400", modified: "text-amber-400", deleted: "text-red-400" };

/**
 * Virtualized review canvas: only the rows in view are in the DOM, diffs are computed in a Web Worker,
 * file contents load lazily, and everything is reachable from the keyboard.
 */
export function DiffViewer({ files, loadBlob }: { files: FileChange[]; loadBlob: (hash: string) => Promise<BlobResult> }) {
  const [state, setState] = useState<Record<number, FileState>>({});
  const [helpOpen, setHelpOpen] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);

  const flat = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    files.forEach((file, fileIndex) => {
      const st = state[fileIndex];
      const rows = st?.rows ?? [];
      out.push({ kind: "file", file, fileIndex, adds: rows.filter((r) => r.t === "+").length, dels: rows.filter((r) => r.t === "-").length });
      if (st?.collapsed) return;
      if (st?.note) out.push({ kind: "note", fileIndex, text: st.note });
      else if (!st?.rows) out.push({ kind: "note", fileIndex, text: "Loading…" });
      else for (const row of st.rows) out.push({ kind: "line", fileIndex, row });
    });
    return out;
  }, [files, state]);

  const virtualizer = useVirtualizer({ count: flat.length, getScrollElement: () => parentRef.current, estimateSize: () => ROW_HEIGHT, overscan: 30 });

  // Compute each file's diff in the worker, three at a time.
  useEffect(() => {
    const worker = new Worker(new URL("../diff.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    let cancelled = false;
    const pending = new Map<number, (rows: DiffRow[]) => void>();
    worker.onmessage = (e: MessageEvent<{ id: number; rows: DiffRow[] }>) => {
      pending.get(e.data.id)?.(e.data.rows);
      pending.delete(e.data.id);
    };
    const diffInWorker = (id: number, a: string, b: string, path: string) =>
      new Promise<DiffRow[]>((resolve) => {
        pending.set(id, resolve);
        worker.postMessage({ id, a, b, path } satisfies DiffRequest);
      });

    const queue = files.map((_, i) => i);
    const runOne = async () => {
      for (let i = queue.shift(); i !== undefined && !cancelled; i = queue.shift()) {
        const f = files[i]!;
        try {
          const [a, b] = await Promise.all([
            f.aHash ? loadBlob(f.aHash) : Promise.resolve<BlobResult>({ binary: false, truncated: false, size: 0, content: "" }),
            f.bHash ? loadBlob(f.bHash) : Promise.resolve<BlobResult>({ binary: false, truncated: false, size: 0, content: "" }),
          ]);
          if (cancelled) return;
          if (a.binary || b.binary) setState((s) => ({ ...s, [i]: { collapsed: false, note: "Binary file not shown" } }));
          else if (a.truncated || b.truncated) setState((s) => ({ ...s, [i]: { collapsed: false, note: "File too large to display" } }));
          else {
            const rows = await diffInWorker(i, a.content, b.content, f.path);
            if (!cancelled) setState((s) => ({ ...s, [i]: { collapsed: false, rows } }));
          }
        } catch (err) {
          if (!cancelled) setState((s) => ({ ...s, [i]: { collapsed: false, note: err instanceof Error ? err.message : "Could not load" } }));
        }
      }
    };
    void Promise.all([runOne(), runOne(), runOne()]);
    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [files, loadBlob]);

  const fileStarts = useMemo(() => flat.flatMap((r, i) => (r.kind === "file" ? [i] : [])), [flat]);
  const hunkStarts = useMemo(() => flat.flatMap((r, i) => (r.kind === "line" && r.row.t === "h" ? [i] : [])), [flat]);

  const currentIndex = () => virtualizer.getVirtualItems()[0]?.index ?? 0;
  const jump = useCallback((starts: number[], dir: 1 | -1) => {
    const here = currentIndex();
    const target = dir === 1 ? starts.find((i) => i > here) : [...starts].reverse().find((i) => i < here);
    if (target !== undefined) virtualizer.scrollToIndex(target, { align: "start" });
  }, [virtualizer]);

  const toggleCurrent = useCallback(() => {
    const here = currentIndex();
    const row = flat[here];
    if (!row) return;
    setState((s) => ({ ...s, [row.fileIndex]: { ...(s[row.fileIndex] ?? { collapsed: false }), collapsed: !(s[row.fileIndex]?.collapsed ?? false) } }));
  }, [flat, virtualizer]);

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
      else if (e.key === "g") virtualizer.scrollToIndex(0);
      else if (e.key === "G") virtualizer.scrollToIndex(flat.length - 1);
      else if (e.key === "?") setHelpOpen((v) => !v);
      else if (e.key === "Escape") setHelpOpen(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jump, fileStarts, hunkStarts, toggleCurrent, virtualizer, flat.length]);

  if (files.length === 0) return <p className="text-sm text-muted-foreground">No file changes.</p>;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border text-xs text-muted-foreground bg-muted/20">
        <span>{files.length} file{files.length === 1 ? "" : "s"} changed</span>
        <button className="flex items-center gap-1 hover:text-foreground" onClick={() => setHelpOpen((v) => !v)}><Keyboard className="h-3.5 w-3.5" /> shortcuts (?)</button>
      </div>
      {helpOpen && (
        <div className="px-3 py-2 text-xs border-b border-border bg-muted/30 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1">
          <span><kbd>j</kbd>/<kbd>k</kbd> next/previous file</span>
          <span><kbd>n</kbd>/<kbd>p</kbd> next/previous hunk</span>
          <span><kbd>c</kbd> collapse file</span>
          <span><kbd>g</kbd>/<kbd>G</kbd> top/bottom</span>
        </div>
      )}
      <div ref={parentRef} className="h-[70vh] overflow-auto font-mono text-[11px] sm:text-xs touch-pan-x touch-pan-y" tabIndex={0} aria-label="Diff">
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
                  <span className="text-emerald-400">+{r.adds}</span>
                  <span className="text-red-400">−{r.dels}</span>
                </div>
              );
            }
            if (r.kind === "note") return <div key={v.key} style={style} className="px-3 text-muted-foreground">{r.text}</div>;
            const { row } = r;
            const bg = row.t === "+" ? "bg-emerald-500/10" : row.t === "-" ? "bg-red-500/10" : row.t === "h" ? "bg-sky-500/10 text-sky-300" : "";
            return (
              <div key={v.key} style={style} className={`flex whitespace-pre ${bg}`}>
                <span className="hidden sm:block w-10 shrink-0 text-right pr-2 text-muted-foreground select-none">{row.a ?? ""}</span>
                <span className="sticky left-0 z-10 bg-background w-9 sm:w-10 shrink-0 text-right pr-2 text-muted-foreground select-none">{row.b ?? row.a ?? ""}</span>
                <span className="w-4 shrink-0 select-none">{row.t === "h" ? "" : row.t}</span>
                {row.html ? <span className="hljs-line" dangerouslySetInnerHTML={{ __html: row.html }} /> : <span>{row.text}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
