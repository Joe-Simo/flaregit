import { NATIVE_INTEGRITY_IDENTITY } from "../verification/integrity.js";
import { acceptedTargetSchema, type UnbornAcceptedTarget } from "../accepted-target.js";
import * as crypto from "node:crypto";
import { authArgs, git } from "./git.js";
import type {
  AcceptanceRecord,
  CandidateGeneration,
  PublicationJournalEntry,
  VerificationEvidence,
} from "../types.js";

export interface PublishOptions {
  /** Bare canonical repository (Artifacts remote in production, local bare repo in tests). */
  /** Bare repo path (local) or https remote (Artifacts). */
  canonicalRepoDir: string;
  /** Short-lived write token for https remotes; sent as a Bearer header, never in the URL. */
  canonicalToken?: string;
  defaultBranch: string;
  candidate: CandidateGeneration;
  evidence: VerificationEvidence;
  /** Repository + ref holding the candidate objects (the integration workspace). */
  candidateRepoDir: string;
  candidateRef: string;
  /** Called synchronously at every journal transition so state survives a crash. */
  /** Trusted recorded missing branch plus an explicit exact human decision. */
  unbornTarget?: UnbornAcceptedTarget;
  rootReview?: {candidateId:string;commit:string;tree:string;actorId:string};
  onJournal?: (entry: PublicationJournalEntry) => void;
}

export interface PublishResult {
  success: boolean;
  journalEntry: PublicationJournalEntry;
  acceptanceRecord?: AcceptanceRecord;
  error?: string;
  staleBase?: boolean;
}

function entry(
  opts: PublishOptions,
  state: PublicationJournalEntry["state"],
  expectedHead: string | null,
  error?: string,
  id?: string
): PublicationJournalEntry {
  return {
    ...(opts.candidate.acceptedTarget ? { acceptedTarget: structuredClone(opts.candidate.acceptedTarget) } : {}),
    id: id ?? `jrnl_${crypto.randomUUID().slice(0, 8)}`,
    candidateId: opts.candidate.id,
    candidateCommit: opts.candidate.candidateCommit ?? "",
    candidateTree: opts.evidence.candidateTree,
    expectedHead,
    newHead: opts.candidate.candidateCommit ?? "",
    outputDigest: opts.evidence.builtOutputDigest,
    ...(opts.rootReview?{publicationAuthority:{acceptedTarget:opts.candidate.acceptedTarget,actor:{userId:opts.rootReview.actorId,displayName:opts.rootReview.actorId,viaToken:false},reviewedAt:new Date().toISOString(),commit:opts.rootReview.commit,tree:opts.rootReview.tree,policyVersion:opts.candidate.frozenPolicyVersion,authorizedAt:new Date().toISOString()}}:{}),
    state,
    timestamp: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
}

/**
 * Publish exactly the verified commit with a compare-and-swap ref update. The ref only moves if the
 * canonical head is still the base this candidate was composed and verified against.
 */
export function publishAcceptedCandidate(opts: PublishOptions): PublishResult {
  const { canonicalRepoDir, candidate, evidence } = opts;
  const commit = candidate.candidateCommit;
  const ref = `refs/heads/${opts.defaultBranch}`;

  const abort = (message: string, expectedHead = candidate.expectedAcceptedBase, stale = false): PublishResult => {
    const journalEntry = entry(opts, "ABORTED", expectedHead, message);
    opts.onJournal?.(journalEntry);
    return { success: false, journalEntry, error: message, staleBase: stale };
  };

  // This compatibility publisher has no target-root authority or reconciliation.
  // Explicit targets must never silently publish through its default branch.
  const unborn = candidate.expectedAcceptedBase === null;
  if (unborn) {
    const target=opts.unbornTarget,review=opts.rootReview;
    if(evidence.verifierIdentity!==NATIVE_INTEGRITY_IDENTITY)return abort("Initial publication requires native Git integrity evidence");
    if(!target||target.kind!=="unborn"||!review||!review.actorId||review.candidateId!==candidate.id||review.commit!==commit||review.tree!==evidence.candidateTree)return abort("Unborn publication requires its recorded target and exact human approval.");
    try{if(JSON.stringify(acceptedTargetSchema.parse(candidate.acceptedTarget))!==JSON.stringify(acceptedTargetSchema.parse(target))||JSON.stringify(acceptedTargetSchema.parse(evidence.acceptedTarget))!==JSON.stringify(acceptedTargetSchema.parse(target))||target.ref!==ref)return abort("Unborn publication target changed.");}catch{return abort("Unborn publication target is invalid.");}
  } else if (candidate.acceptedTarget !== undefined || evidence.acceptedTarget !== undefined) {
    return abort("Explicit accepted-target publication requires a target-aware publisher. No Git operation was dispatched.");
  }
  if (!commit) return abort("Candidate has no commit.");
  if (evidence.status !== "passed") return abort("Candidate has not passed protected verification.");
  if (evidence.candidateCommit !== commit) return abort("Invariant violation: verified commit differs from candidate commit.");
  if (evidence.expectedAcceptedBase !== candidate.expectedAcceptedBase) {
    return abort("Invariant violation: evidence was produced for a different accepted base.");
  }
  if (evidence.requirementsVersion !== candidate.frozenPolicyVersion) {
    return abort("Invariant violation: evidence was produced under a different policy version.");
  }

  const remote = /^https:\/\//.test(canonicalRepoDir);
  const verifyRepo = remote ? opts.candidateRepoDir : canonicalRepoDir;
  const q = remote ? {} : { gitDir: true };

  if (!remote) {
    const fetched = git(canonicalRepoDir, ["fetch", "--quiet", opts.candidateRepoDir, `+${opts.candidateRef}:refs/flaregit/candidates/${candidate.id}`], { gitDir: true });
    if (!fetched.ok) return abort(`Could not transfer candidate objects: ${fetched.stderr.trim()}`);
    const fetchedHead = git(canonicalRepoDir, ["rev-parse", `refs/flaregit/candidates/${candidate.id}`], { gitDir: true }).stdout.trim();
    if (fetchedHead !== commit) return abort("Transferred candidate ref does not point at the verified commit.");
  } else if (git(opts.candidateRepoDir, ["rev-parse", "--verify", `${opts.candidateRef}^{commit}`]).stdout.trim() !== commit) {
    return abort("Candidate ref does not point at the verified commit.");
  }

  const tree = git(verifyRepo, ["rev-parse", `${commit}^{tree}`], q).stdout.trim();
  if (tree !== evidence.candidateTree) return abort("Invariant violation: candidate tree differs from verified tree.");

  const observed = remote
    ? git(opts.candidateRepoDir, [...authArgs(canonicalRepoDir, opts.canonicalToken), "ls-remote", "--refs", canonicalRepoDir, ref])
    : git(canonicalRepoDir, ["for-each-ref", "--format=%(objectname) %(refname)", ref], { gitDir: true });
  if(!observed.ok)return abort("Canonical branch observation is unavailable; publication was not dispatched.");
  const rows=observed.stdout.trim().split("\n").filter(Boolean).map(row=>row.trim().split(/\s+/));
  if(rows.length>1||rows.some(row=>row.length!==2||row[1]!==ref||!(/^[a-f0-9]{40}$/).test(row[0]??"")))return abort("Canonical branch observation is ambiguous; publication was not dispatched.");
  const currentHead=rows[0]?.[0]??"";
  if ((currentHead || null) !== candidate.expectedAcceptedBase) {
    return abort(
      `Canonical ${opts.defaultBranch} moved to ${currentHead.slice(0, 7) || "unknown"}; candidate must be recomposed against it.`,
      candidate.expectedAcceptedBase,
      true
    );
  }

  if(!unborn){
    const ancestor=git(verifyRepo,["merge-base","--is-ancestor",currentHead,commit],q);
    if(!ancestor.ok)return abort("Ancestry check failed: candidate does not descend from canonical head (history rewrite refused).",currentHead);
  }

  const prepared = entry(opts, "PREPARED", currentHead || null);
  opts.onJournal?.(prepared);

  // Compare-and-swap: the ref moves only if it still equals the verified base.
  const update = remote
    ? git(opts.candidateRepoDir, [
        ...authArgs(canonicalRepoDir, opts.canonicalToken),
        "push",
        "--quiet",
        `--force-with-lease=${ref}:${currentHead}`,
        canonicalRepoDir,
        `${commit}:${ref}`,
      ])
    : git(canonicalRepoDir, ["update-ref", "-m", `flaregit accept ${candidate.id}`, ref, commit, currentHead], { gitDir: true });
  if (!update.ok) {
    const stale = /stale info|rejected|lock/i.test(update.stderr) || (!remote && git(canonicalRepoDir, ["rev-parse", "--verify", ref], { gitDir: true }).stdout.trim() !== currentHead);
    const aborted = { ...entry(opts, "ABORTED", currentHead || null, `Atomic ref update refused: ${update.stderr.trim()}`, prepared.id) };
    opts.onJournal?.(aborted);
    return { success: false, journalEntry: aborted, error: aborted.error, staleBase: stale };
  }

  const refUpdated = entry(opts, "REF_UPDATED", currentHead || null, undefined, prepared.id);
  opts.onJournal?.(refUpdated);
  const accepted = entry(opts, "ACCEPTED", currentHead || null, undefined, prepared.id);
  opts.onJournal?.(accepted);

  return {
    success: true,
    journalEntry: accepted,
    acceptanceRecord: {
      ...(candidate.acceptedTarget?{acceptedTarget:structuredClone(candidate.acceptedTarget)}:{}),
      commit,
      candidateId: candidate.id,
      acceptedAt: new Date().toISOString(),
      participatingTasks: candidate.participatingTaskIds,
      evidenceId: evidence.id,
      outputDigest: evidence.builtOutputDigest,
    },
  };
}

/**
 * Crash recovery: a journal entry stuck in PREPARED/REF_UPDATED is settled against the real ref.
 */
export function reconcileJournalEntry(head: string, stuck: PublicationJournalEntry, landedInHistory = false): PublicationJournalEntry {
  if (head === stuck.newHead || landedInHistory) return { ...stuck, state: "ACCEPTED", timestamp: new Date().toISOString() };
  return { ...stuck, state: "ABORTED", error: "Recovered: ref was never updated.", timestamp: new Date().toISOString() };
}
