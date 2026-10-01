import { z } from "zod";

export type ContributorType = "human" | "agent";

export interface Contributor {
  id: string;
  name: string;
  type: ContributorType;
  avatarUrl?: string;
}

export type TaskStatus =
  | "working"
  | "checkpointed"
  | "ready"
  | "integrating"
  | "verifying"
  | "accepted"
  | "needs_decision"
  | "blocked"
  | "cancelled";

export interface RequirementAssertion {
  id: string;
  description: string;
  input?: Record<string, unknown>;
  expectedOutput?: unknown;
}

export interface Requirement {
  id: string;
  title: string;
  description: string;
  version: number;
  status: "approved" | "superseded" | "rejected";
  assertions: RequirementAssertion[];
  originTaskId: string;
  approvedAt: string;
}

export interface Checkpoint {
  id: string;
  commitHash: string;
  author: string;
  message: string;
  timestamp: string;
  isReadyForIntegration: boolean;
  filesChanged: string[];
}

export interface TaskWorkspace {
  repoName: string;
  remote: string;
  token?: string;
  branch: string;
  localPath?: string;
}

export interface Task {
  id: string;
  goal: string;
  contributor: Contributor;
  baseCommit: string;
  allowedScope: string[];
  status: TaskStatus;
  requirements: Requirement[];
  workspace: TaskWorkspace;
  checkpoints: Checkpoint[];
  currentCommit: string;
  activeCandidateId?: string;
  createdAt: string;
  updatedAt: string;
}

export type CompositionMethod = "clean_git_merge" | "repaired_merge" | "rebase_linear";

export interface RepairAttempt {
  round: number;
  prompt: string;
  patch: string;
  affectedContracts: string[];
  diagnosticError: string;
  durationMs: number;
  timestamp: string;
}

export interface CandidateGeneration {
  id: string;
  attemptNumber: number;
  participatingTaskIds: string[];
  participatingCommits: Record<string, string>; // taskId -> commitHash
  expectedAcceptedBase: string;
  frozenPolicyVersion: number;
  frozenRequirements: Requirement[];
  compositionMethod?: CompositionMethod;
  candidateCommit?: string;
  repairAttempts: RepairAttempt[];
  status:
    | "composing"
    | "repairing"
    | "verifying"
    | "verified"
    | "failed"
    | "stale"
    | "accepted";
  failureBlocker?: string;
  evidenceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestResultItem {
  testId: string;
  description: string;
  passed: boolean;
  message?: string;
  durationMs: number;
}

export interface VerificationEvidence {
  id: string;
  candidateCommit: string;
  expectedAcceptedBase: string;
  requirementsVersion: number;
  testBundleDigest: string;
  toolchainDigest: string;
  builtOutputDigest: string;
  verifierIdentity: string;
  testResults: {
    suite: string;
    passed: boolean;
    passedCount: number;
    failedCount: number;
    items: TestResultItem[];
  }[];
  timestamp: string;
  status: "passed" | "failed";
}

export type JournalState = "PREPARED" | "REF_UPDATED" | "ACCEPTED" | "ABORTED";

export interface PublicationJournalEntry {
  id: string;
  candidateId: string;
  candidateCommit: string;
  expectedHead: string;
  newHead: string;
  outputDigest: string;
  state: JournalState;
  timestamp: string;
  error?: string;
}

export interface DecisionOption {
  id: string;
  label: string;
  description: string;
  concreteExample: string;
}

export interface ProductDecision {
  id: string;
  question: string;
  explanation: string;
  conflictingRequirementIds: [string, string];
  options: [DecisionOption, DecisionOption, ...DecisionOption[]];
  selectedOptionId?: string;
  status: "pending" | "resolved" | "dismissed";
  createdAt: string;
  resolvedAt?: string;
}

export interface AcceptanceRecord {
  commit: string;
  candidateId: string;
  acceptedAt: string;
  participatingTasks: string[];
  evidenceId: string;
  outputDigest: string;
}

export interface AcceptedState {
  currentCommit: string;
  acceptedAt: string;
  buildDigest: string;
  activeRequirements: Requirement[];
  history: AcceptanceRecord[];
}

export interface FlareGitProjectState {
  projectId: string;
  projectName: string;
  canonicalRepoName: string;
  acceptedState: AcceptedState;
  tasks: Record<string, Task>;
  candidates: Record<string, CandidateGeneration>;
  evidence: Record<string, VerificationEvidence>;
  decisions: Record<string, ProductDecision>;
  journal: PublicationJournalEntry[];
  policyVersion: number;
}

