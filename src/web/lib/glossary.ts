/**
 * The single source of user-facing vocabulary. Server contracts keep their own field names
 * (candidate, evidence, journal…); the interface only ever speaks these words.
 */
export const glossary = {
  preview: "combined preview",
  previews: "combined previews",
  Preview: "Combined preview",
  combine: "combine",
  Combine: "Combine",
  checks: "checks",
  Checks: "Checks",
  merge: "merge",
  Merge: "Merge",
  merged: "merged",
  Merged: "Merged",
  record: "record",
  Record: "Record",
  contribution: "contribution",
  Contribution: "Contribution",
} as const;

/** How a combined preview was built, said as an outcome rather than a Git method name. */
export const combinedHow: Readonly<Record<"clean_git_merge" | "repaired_merge" | "rebase_linear", string>> = {
  clean_git_merge: "Combined cleanly with the latest merged version",
  repaired_merge: "Combined after AI repaired conflicting edits",
  rebase_linear: "Replayed on top of the latest merged version",
};

/** One horizontal lifecycle shared by every change, in display order. */
export const changeSteps = [
  { id: "contribution", label: "Contribution", hint: "Work is being pushed to its own isolated copy. Mark ready verifies the pushed branch." },
  { id: "ready", label: "Ready", hint: "Verified and waiting to be combined. Combine this change builds a combined preview on the latest merged version." },
  { id: "verifying", label: "Verifying", hint: "Your protected checks are running on the combined preview. Watch checks shows their progress." },
  { id: "review", label: "Needs review", hint: "Checks finished. Review opens the diff and checks so you can merge or send it back." },
  { id: "merged", label: "Merged", hint: "The exact reviewed commit is now part of the repository history." },
] as const;

export type ChangeStepId = (typeof changeSteps)[number]["id"];

/** Display labels for server status values; unknown values fall back to readable text. */
const statusLabels: Record<string, string> = {
  accepted: "Merged",
  awaiting_review: "Needs review",
  verified: "Checks passed",
  verifying: "Verifying",
  composing: "Combining",
  repairing: "Repairing",
  failed: "Failed",
  superseded: "Replaced",
  rejected: "Rejected",
  ready: "Ready",
  working: "In progress",
  blocked: "Blocked",
};

export function statusLabel(status: string): string {
  return statusLabels[status] ?? status.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
}
