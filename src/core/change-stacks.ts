/** F04 slice: stacked changes, suggested edits and fork permissions. */

export interface StackedChange {
  readonly id: string;
  readonly parent?: string;
  readonly merged: boolean;
}

/** A change may merge only when every ancestor is already merged, and the stack must have no cycle. */
export function canMergeInStack(changes: readonly StackedChange[], id: string): {readonly ok: true} | {readonly ok: false; readonly error: string} {
  const byId = new Map(changes.map((change) => [change.id, change]));
  const seen = new Set<string>();
  let current = byId.get(id);
  if (!current) return {ok: false, error: "That change does not exist"};
  while (current.parent !== undefined) {
    if (seen.has(current.id)) return {ok: false, error: "The stack contains a cycle"};
    seen.add(current.id);
    const parent = byId.get(current.parent);
    if (!parent) return {ok: false, error: "A parent change is missing"};
    if (!parent.merged) return {ok: false, error: `Merge ${parent.id} first`};
    current = parent;
  }
  return {ok: true};
}

export interface SuggestedEdit {
  readonly path: string;
  readonly line: number;
  readonly replacement: string;
  readonly authorId: string;
}

/** Applies a suggestion to the exact line. An out-of-range line fails instead of appending. */
export function applySuggestion(content: string, edit: SuggestedEdit): {readonly ok: true; readonly content: string} | {readonly ok: false; readonly error: string} {
  const lines = content.split("\n");
  if (!Number.isSafeInteger(edit.line) || edit.line < 1 || edit.line > lines.length) return {ok: false, error: "The suggestion's line is outside the file"};
  lines[edit.line - 1] = edit.replacement;
  return {ok: true, content: lines.join("\n")};
}

/** Maintainer edits on a fork branch are allowed only when the fork owner enabled them. */
export function maintainerMayPush(forkAllowsMaintainerEdits: boolean, isMaintainer: boolean): boolean {
  return forkAllowsMaintainerEdits && isMaintainer;
}
