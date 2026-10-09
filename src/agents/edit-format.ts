import { z } from "zod";

/**
 * Targeted edit format for the iterative coding agent. The model answers with a
 * short plan, a reasoning summary and a list of edits. Each `<edit>` holds one or
 * more search/replace pairs that must match the CURRENT file exactly once, so a
 * stale or hallucinated edit is refused instead of silently rewriting a file.
 * `<create>` is only valid for paths that do not exist yet.
 *
 *   <plan>
 *   - Add a guard for empty carts
 *   </plan>
 *   <edit path="src/cart.ts">
 *   <search>
 *   return total;
 *   </search>
 *   <replace>
 *   return items.length ? total : 0;
 *   </replace>
 *   </edit>
 *   <create path="src/new.ts">
 *   export const x = 1;
 *   </create>
 *   <reasoning>Why this change satisfies the task.</reasoning>
 */

export const MAX_EDIT_FILES = 20;
export const MAX_REPLACEMENTS_PER_FILE = 20;
export const MAX_EDIT_TEXT = 60_000;

const pathSchema = z.string().min(1).max(500).refine((path) => !/[\x00-\x1f\\"<>]/.test(path), "Invalid path");
const replacementSchema = z.object({ search: z.string().min(1).max(MAX_EDIT_TEXT), replace: z.string().max(MAX_EDIT_TEXT) }).strict();
export const agentEditSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("replace"), path: pathSchema, replacements: z.array(replacementSchema).min(1).max(MAX_REPLACEMENTS_PER_FILE) }).strict(),
  z.object({ kind: z.literal("create"), path: pathSchema, content: z.string().max(MAX_EDIT_TEXT) }).strict(),
]);
export const agentResponseSchema = z.object({
  plan: z.array(z.string().min(1).max(300)).max(12),
  reasoning: z.string().max(1200),
  edits: z.array(agentEditSchema).max(MAX_EDIT_FILES),
}).strict();
export type AgentEdit = z.infer<typeof agentEditSchema>;
export type AgentResponse = z.infer<typeof agentResponseSchema>;

const BLOCK = /<(edit|create) path="([^"\n]+)">\n([\s\S]*?)\n?<\/\1>/g;
const PAIR = /<search>\n([\s\S]*?)\n<\/search>\s*<replace>\n?([\s\S]*?)\n?<\/replace>/g;
const section = (output: string, tag: string) => new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`).exec(output)?.[1]?.trim() ?? "";

/** Parses a model answer. Throws only on structurally invalid answers; an answer with no edits is valid. */
export function parseAgentResponse(output: string): AgentResponse {
  const text = output.replace(/<think>[\s\S]*?<\/think>/g, "");
  const plan = section(text, "plan").split("\n").map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean).slice(0, 12).map((line) => line.slice(0, 300));
  const reasoning = section(text, "reasoning").slice(0, 1200);
  const edits: AgentEdit[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(BLOCK)) {
    const [, kind, path, body] = match as unknown as [string, "edit" | "create", string, string];
    if (seen.has(path)) throw new Error(`The answer edits ${path} more than once; combine its changes into one block`);
    seen.add(path);
    if (kind === "create") { edits.push({ kind: "create", path, content: body }); continue; }
    const replacements = [...body.matchAll(PAIR)].map((pair) => ({ search: pair[1]!, replace: pair[2] ?? "" }));
    if (!replacements.length) throw new Error(`The edit for ${path} has no <search>/<replace> pair`);
    edits.push({ kind: "replace", path, replacements });
  }
  return agentResponseSchema.parse({ plan, reasoning, edits });
}

export class EditRejectedError extends Error {}

const occurrences = (haystack: string, needle: string) => {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1 && count < 2; at = haystack.indexOf(needle, at + 1)) count++;
  return count;
};

/**
 * Applies validated edits to the current file snapshot. Every edit is checked
 * before anything is returned, so a single rejected edit leaves no partial
 * result. Returns only the files whose content changed.
 */
export function applyAgentEdits(current: Readonly<Record<string, string>>, edits: readonly AgentEdit[], maxFileBytes = MAX_EDIT_TEXT): Record<string, string> {
  const next: Record<string, string> = {};
  for (const edit of agentResponseSchema.shape.edits.parse(edits)) {
    const before = Object.hasOwn(current, edit.path) ? current[edit.path] : undefined;
    let after: string;
    if (edit.kind === "create") {
      if (before !== undefined) throw new EditRejectedError(`${edit.path} already exists; change it with search/replace instead of recreating it`);
      after = edit.content.endsWith("\n") ? edit.content : `${edit.content}\n`;
    } else {
      if (before === undefined) throw new EditRejectedError(`${edit.path} is not one of the files you were shown; only edit shown files or create new ones`);
      after = before;
      for (const { search, replace } of edit.replacements) {
        const found = occurrences(after, search);
        if (found === 0) throw new EditRejectedError(`A search block for ${edit.path} does not match the current file exactly`);
        if (found > 1) throw new EditRejectedError(`A search block for ${edit.path} matches more than once; include more surrounding lines`);
        after = after.replace(search, () => replace);
      }
    }
    if (new TextEncoder().encode(after).length > maxFileBytes) throw new EditRejectedError(`${edit.path} would exceed the size limit`);
    if (after !== before) next[edit.path] = after;
  }
  return next;
}

export const EDIT_FORMAT_INSTRUCTIONS = [
  "Answer in exactly this format and nothing else:",
  "<plan>\n- one short step per line (at most 6)\n</plan>",
  '<edit path="PATH">\n<search>\nexact lines copied from the current file\n</search>\n<replace>\nthe new lines\n</replace>\n</edit>',
  '<create path="NEW_PATH">\nfull content of a brand-new file\n</create>',
  "<reasoning>Two or three plain sentences explaining why the change satisfies the task.</reasoning>",
  "Rules: each <search> must match the current file exactly once (copy it verbatim, including indentation). Use several <search>/<replace> pairs inside one <edit> for several places in a file. Never rewrite a whole existing file. Only edit files shown to you.",
].join("\n");
