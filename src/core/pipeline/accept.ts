import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import type {
  AcceptanceRecord,
  CandidateGeneration,
  PublicationJournalEntry,
  Task,
  VerificationEvidence,
} from "../types.js";

export interface PublishOptions {
  canonicalRepoDir: string;
  candidate: CandidateGeneration;
  evidence: VerificationEvidence;
  currentCanonicalHead: string;
  tasks: Task[];
  candidateRepoDir?: string;
}

export interface PublishResult {
  success: boolean;
  journalEntry: PublicationJournalEntry;
  acceptanceRecord?: AcceptanceRecord;
  error?: string;
  staleBase?: boolean;
}

export function publishAcceptedCandidate(opts: PublishOptions): PublishResult {
  const { canonicalRepoDir, candidate, evidence, currentCanonicalHead, candidateRepoDir } = opts;
  const candidateCommit = candidate.candidateCommit;

  if (!candidateCommit) {
    throw new Error(`Candidate ${candidate.id} has no candidate commit`);
  }

  // Ensure canonical repo has candidate commit objects
  if (candidateRepoDir) {
    spawnSync("git", [
      "--git-dir",
      canonicalRepoDir,
      "fetch",
      candidateRepoDir,
      candidateCommit,
    ]);
  }

  // Check 1: Invariant - candidate commit must match verified evidence commit
  if (evidence.candidateCommit !== candidateCommit) {
    return {
      success: false,
      journalEntry: {
        id: `jrnl_${crypto.randomUUID().slice(0, 8)}`,
        candidateId: candidate.id,
        candidateCommit,
        expectedHead: currentCanonicalHead,
        newHead: candidateCommit,
        outputDigest: evidence.builtOutputDigest,
        state: "ABORTED",
        timestamp: new Date().toISOString(),
        error: "Invariant violation: candidate commit does not match verification evidence commit.",
      },
      error: "Invariant violation: candidate commit does not match verification evidence.",
    };
  }

  // Check 2: Verification evidence must be passed
  if (evidence.status !== "passed") {
    return {
      success: false,
      journalEntry: {
        id: `jrnl_${crypto.randomUUID().slice(0, 8)}`,
        candidateId: candidate.id,
        candidateCommit,
        expectedHead: currentCanonicalHead,
        newHead: candidateCommit,
        outputDigest: evidence.builtOutputDigest,
        state: "ABORTED",
        timestamp: new Date().toISOString(),
        error: "Verification evidence has not passed.",
      },
      error: "Candidate has not passed protected verification.",
    };
  }

  // Check 3: Stale base check (CAS)
  // Verify that the actual canonical HEAD matches expectedAcceptedBase
  const actualHeadRes = spawnSync("git", [
    "--git-dir",
    canonicalRepoDir,
    "rev-parse",
    "HEAD",
  ]);
  const actualCanonicalHead = actualHeadRes.stdout.toString().trim();

  if (actualCanonicalHead !== candidate.expectedAcceptedBase) {
    return {
      success: false,
      staleBase: true,
      journalEntry: {
        id: `jrnl_${crypto.randomUUID().slice(0, 8)}`,
        candidateId: candidate.id,
        candidateCommit,
        expectedHead: candidate.expectedAcceptedBase,
        newHead: candidateCommit,
        outputDigest: evidence.builtOutputDigest,
        state: "ABORTED",
        timestamp: new Date().toISOString(),
        error: `Stale base detected: expected ${candidate.expectedAcceptedBase.slice(0, 7)}, canonical is now ${actualCanonicalHead.slice(0, 7)}`,
      },
      error: `Canonical base has moved. Candidate must be recomposed against ${actualCanonicalHead.slice(0, 7)}.`,
    };
  }

  // Check 4: Ancestry check (prohibits history rewriting)
  // Verify that current canonical head is an ancestor of the candidate commit
  const mergeBaseRes = spawnSync("git", [
    "--git-dir",
    canonicalRepoDir,
    "merge-base",
    actualCanonicalHead,
    candidateCommit,
  ]);
  const mergeBase = mergeBaseRes.stdout.toString().trim();
  if (mergeBase !== actualCanonicalHead) {
    return {
      success: false,
      journalEntry: {
        id: `jrnl_${crypto.randomUUID().slice(0, 8)}`,
        candidateId: candidate.id,
        candidateCommit,
        expectedHead: actualCanonicalHead,
        newHead: candidateCommit,
        outputDigest: evidence.builtOutputDigest,
        state: "ABORTED",
        timestamp: new Date().toISOString(),
        error: "Ancestry check failed: candidate commit is not a direct descendant of canonical HEAD.",
      },
      error: "Ancestry check failed: history rewriting prohibited.",
    };
  }

  // Journal Stage 1: PREPARED
  const journalId = `jrnl_${crypto.randomUUID().slice(0, 8)}`;
  let journalEntry: PublicationJournalEntry = {
    id: journalId,
    candidateId: candidate.id,
    candidateCommit,
    expectedHead: actualCanonicalHead,
    newHead: candidateCommit,
    outputDigest: evidence.builtOutputDigest,
    state: "PREPARED",
    timestamp: new Date().toISOString(),
  };

  // Journal Stage 2: REF_UPDATED
  // Perform atomic CAS ref update on canonical repository: update-ref refs/heads/main <new> <old>
  const updateRefRes = spawnSync("git", [
    "--git-dir",
    canonicalRepoDir,
    "update-ref",
    "refs/heads/main",
    candidateCommit,
    actualCanonicalHead,
  ]);

  if (updateRefRes.status !== 0) {
    journalEntry = {
      ...journalEntry,
      state: "ABORTED",
      error: `Git update-ref failed: ${updateRefRes.stderr.toString()}`,
      timestamp: new Date().toISOString(),
    };
    return {
      success: false,
      journalEntry,
      error: `Atomic ref update failed: ${updateRefRes.stderr.toString()}`,
    };
  }

  journalEntry = {
    ...journalEntry,
    state: "REF_UPDATED",
    timestamp: new Date().toISOString(),
  };

  // Journal Stage 3: ACCEPTED
  journalEntry = {
    ...journalEntry,
    state: "ACCEPTED",
    timestamp: new Date().toISOString(),
  };

  const acceptanceRecord: AcceptanceRecord = {
    commit: candidateCommit,
    candidateId: candidate.id,
    acceptedAt: new Date().toISOString(),
    participatingTasks: candidate.participatingTaskIds,
    evidenceId: evidence.id,
    outputDigest: evidence.builtOutputDigest,
  };

  return {
    success: true,
    journalEntry,
    acceptanceRecord,
  };
}
