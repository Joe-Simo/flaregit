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
  /** Concise product question to ask if this requirement contradicts another. */
  clarifyingQuestion?: string;
  /** Verification-policy changes that take effect if this requirement is chosen in a decision. */
  policyPatch?: Record<string, unknown>;
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
  /** Stacked change: id of the change this one builds on. It cannot be marked ready until that change is accepted. */
  dependsOn?: string;
  allowedScope: string[];
  status: TaskStatus;
  requirements: Requirement[];
  workspace: TaskWorkspace;
  checkpoints: Checkpoint[];
  currentCommit: string;
  activeCandidateId?: string;
  /** Human-readable reason when status is "blocked". */
  blockedReason?: string;
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
  frozenVerificationPolicy: Record<string, unknown>;
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
  /** Git tree hash of the verified commit; publication must find this exact tree. */
  candidateTree: string;
  expectedAcceptedBase: string;
  requirementsVersion: number;
  policy: Record<string, unknown>;
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
  candidateTree?: string;
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
  /** Parameters of the protected verifier; changed only by an explicit product decision. */
  verificationPolicy: Record<string, unknown>;
  /** How the repository was created, and who owns it (set by the platform, not by contributors). */
  kind?: "demo" | "import" | "empty";
  /** The canonical branch that accepted work lands on ("main" for new repos, whatever was imported otherwise). */
  defaultBranch?: string;
  ownerId?: string;
  source?: string;
}

