import { assertCompatibleAcceptedTargetBatch, type FrozenAcceptedTarget } from "../core/accepted-target";
import { isSafeRef } from "../core/sanitize";
import type { AcceptanceRecord, PublicationJournalEntry } from "../core/types";
import type { AcceptedBranchRoot } from "./accepted-branch-roots";
import type { AcceptedDeploymentTarget } from "./deployments";

export interface AcceptedDeploymentContext {
  projectId: string; incarnation: string; canonicalRepoName: string; primaryRef: string | null;
  journals: readonly PublicationJournalEntry[]; primaryHistory: readonly AcceptanceRecord[];
  roots: readonly AcceptedBranchRoot[];
}
export interface AcceptedDeploymentSelection {
  projectId: string; incarnation: string; canonicalRepoName: string;
  target: AcceptedDeploymentTarget;
  pinVerified: false;
}
export interface CommittedDeploymentPin {
  projectId: string; incarnation: string; canonicalRepoName: string;
  ref: string; commit: string; tree: string; verified: true;
}
const sha = (value: string | undefined): value is string => typeof value === "string" && /^[a-f0-9]{40}$/.test(value) && !/^0{40}$/.test(value);
const branchRef = (value: string) => value.startsWith("refs/heads/") && isSafeRef(value);
const time = (value: string) => Number.isFinite(Date.parse(value));
function compatibleTarget(first: FrozenAcceptedTarget, second: FrozenAcceptedTarget): boolean {
  try { assertCompatibleAcceptedTargetBatch([first, second]); return true; } catch { return false; }
}

/** Recorded acceptance selection only. Historical branch receipts remain valid
 * after its head advances. Neither selection nor these pure checks read a provider.
 * Missing explicit branch authority never falls back to the primary branch.
 */
export function selectAcceptedDeploymentJournal(context: AcceptedDeploymentContext, journalId: string): AcceptedDeploymentSelection | null {
  if (!context.projectId || !context.canonicalRepoName || !/^[a-f0-9-]{36}$/.test(context.incarnation) || context.primaryRef !== null && !branchRef(context.primaryRef) || context.journals.length > 2000 || context.roots.length > 1000 || context.primaryHistory.length > 2000) return null;
  const matches = context.journals.filter(entry => entry.id === journalId);
  if (matches.length !== 1) return null;
  const journal = matches[0]!;
  const frozen = journal.acceptedTarget ?? journal.publicationAuthority?.acceptedTarget;
  const candidateCommitValid = journal.candidateCommit === journal.newHead || (!frozen && !journal.publicationAuthority && journal.candidateCommit === undefined);
  if (journal.state !== "ACCEPTED" || journal.id.length > 200 || !isSafeRef(journal.id) || !sha(journal.newHead) || !candidateCommitValid || !sha(journal.candidateTree)) return null;
  if (journal.publicationAuthority && (journal.publicationAuthority.commit !== journal.newHead || journal.publicationAuthority.tree !== journal.candidateTree)) return null;
  let acceptedRef: string | undefined, acceptedRootVersion: number | undefined, acceptedAt: string;
  if (frozen) {
    if (frozen.projectId !== context.projectId || frozen.incarnation !== context.incarnation || frozen.canonicalRepoName !== context.canonicalRepoName || !branchRef(frozen.ref) || frozen.ref !== `refs/heads/${frozen.branch}` || frozen.acceptedCommit !== journal.expectedHead || !Number.isSafeInteger(frozen.acceptedVersion) || frozen.acceptedVersion < 0) return null;
    const roots = context.roots.filter(root => root.projectId === context.projectId && root.incarnation === context.incarnation && root.canonicalRepoName === context.canonicalRepoName && root.ref === frozen.ref);
    if (roots.length !== 1) return null;
    const root = roots[0]!, receipt = root.history[frozen.acceptedVersion];
    if (root.status !== "ready" || root.version < frozen.acceptedVersion + 1 || receipt?.operationId !== journal.id || receipt.commit !== journal.newHead) return null;
    if (journal.publicationAuthority && journal.publicationAuthority.policyVersion !== frozen.policyVersion) return null;
    if (journal.publicationAuthority?.acceptedTarget && !compatibleTarget(journal.publicationAuthority.acceptedTarget, frozen)) return null;
    if (root.kind === "primary") {
      if (context.primaryRef !== null && frozen.ref !== context.primaryRef) return null;
      // Primary reconciliation stores plain commit/journal ancestry. Its genuine
      // acceptance metadata lives in primaryHistory, not invented branch receipts.
      const accepted = context.primaryHistory.filter(entry => entry.commit === journal.newHead && entry.candidateId === journal.candidateId && entry.outputDigest === journal.outputDigest && (!entry.acceptedTarget || compatibleTarget(entry.acceptedTarget, frozen)));
      if (accepted.length !== 1 || !time(accepted[0]!.acceptedAt)) return null;
      acceptedAt = accepted[0]!.acceptedAt;
    } else {
      if (frozen.ref === context.primaryRef || !receipt.acceptance || receipt.acceptance.journalId !== journal.id || receipt.acceptance.candidateId !== journal.candidateId || receipt.acceptance.tree !== journal.candidateTree || receipt.acceptance.outputDigest !== journal.outputDigest || !time(receipt.acceptance.acceptedAt)) return null;
      acceptedAt = receipt.acceptance.acceptedAt;
    }
    acceptedRef = frozen.ref; acceptedRootVersion = frozen.acceptedVersion + 1;
  } else {
    // Compatibility applies only to primary history records without a target.
    const accepted = context.primaryHistory.filter(entry => !entry.acceptedTarget && entry.commit === journal.newHead && entry.candidateId === journal.candidateId);
    if (accepted.length !== 1 || accepted[0]!.outputDigest !== journal.outputDigest || !time(accepted[0]!.acceptedAt)) return null;
    acceptedRef = context.primaryRef ?? undefined; acceptedAt = accepted[0]!.acceptedAt;
  }
  return { projectId: context.projectId, incarnation: context.incarnation, canonicalRepoName: context.canonicalRepoName, pinVerified: false, target: { journalId: journal.id, candidateId: journal.candidateId, commit: journal.newHead, tree: journal.candidateTree, acceptedAt, recoverableRef: `refs/flaregit/deployments/${journal.id}`, ...(acceptedRef !== undefined ? { acceptedRef } : {}), ...(acceptedRootVersion !== undefined ? { acceptedRootVersion } : {}) } };
}

/** The caller must obtain this proof through funded native readback, not a client
 * JSON body. Commit/tree pin evidence is distinct from mutable branch-head state.
 */
export function confirmAcceptedDeploymentSelection(selection: AcceptedDeploymentSelection, pin: CommittedDeploymentPin): AcceptedDeploymentTarget {
  if (pin.verified !== true || pin.projectId !== selection.projectId || pin.incarnation !== selection.incarnation || pin.canonicalRepoName !== selection.canonicalRepoName || pin.ref !== selection.target.recoverableRef || pin.commit !== selection.target.commit || pin.tree !== selection.target.tree || !isSafeRef(pin.ref)) throw new Error("Deployment pin does not match the exact accepted target");
  return structuredClone(selection.target);
}
