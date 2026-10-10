/**
 * Commit message for merging one change into a combined preview. People read the subject in history, so it
 * is the change's goal in plain words; platform identities stay in Git trailers for tools.
 */
export function mergeCommitMessage(input: { goal?: string; candidateId: string; taskId: string; commit?: string }): string {
  const subject = (input.goal ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || `Change ${input.taskId}`;
  return [subject, "", "Merged by FlareGit after review.", "", `FlareGit-Change: ${input.taskId}`, `FlareGit-Candidate: ${input.candidateId}`, ...(input.commit ? [`FlareGit-Change-Commit: ${input.commit}`] : [])].join("\n");
}

/** Squash landing: one commit for every change in the preview, with the same plain subject and trailers. */
export function landingCommitMessage(input: { candidateId: string; changes: ReadonlyArray<{ id: string; goal?: string }>; coauthors: readonly string[] }): string {
  const goals = input.changes.map((change) => (change.goal ?? "").replace(/\s+/g, " ").trim() || `Change ${change.id}`);
  const subject = (goals.length === 1 ? goals[0]! : goals.join("; ")).slice(0, 120);
  const list = goals.length > 1 ? ["", ...goals.map((goal) => `- ${goal}`)] : [];
  return [subject, ...list, "", "Merged by FlareGit after review.", "", ...input.changes.map((change) => `FlareGit-Change: ${change.id}`), `FlareGit-Candidate: ${input.candidateId}`, ...input.coauthors].join("\n");
}
