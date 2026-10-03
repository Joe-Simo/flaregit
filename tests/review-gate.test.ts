import { expect, test } from "bun:test";
import { blocksExternalAcceptance } from "../src/web/review-gate";
const available = { known: true, readFailed: false, identityMismatch: false, gate: "passed" as const, retryingRequired: false };
test("optional external reporting failure never gates native acceptance", () => {
  expect(blocksExternalAcceptance({ ...available, required: false, known: false, readFailed: true, gate: "pending" })).toBe(false);
  expect(blocksExternalAcceptance({ ...available, required: false, gate: "failed" })).toBe(false);
});
test("required checks fail closed for unknown, failed, pending and retrying evidence", () => {
  for (const change of [{ known: false }, { readFailed: true }, { gate: "pending" as const }, { gate: "failed" as const }, { retryingRequired: true }]) expect(blocksExternalAcceptance({ ...available, required: true, ...change })).toBe(true);
  expect(blocksExternalAcceptance({ ...available, required: true })).toBe(false);
});
test("mismatched evidence always blocks even when checks are optional", () => {
  expect(blocksExternalAcceptance({ ...available, required: false, identityMismatch: true })).toBe(true);
});


import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CandidateReview } from "../src/web/components/CandidateReview";
import type { CandidateGeneration } from "../src/core/types";
const candidate: CandidateGeneration = { id: "synthetic-review", attemptNumber: 1, participatingTaskIds: [], participatingCommits: {}, expectedAcceptedBase: "a".repeat(40), frozenPolicyVersion: 1, frozenVerificationPolicy: {}, frozenRequirements: [], candidateCommit: "b".repeat(40), repairAttempts: [], status: "awaiting_review", createdAt: "2026-10-03", updatedAt: "2026-10-03" };
function reviewButtonDisabled(label: string, isOwner: boolean, reviewReady = true, value = candidate): boolean {
  const html = renderToStaticMarkup(createElement(CandidateReview, { projectId: "synthetic-repository", candidate: value, onDone: () => {}, isOwner, reviewReady }));
  const button = Array.from(html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)).find((match) => match[2]?.includes(label));
  if (!button) throw new Error(`Missing review control: ${label}`);
  return /\bdisabled=/.test(button[1]!);
}
test("rendered review controls enforce existing owner permission", () => {
  expect(reviewButtonDisabled("Accept into history", false)).toBe(true);
  expect(reviewButtonDisabled("Reject", false)).toBe(true);
  expect(reviewButtonDisabled("Accept into history", true)).toBe(false);
  expect(reviewButtonDisabled("Reject", true)).toBe(false);
});
test("approval waits for current diff while rejection remains available on the exact commit", () => {
  expect(reviewButtonDisabled("Accept into history", true, false)).toBe(true);
  expect(reviewButtonDisabled("Reject", true, false)).toBe(false);
  expect(reviewButtonDisabled("Accept into history", true, true, { ...candidate, candidateCommit: undefined })).toBe(true);
  expect(reviewButtonDisabled("Reject", true, true, { ...candidate, candidateCommit: undefined })).toBe(true);
});

import { CandidatePurpose } from "../src/web/components/CandidateReview";
import { parseSignedRepositoryBrowseRequest } from "../src/server/public-repositories";
import type { Task } from "../src/core/types";
test("frozen input bytes require the same candidate and input scope as their diff", () => {
  const hash = "a".repeat(40);
  expect(parseSignedRepositoryBrowseRequest("/blob-by-hash", new URLSearchParams({ hash, candidate: "candidate-frozen", input: "working" }))).toMatchObject({ kind: "blob", hash, candidate: "candidate-frozen", input: "working", task: undefined });
  const invalidScopes: Record<string, string>[] = [{ input: "working" }, { candidate: "candidate-frozen" }, { candidate: "candidate-frozen", input: "working", task: "working" }];
  for (const scope of invalidScopes) {
    expect(() => parseSignedRepositoryBrowseRequest("/blob-by-hash", new URLSearchParams({ hash, ...scope }))).toThrow();
  }
});
test("rendered frozen-input links select the recorded candidate input after a task advances", () => {
  const task: Task = { id: "working", goal: "Synthetic frozen contribution", contributor: { id: "contributor", name: "Contributor", type: "human" }, baseCommit: "a".repeat(40), currentCommit: "c".repeat(40), requirements: [], allowedScope: [], status: "accepted", workspace: { repoName: "synthetic-fork", remote: "https://fixture.invalid", branch: "task/working" }, checkpoints: [], createdAt: "2026-10-03", updatedAt: "2026-10-03" };
  const value = { ...candidate, participatingTaskIds: [task.id], participatingCommits: { [task.id]: "b".repeat(40) } };
  const html = renderToStaticMarkup(createElement(CandidatePurpose, { projectId: "synthetic-repository", candidate: value, tasks: { [task.id]: task } }));
  const link = html.match(/href="([^"]+)"/);
  if (!link) throw new Error("Missing frozen-input review link");
  const route = new URL(link[1]!.replaceAll("&amp;", "&").slice(1), "https://fixture.invalid");
  expect(route.pathname).toBe("/p/synthetic-repository/review");
  expect(parseSignedRepositoryBrowseRequest("/diff", route.searchParams)).toMatchObject({ kind: "diff", candidate: value.id, input: task.id, commit: undefined, task: undefined });
  expect(html).toContain("This contribution has advanced");
  expect(html).toContain(`title="${"b".repeat(40)}"`);
});
