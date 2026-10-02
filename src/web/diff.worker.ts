import { structuredPatch } from "diff";
import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import bash from "highlight.js/lib/languages/bash";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("yaml", yaml);

const EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", json: "json", jsonc: "json",
  css: "css", html: "xml", xml: "xml", svg: "xml", md: "markdown", py: "python", go: "go", rs: "rust", sh: "bash", yml: "yaml", yaml: "yaml",
};
const languageFor = (path: string | undefined) => (path ? EXT[path.split(".").pop()?.toLowerCase() ?? ""] : undefined);

export interface DiffRow {
  /** "h" hunk header, "+" added, "-" removed, " " context */
  t: "h" | "+" | "-" | " ";
  text: string;
  /** Syntax-highlighted HTML of `text` (highlight.js escapes everything it emits). */
  html?: string;
  a?: number;
  b?: number;
}

export interface DiffRequest {
  id: number;
  a: string;
  b: string;
  path?: string;
}

// Diffing runs off the main thread so a 10,000-line change never freezes scrolling.
self.onmessage = (event: MessageEvent<DiffRequest>) => {
  const { id, a, b, path } = event.data;
  const lang = languageFor(path);
  const mark = (text: string) => (lang && text.length < 2000 ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value : undefined);
  const patch = structuredPatch("a", "b", a, b, "", "", { context: 3 });
  const rows: DiffRow[] = [];
  for (const hunk of patch.hunks) {
    rows.push({ t: "h", text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@` });
    let ao = hunk.oldStart;
    let bo = hunk.newStart;
    for (const line of hunk.lines) {
      const sign = line[0];
      if (sign === "+") rows.push({ t: "+", text: line.slice(1), html: mark(line.slice(1)), b: bo++ });
      else if (sign === "-") rows.push({ t: "-", text: line.slice(1), html: mark(line.slice(1)), a: ao++ });
      else if (sign === " ") rows.push({ t: " ", text: line.slice(1), html: mark(line.slice(1)), a: ao++, b: bo++ });
    }
  }
  (self as unknown as Worker).postMessage({ id, rows });
};
