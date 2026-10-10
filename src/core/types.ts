import type {FrozenAcceptedTarget,TaskTargetGeneration} from "./accepted-target.js";
import type { ExternalCheckPolicy } from "./external-checks.js";
import type { FrozenContributorProof } from "./verification/integrity.js";
import type {AcceptancePolicy,AutoAcceptanceAuthority} from "../server/acceptance-policy";
export type ContributorType = "human" | "agent";

export interface Contributor {
  id: string;
  name: string;
  type: ContributorType;
  avatarUrl?: string;
}

export type FrozenContributionAttribution={taskId:string;commit:string;goal:string;issue?:number;dependsOn?:string}&(
 {status:"recorded";contributor:Contributor;initiatedBy:Contributor;externalTool?:{execution:"external";tool:string;sessionId:string;attestedBy:string}}|
 {status:"unavailable";reason:"legacy_origin_unavailable"}
);

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
  /** Exported function that computes this assertion's output; lets the platform prove a contradiction by running code. */
  probe?: { module: string; export: string };
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

/** One runnable requirement example (probe on an input) executed against a candidate commit. */
export interface RequirementCheck {
  requirementId: string;
  requirementTitle: string;
  assertionId: string;
  /** Chosen in a product decision, so it holds for the whole repository. */
  decided: boolean;
  input: Record<string, unknown>;
  expected: unknown;
  actual?: unknown;
  error?: string;
  passed: boolean;
  /** Plain explanation shown to reviewers; set when the check failed. */
  reason?: string;
}
export interface RequirementCheckRun {
  commit: string;
  checkedAt: string;
  checks: RequirementCheck[];
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
  /** Server-computed validated active generation; original creation binding remains immutable. */
  readonly targetGeneration?: TaskTargetGeneration;
  /** Explicit immutable repository-ledger target; absent on primary compatibility records. */
  readonly acceptedTarget?: FrozenAcceptedTarget;
  id: string;
  goal: string;
  contributor: Contributor;
  /** Person who asked an agent to contribute; preserved separately from the agent's authorship. */
  initiatedBy?: Contributor;
  /** Immutable creator-attested origin; never evidence of a managed runtime. */
  externalTool?:{execution:"external";tool:string;sessionId:string;attestedBy:string};
  /** Latest real coding-agent Workflow; its durable state can be inspected and paused/resumed. */
  agentWorkflowInstanceId?: string;
  /** Durable execution record, including scenario-owned agent runs. */
  agentRunId?: string;
  baseCommit: string | null;
  /** Stacked change: id of the change this one builds on. It cannot be marked ready until that change is accepted. */
  dependsOn?: string;
  /** Issue this change resolves; it closes automatically when the change is accepted. */
  issue?: number;
  allowedScope: string[];
  status: TaskStatus;
  requirements: Requirement[];
  workspace: TaskWorkspace;
  checkpoints: Checkpoint[];
  currentCommit: string | null;
  activeCandidateId?: string;
  /** Human-readable reason when status is "blocked". */
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type CompositionMethod = "clean_git_merge" | "repaired_merge" | "rebase_linear";

export interface RepairAttempt {
  protectedRepair?: { kind?: 'browser' | 'text'; text?: {nativeRunId:string;commandId:string;attemptId:string}; sourceCommit: string; sourceDigest: string; planDigest: string; modelAttemptId?: string; resultCommit?: string; status: 'requested' | 'patch_ready' | 'applied' | 'unknown' };
  round: number;
  prompt: string;
  patch: string;
  affectedContracts: string[];
  diagnosticError: string;
  durationMs: number;
  timestamp: string;
}

export interface CandidateGeneration {
  /** Explicit immutable repository-ledger target; absent on primary compatibility records. */
  readonly acceptedTarget?: FrozenAcceptedTarget;
  /** Explicit fresh-review successor of a preserved legacy candidate. */
  predecessorCandidateId?: string;
  legacyRerunId?: string;
  /** New orchestration preserves original Git inputs before publication. Absent on legacy runs. */
  preservationProtocolVersion?: 1;
  id: string;
  attemptNumber: number;
  participatingTaskIds: string[];
  readonly participatingTargetGenerations?: Record<string, TaskTargetGeneration>;
  participatingCommits: Record<string, string>; // taskId -> commitHash
  expectedAcceptedBase: string | null;
  frozenPolicyVersion: number;
  frozenVerificationPolicy: Record<string, unknown>;
  /** Owner policy and contributor inputs captured before composition; absent on legacy candidates. */
  frozenExternalChecksPolicy?: ExternalCheckPolicy;
  frozenContributorProofs?: FrozenContributorProof[];
  frozenAttribution?:FrozenContributionAttribution[];
  frozenRequirements: Requirement[];
  compositionMethod?: CompositionMethod;
  candidateCommit?: string;
  repairAttempts: RepairAttempt[];
  status:
    | "composing"
    | "repairing"
    | "verifying"
    | "verified"
    | "awaiting_review"
    | "failed"
    | "stale"
    | "accepted";
  failureBlocker?: string;
  evidenceId?: string;
  /** The integration run waiting for a human decision on this exact candidate commit. */
  workflowInstanceId?: string;
  /** A human's decision. It is bound to the commit they saw; any other commit needs a new review. */
  frozenReviewPolicy?: {version:number;policy:{requiredApprovals:number;allowAuthorApproval:boolean};authorIds:string[]};
  frozenAcceptancePolicy?: AcceptancePolicy;
  policyAuthorization?: AutoAcceptanceAuthority;
  review?: { approved: boolean; by: string; note?: string; at: string; commit: string; actor?: HumanDecisionActor;acceptancePolicyVersion?:number };
  /** Runnable requirement examples executed against the exact candidate commit; any failure blocks acceptance. */
  requirementChecks?: RequirementCheckRun;
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
  /** Explicit immutable repository-ledger target; absent on primary compatibility records. */
  readonly acceptedTarget?: FrozenAcceptedTarget;
  id: string;
  candidateCommit: string;
  /** Git tree hash of the verified commit; publication must find this exact tree. */
  candidateTree: string;
  expectedAcceptedBase: string | null;
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
  readonly contributionAttribution?:FrozenContributionAttribution[];
  /** Explicit immutable repository-ledger target; absent on primary compatibility records. */
  readonly acceptedTarget?: FrozenAcceptedTarget;
  id: string;
  candidateId: string;
  candidateCommit: string;
  candidateTree?: string;
  expectedHead: string | null;
  newHead: string;
  outputDigest: string;
  state: JournalState;
  timestamp: string;
  error?: string;
  publicationAuthority?: { readonly acceptedTarget?: FrozenAcceptedTarget;actor:HumanDecisionActor;commit:string;tree:string;policyVersion:number;authorizedAt:string;acceptancePolicyVersion?:number } & (
    {kind?:"human-review";reviewedAt:string} | {kind:"maintainer-policy";policyAuthority:AutoAcceptanceAuthority}
  );
}

export interface DecisionOption {
  id: string;
  label: string;
  description: string;
  concreteExample: string;
}

/** Server-derived identity for consequential human choices. Missing on legacy records. */
export interface HumanDecisionActor { userId: string; displayName: string; viaToken: boolean }

export interface ProductDecisionParticipant {
  targetGeneration?: {eventId:string;generation:number};
  taskId: string;
  currentCommit: string | null;
  baseCommit: string | null;
  workspaceRepoName: string;
  workspaceBranch: string;
  dependsOn?: string;
  activeCandidateId?: string;
  agentRunId?: string;
  agentWorkflowInstanceId?: string;
  contributorId: string;
  contributorType: ContributorType;
  initiatedById?: string;
  writerId?: string | null;
  conflictingRequirements: Requirement[];
}
export interface ProductDecisionScope {
  projectId: string;
  incarnation: string;
  participants: ProductDecisionParticipant[];
  conflictingRequirements: [Requirement, Requirement];
  acceptedTarget?: FrozenAcceptedTarget;
}
export interface ProductDecision {
  /** Immutable participants and original inputs for this consequential choice. */
  readonly scope?: ProductDecisionScope;
  /** Durable legacy rerun lineage; resolution always creates a fresh candidate. */
  legacyRerunId?: string;
  id: string;
  question: string;
  explanation: string;
  conflictingRequirementIds: [string, string];
  options: [DecisionOption, DecisionOption, ...DecisionOption[]];
  selectedOptionId?: string;
  status: "pending" | "resolved" | "dismissed";
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: HumanDecisionActor;
  resolvedTaskIds?: string[];
}

export interface AcceptanceRecord {
  readonly contributionAttribution?:FrozenContributionAttribution[];
  /** Explicit immutable repository-ledger target; absent on primary compatibility records. */
  readonly acceptedTarget?: FrozenAcceptedTarget;
  commit: string;
  candidateId: string;
  acceptedAt: string;
  participatingTasks: string[];
  evidenceId: string;
  outputDigest: string;
}

export interface CommittedAcceptedState {
  /** Legacy committed snapshots omitted this discriminator. */
  kind?: "committed";
  currentCommit: string;
  acceptedAt: string;
  buildDigest: string;
  activeRequirements: Requirement[];
  history: AcceptanceRecord[];
}
export interface UnbornAcceptedState {
  kind: "unborn";
  currentCommit: null;
  acceptedAt: null;
  buildDigest: null;
  activeRequirements: [];
  history: [];
}
export type AcceptedState = CommittedAcceptedState | UnbornAcceptedState;

export interface FlareGitProjectState {
  projectId: string;
  projectName: string;
  canonicalRepoName: string;
  acceptedState: AcceptedState;
  /** Immutable initial accepted snapshot; never inferred from a candidate or a later head. */
  acceptedBaseline?: { commit: string; tree?: string; acceptedAt: string };
  /** Archive state (F01). Absent on older documents, which means active. */
  lifecycle?: import("./repository-lifecycle").RepositoryLifecycle;
  /** Repository topics (F01). Absent on older documents, which means none. */
  topics?: string[];
  tasks: Record<string, Task>;
  candidates: Record<string, CandidateGeneration>;
  evidence: Record<string, VerificationEvidence>;
  decisions: Record<string, ProductDecision>;
  journal: PublicationJournalEntry[];
  policyVersion: number;
  /** Parameters of the protected verifier; changed only by an explicit product decision. */
  verificationPolicy: Record<string, unknown>;
  /** How the repository was created, and who owns it (set by the platform, not by contributors). */
  kind?: "demo" | "import" | "empty" | "repository";
  /** The canonical branch that accepted work lands on ("main" for new repos, whatever was imported otherwise). */
  defaultBranch?: string;
  ownerId?: string;
  source?: string;
}
