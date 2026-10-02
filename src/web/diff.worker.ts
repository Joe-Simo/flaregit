import { structuredPatch } from "diff";

export interface DiffRow {
  /** "h" hunk header, "+" added, "-" removed, " " context */
  t: "h" | "+" | "-" | " ";
  text: string;
  a?: number;
  b?: number;
}

export interface DiffRequest {
  id: number;
  a: string;
  b: string;
}

// Diffing runs off the main thread so a 10,000-line change never freezes scrolling.
self.onmessage = (event: MessageEvent<DiffRequest>) => {
  const { id, a, b } = event.data;
  const patch = structuredPatch("a", "b", a, b, "", "", { context: 3 });
  const rows: DiffRow[] = [];
  for (const hunk of patch.hunks) {
    rows.push({ t: "h", text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` });
    let ao = hunk.oldStart;
    let bo = hunk.newStart;
    for (const line of hunk.lines) {
      const mark = line[0];
      if (mark === "+") rows.push({ t: "+", text: line.slice(1), b: bo++ });
      else if (mark === "-") rows.push({ t: "-", text: line.slice(1), a: ao++ });
      else if (mark === " ") rows.push({ t: " ", text: line.slice(1), a: ao++, b: bo++ });
    }
  }
  (self as unknown as Worker).postMessage({ id, rows });
};
