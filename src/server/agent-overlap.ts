import type { OverlapKind, OverlapWarning } from "../core/agent-board.js";

/** One in-flight agent branch as seen by overlap detection. `contents` holds
 * the saved full-file proposal bytes when a proposal exists; paths known only
 * from Git checkpoints carry `null` (touched, content not held by the DO). */
export interface OverlapParticipant {
  runId: string;
  taskId: string;
  title: string;
  files: ReadonlyMap<string, string | null>;
}

export const overlapId = (path: string, first: string, second: string) => {
  const [a, b] = first < second ? [first, second] : [second, first];
  return `${a}~${b}~${path}`;
};

const classify = (left: string | null, right: string | null): OverlapKind =>
  left === null || right === null ? "same_file" : left === right ? "identical_content" : "divergent_content";

/** Pairwise compatibility check across every in-flight branch of one repository.
 * Path intersection is the textual overlap that `detectCompatibility` reports as
 * `overlappingFiles`; for paths both agents have saved as full-file proposals
 * against the same accepted file, differing bytes mean both sides rewrote it
 * (merge-tree conflicts unless the hunks are disjoint) and identical bytes merge
 * cleanly. The authoritative merge-tree check still runs at integration time.
 * Deterministic order. */
export function detectAgentOverlaps(participants: readonly OverlapParticipant[], detectedAt: string): OverlapWarning[] {
  const sorted = [...participants].sort((x, y) => x.taskId.localeCompare(y.taskId) || x.runId.localeCompare(y.runId));
  const warnings: OverlapWarning[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (a.taskId === b.taskId) continue;
      for (const [path, left] of a.files) {
        if (!b.files.has(path)) continue;
        warnings.push({ id: overlapId(path, a.taskId, b.taskId), path, kind: classify(left, b.files.get(path) ?? null), a: { runId: a.runId, taskId: a.taskId, title: a.title }, b: { runId: b.runId, taskId: b.taskId, title: b.title }, detectedAt });
      }
    }
  }
  return warnings.sort((x, y) => x.id.localeCompare(y.id));
}

const MAX_LINES = 20;
const MAX_FILES_PER_AGENT = 15;

/** Shared context lines an agent prompt receives about concurrent agents. */
export function coordinationContext(runId: string, taskId: string, participants: readonly OverlapParticipant[], warnings: readonly OverlapWarning[]): string[] {
  const lines: string[] = [];
  for (const warning of warnings) {
    const self = warning.a.taskId === taskId ? warning.a : warning.b.taskId === taskId ? warning.b : null;
    if (!self || self.runId !== runId) continue;
    const other = self === warning.a ? warning.b : warning.a;
    const detail = warning.kind === "divergent_content" ? " with different content; a Git merge conflict on this file is likely, so keep your edits to it minimal and compatible"
      : warning.kind === "identical_content" ? " with identical content; no conflict is expected" : "; coordinate to avoid conflicting edits";
    lines.push(`Overlap warning: agent for change ${other.taskId} ("${other.title}") is also editing ${warning.path}${detail}.`);
  }
  const warned = new Set(warnings.flatMap(warning => [warning.a.taskId, warning.b.taskId]));
  for (const other of participants) {
    if (other.taskId === taskId || other.files.size === 0) continue;
    const files = [...other.files.keys()].sort();
    const listed = files.slice(0, MAX_FILES_PER_AGENT).join(", ") + (files.length > MAX_FILES_PER_AGENT ? `, and ${files.length - MAX_FILES_PER_AGENT} more` : "");
    lines.push(`Concurrent agent for change ${other.taskId} ("${other.title}") is editing: ${listed}.${warned.has(other.taskId) ? "" : " Prefer not to modify these files."}`);
  }
  return lines.slice(0, MAX_LINES);
}
