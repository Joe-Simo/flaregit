import type {OwnedWorkflow} from "./workflow-control.js";
import {IntegrationNativeRuntimeLedger,type IntegrationNativeRuntimeScope} from "./integration-native-runtime.js";
import { LegacyCandidateReruns, LegacyRerunError, assertLegacyRerunEligible, type LegacyCandidateRerun, type LegacyRerunSnapshot } from "./legacy-candidate-rerun.js";
import {PublicationReadbacks,inspectPublicationReadback,type PublicationReadbackReport,type PublicationReadbackResult} from "./publication-readback.js";
import {openRepositoryRead,RepositoryReadError} from "./repository-read-budget.js";
import {SavedRebaseResumeCredentials,type SavedRebaseResumeCredentialPurpose} from "./saved-rebase-resume-credentials.js";
import {RebaseResumeAttempts,assertRebaseResumeSessionDelegation,type RebaseResumeAttempt} from "./rebase-resume-attempts.js";
import {RebaseRecoveryLedger,RebaseRecoveryError,verifyRebaseRecovery,type RebaseRecoverySnapshot,type RebaseRecoveryReport,type RebaseRecoveryReceipt,type RebaseRecoveryProof} from "./rebase-recovery.js";
import {RetainedCredentialIncidents} from "./retained-credential-incidents.js";
import {RetainedInputs,retainedInputSchema,type RetainedInput,type RetainedInputReceipt,type RebaseApplication} from "./retained-inputs.js";
import {ImportHistoryInspection,type HistorySide,type HistoryInspectionActor,type HistoryChunk,type HistoryInspectionSnapshot,type HistoryInspectionBatch} from "./import-history-inspection.js";
import {ImportHistoryAttempts,type ImportHistoryAttempt} from "./import-history-attempts.js";
import {taskCreationPayload,type TaskCreationInput} from "./task-creation.js";
import {ownerStorageContext,copyReportPage,privateRecoveryReportPage,type OwnerStorageContext,type CopyReportPage} from "./storage-reconciliation-ledger.js";
import {PreviewCredentialIncidents,type PreviewCredentialIncidentStatus} from "./preview-credential-incidents.js";
import {RepositoryPreviewGenerations,type PreviewGenerationRecord} from "./preview-generations.js";
import {EVIDENCE_COPY_ID} from "./evidence-copy-id.js";
import { EvidenceStorageLedger } from "./evidence-storage.js";
import {PreviewStorageWriters,type PreviewCopyPlan} from "./preview-storage-writers.js";
import { PreviewStorageAdmissionError, type PreviewStorageAdmission } from "./preview-storage.js";
import { PreviewStorageLedger, previewStorageBudget, previewManifestPrefix } from "./preview-storage.js";
import { validatePreviewStorageManifest, createPreviewStorageManifest, type PreviewStorageIdentity, type PreviewStorageManifest } from "./preview-storage-upload.js";
import { HealthProbeBudget, type HealthProbeAdmission } from "./health-probe-budget.js";
import { z } from "zod";
import { PublicGitPublicationLedger, type PublicGitPublication } from "./public-git-publication.js";
import type { PublicGitConsentScope } from "./public-git-consent.js";
import { PublicationModeration, type PublicationModerationState, type PublicationModerationDecision, type PublicationModerationKind } from "./publication-moderation.js";
import { isSafeSha } from "../core/sanitize.js";
import {PrivateRecoveryOperations,PrivateRecoveryStorage,type PrivateRecoveryOperation,type PrivateRecoveryReceipt,type PrivateRecoveryTarget,recoveryScopeId} from "./private-recovery.js";
import { previewOrigins, validPreviewRegistration } from "./preview-access.js";
import { PublicDirectory, type DirectoryState, type DirectoryRegistration } from "./public-directory.js";
import { RepositoryDiscussions, type DiscussionTopic } from "./repository-discussions.js";
import { ArtifactAllocationFence, type PendingArtifactAllocation } from "./allocation-fence.js";
import { ArtifactStorageAdmission, type ArtifactKind, type StorageAdmissionPolicy, type StorageReservation } from "./storage-admission.js";
import { CoreGitOperationLedger, configuredGitCap, type CoreGitBudget, type CoreGitAdmission } from "./core-git-budget.js";
import { ManagedSpendLedger, type ManagedEnvelope, type ManagedBudget, type ManagedAdmission, type ManagedReservation } from "./managed-spend-ledger.js";
import { PlatformCommunity } from "./platform-community.js";
import { safeContent } from "./public-community.js";
import { DurableObject } from "cloudflare:workers";
import { freezeCandidateGeneration } from "../core/pipeline/freeze.js";
import { createProductDecision, detectContradiction } from "../core/decision/contradiction.js";
import type { Env } from "./env.js";
import { accountKeyFor, accountOf, projectOf, globalOf } from "./projects.js";
import { isCommandPolicy, settingsFor } from "../core/command-policy.js";
import { VERIFIER_IDENTITIES } from "../core/verification-identities.js";
import { RepositoryDeployments,type AcceptedDeploymentTarget,type DeploymentRecord } from "./deployments.js";
import { RepositoryConnections, type ConnectionMetadata, type CallbackReceipt } from "./connections.js";
import type { IntegrationCallback, IntegrationCapability } from "./integration-auth.js";
import { externalCheckGate, type ExternalCheckPolicy, type ExternalCheckState } from "../core/external-checks.js";
import { CommunityPeople, type PeopleSnapshot, type PeopleRegistration, type FollowingRecord } from "./community-people.js";
import type { PublicProfileState } from "./public-profile.js";
import type { ImportJob } from "./import-job.js";
import type { PublicRepositoryGrant } from "./public-repositories.js";
import { AgentRunLedger, type AgentRunInput, type AgentRunRecord, type AgentRunClaim } from "./agent-run-ledger.js";
import { actorName, RepositoryPublicCommunity, type PublicCommunityActor, type PublicCommunityPolicy, type PublicPost, type ContributionRequest } from "./public-community.js";
export interface RepositoryReadContext { projectId:string; incarnation:string|null; canonicalRepoName:string; repoName:string; ownerId:string; accountKey:string; publicationVersion?:number; acceptedCommit?:string; taskBase?:string; taskCommit?:string; taskBranch?:string; candidateId?:string; candidateCommit?:string; candidateBase?:string; candidateInputCommit?:string; candidateInputBase?:string;retainedInputReceiptId?:string }
export type OwnerRebaseRecoveryResult={ok:true;receipt:RebaseRecoveryReceipt}|{ok:false;status:409|503|429;error:string;report?:RebaseRecoveryReport};
export type OwnerRebaseResumeResult={ok:true;attempt:RebaseResumeAttempt}|{ok:false;status:409|503|429;error:string;report?:RebaseRecoveryReport};
export type OwnerRebaseApplication=RebaseRecoveryReport & {resumeAvailable:boolean;resume?:{id:string;generation:number;dispatch:RebaseResumeAttempt["dispatch"];nativeState:RebaseResumeAttempt["nativeState"];terminal?:RebaseResumeAttempt["terminal"];pauseReason?:string}};
export type PublicGrantMetadata = PublicRepositoryGrant & { name: string; version: number; canonicalRepoName: string };
import type {
  CandidateGeneration,
  HumanDecisionActor,
  FlareGitProjectState,
  ProductDecision,
  PublicationJournalEntry,
  Requirement,
  RepairAttempt,
  Task,
  VerificationEvidence,
} from "../core/types.js";

export interface ClaimResult { candidate?: CandidateGeneration; decision?: ProductDecision; reason?: string }
export interface PrepareResult { ok: boolean; journal?: PublicationJournalEntry; error?: string; stale?: boolean; recoveryRequired?: boolean }

/** Plain-typed view of the ledger RPC surface used by Workflows and Queues. */
export interface ProjectRow {
  id: string;
  name: string;
  role: "owner" | "member";
  kind: string;
  created_at: string;
}
export interface WebhookRow {
  id: string;
  url: string;
  events: string;
  active: number;
  created_at: string;
}
export interface DeliveryRow {
  id: string;
  /** Per-webhook sequence number; deliveries are sent strictly in this order. */
  seq: number;
  /** Milliseconds from enqueue to the first attempt. */
  queue_ms: number | null;
  webhook_id: string;
  event: string;
  status: "pending" | "success" | "failed";
  attempts: number;
  last_status: number | null;
  last_error: string | null;
  latency_ms: number | null;
  created_at: string;
  updated_at: string;
}

export interface ComponentStatus {
  component: string;
  degradedNow: boolean;
  lastCheckAt: number | null;
  checks24h: number;
  failed24h: number;
  lastFailureAt: number | null;
  lastFailureDetail: string | null;
  degradedMinutes24h: number;
}
export type WorkflowKind = "agent" | "integration";
export type WorkflowOutcome = "started" | "awaiting_review" | "completed" | "skipped" | "accepted" | "needs_decision" | "not_started" | "blocked" | "stale" | "rejected" | "failed";
export interface WorkflowCount { kind: WorkflowKind; status: WorkflowOutcome; count: number }

export const WEBHOOK_EVENTS = ["change.ready", "change.accepted", "change.blocked", "decision.needed", "deployment.requested"] as const;

/** Limits on a token: `full` acts as the user; `read`/`write` are narrower; `repo` pins it to one repository; `expiresAt` (ms) makes it short-lived. */
export interface TokenScope {
  scope: "full" | "read" | "write";
  repo?: string;
  expiresAt?: number;
}

export interface IssueRow {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  author: string;
  created_at: string;
  updated_at: string;
  closed_by: string | null;
  comments: number;
}

/** One conversation model for issues, changes and candidates: subject is "issue:<n>", "change:<id>" or "candidate:<id>". */
export interface CommentRow {
  id: number;
  subject: string;
  author: string;
  body: string;
  path: string | null;
  line: number | null;
  commit: string | null;
  created_at: string;
}

export interface CommentPage { comments: CommentRow[]; nextCursor: string | null; hasMore: boolean }
export interface MemberIssueInput {title:string;body:string;author:string;idempotencyKey:string}
export interface MemberCommentInput { subject: string; author: string; body: string; path?: string; line?: number; commit?: string; idempotencyKey?: string }

export interface Profile {
  handle: string;
  displayName: string;
  bio: string;
  joinedAt: string;
}

export interface DomainRow {
  domain: string;
  project_id: string;
  token: string;
  verified_at: string | null;
}

export type ReportPublicationTarget = { kind: "profile"; targetId: string; accountKey: string } | { kind: "repository"; targetId: string };
export interface ReportRow {
  publication_target?: string | null;
  id: string;
  at: string;
  reporter: string;
  kind: string;
  target: string;
  details: string;
  status: "open" | "resolved";
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

export interface InboxRow {
  id: number;
  project_id: string;
  project_name: string;
  kind: "direct" | "activity";
  type: string;
  title: string;
  created_at: string;
  state: "unread" | "archived" | "snoozed";
}

export interface ApiTokenRow {
  scope: string;
  repo: string | null;
  expires_at: number | null;
  id: string;
  label: string;
  created_at: string;
  last_used: string | null;
}

export interface ActivityRow {
  id: number;
  at: string;
  actor: string;
  type: string;
  summary: string;
}

export interface ImportHistoryOperation { protocolVersion?:2; projectId: string; head: string; canonicalRepoName: string; ownerId: string; instanceId: string; createdAt: string }

export interface Ledger {
  assertHistoryInspectionAttempt(operationId:string,generation:number,workflowId:string):Promise<void>;
  beginHistoryInspection(operationId:string,accountKey:string,expectedHead:string):Promise<HistoryInspectionSnapshot>;
  getHistoryInspection(operationId:string):Promise<HistoryInspectionSnapshot|null>;
  importHistoryBatch(operationId:string,side:HistorySide,limit?:number):Promise<HistoryInspectionBatch>;
  commitHistoryChunk(operationId:string,side:HistorySide,chunk:HistoryChunk,actor?:HistoryInspectionActor):Promise<{kind:"applied"|"duplicate"|"paused";snapshot:HistoryInspectionSnapshot}>;
  pauseHistoryInspection(operationId:string,reason:string,actor?:HistoryInspectionActor):Promise<HistoryInspectionSnapshot>;
  resumeHistoryInspection(operationId:string,actor?:HistoryInspectionActor):Promise<HistoryInspectionSnapshot>;
  finishHistoryInspection(operationId:string,actor?:HistoryInspectionActor):Promise<HistoryInspectionSnapshot>;
  historyInspectionAttempt(operationId:string):Promise<ImportHistoryAttempt|null>;
  startHistoryInspectionAttempt(operationId:string,expectedGeneration:number):Promise<ImportHistoryAttempt>;
  markHistoryInspectionDispatch(operationId:string,generation:number):Promise<ImportHistoryAttempt>;
  observeHistoryInspectionAttempt(operationId:string,generation:number,status:string):Promise<ImportHistoryAttempt>;
  historyInspectionNativeIntent(operationId:string,generation:number,workflowId?:string):Promise<ImportHistoryAttempt>;
  historyInspectionNativeStopped(operationId:string,generation:number,nativeRunId:string):Promise<ImportHistoryAttempt>;
  listHistoryInspectionAttemptsForCleanup():Promise<ImportHistoryAttempt[]>;

  previewGenerationCredentialIncident(g:string,repoName:string,token:string,expiresAt:number):Promise<void>;
  previewGenerationCredentialSummary(g:string):Promise<{status:PreviewCredentialIncidentStatus;expiresAt:number}|null>;

  previewGenerationStorageReady(key:string,hash:string):Promise<boolean>;
  previewGenerationBegin(commit:string,canonicalRepo:string,actorId:string,expected:string|null,key:string,sourceKey?:string):Promise<{status:"created"|"duplicate";record:PreviewGenerationRecord}>;
  previewGenerationGet(generation:string):Promise<PreviewGenerationRecord|null>;
  previewGenerationLatest(commit:string):Promise<PreviewGenerationRecord|null>;
  previewGenerationActive(commit:string):Promise<PreviewGenerationRecord|null>;
  previewGenerationScope(generation:string):Promise<PreviewStorageIdentity>;
  previewGenerationClaim(generation:string):Promise<boolean>;
  previewGenerationFail(generation:string,reason:string):Promise<void>;
  previewGenerationPromote(generation:string,manifestHash:string):Promise<void>;
  previewGenerationForRead(commit:string,incarnation:string,generation:string):Promise<boolean>;
  previewLegacyGenerationAllowed(commit:string):Promise<boolean>;
  previewGenerationEstimate(sourceKey:string,identity:PreviewStorageIdentity,generation:string):Promise<PreviewStorageManifest>;
  previewGenerationCapacity(sourceKey:string,identity:PreviewStorageIdentity):Promise<PreviewStorageAdmission>;
  reservePreviewGenerationEstimate(manifest:PreviewStorageManifest):Promise<PreviewStorageAdmission>;
  finalizePreviewGenerationManifest(manifest:PreviewStorageManifest):Promise<PreviewStorageAdmission>;
  quarantinePreviewStorage(key:string,identity:PreviewStorageIdentity):Promise<void>;

  previewStorageWriterState(key:string):Promise<{unfinished:boolean}>;
  previewStorageReadmission(identity:PreviewStorageIdentity):Promise<PreviewStorageAdmission>;
  reserveEvidenceStorage(identity:PreviewStorageIdentity,id:string,size:number,sha256:string):Promise<PreviewStorageAdmission>;
  reserveHealthProbe(): Promise<HealthProbeAdmission>;
  reservePreviewWriter(key:string,writerId:string):Promise<void>;
  beginPreviewPut(key:string,writerId:string,assetPath:string):Promise<void>;
  finishPreviewPut(key:string,writerId:string,assetPath:string):Promise<void>;
  finishPreviewWriter(key:string,writerId:string):Promise<void>;
  registerPreviewEvidenceCopy(identity:PreviewStorageManifest["identity"],id:string,size:number,sha256:string,writerId:string):Promise<string>;
  recordScopedEvidenceCopy(id:string,key:string,incarnation:string):Promise<void>;
  previewCleanupScope():Promise<{projectId:string;incarnation:string;legacyEvidence:boolean;legacyInventory:boolean}>;
  fencePreviewCleanup(projectId:string,incarnation:string):Promise<PreviewCopyPlan[]>;
  previewCopyCleanupReady(key:string):Promise<boolean>;
  finishPreviewCopyCleanup(key:string):Promise<void>;
  ownerStorageContext(ownerId:string):Promise<OwnerStorageContext|null>;
  storageCopyReportPage(projectId:string,incarnation:string,after:number):Promise<CopyReportPage>;
  storagePrivateReportPage(projectId:string,incarnation:string,after:number):Promise<ReturnType<typeof privateRecoveryReportPage>>;
  reservePreviewStorage(manifest:PreviewStorageManifest):Promise<PreviewStorageAdmission>;
  previewStorageScope(commit:string,canonicalRepoName:string):Promise<PreviewStorageManifest["identity"]>;
  reservePrivateRecoveryStorage(id:string,accountKey:string):Promise<void>;
  releasePrivateRecoveryStorage(id: string, accountKey: string): Promise<void>;
  publicGitSharingState(ownerId: string): Promise<{ publication: PublicGitPublication | null; target: PublicGitConsentScope | null }>;
  decidePublicGitSharing(ownerId: string, value: unknown): Promise<PublicGitPublication | null>;
  privateRecoveryCleanupList(): Promise<PrivateRecoveryOperation[]>;
  privateRecoveryBeginDeletion(id: string, ownerId: string): Promise<PrivateRecoveryOperation>;
  privateRecoveryFinishDeletion(id: string): Promise<void>;
  privateRecoveryBeginUpload(id: string, expectedScope: string): Promise<void>;
  privateRecoverySaveUpload(id: string, uploadId: string, expectedScope: string): Promise<void>;
  privateRecoveryCloseUpload(id: string, uploadId: string, expectedScope: string): Promise<void>;
  privateRecoveryMarkDispatch(id: string, dispatchState: "uncertain" | "started", expectedScope: string): Promise<void>;
  privateRecoveryOperation(id:string):Promise<PrivateRecoveryOperation|null>;
  privateRecoveryList():Promise<PrivateRecoveryOperation[]>;
  privateRecoveryPrepare(id:string,commit:string,tree:string|null,ownerId:string,accountKey:string):Promise<PrivateRecoveryOperation>;
  privateRecoveryAuthorize(id:string,ownerId:string):Promise<boolean>;
  privateRecoveryRecordTree(id:string,tree:string,expectedScope:string):Promise<PrivateRecoveryOperation>;
  privateRecoveryReadable(id:string):Promise<boolean>;
  privateRecoveryComplete(id:string,receipt:PrivateRecoveryReceipt):Promise<void>;
  privateRecoveryFail(id:string,message:string,expectedScope:string):Promise<void>;

  previewOrigin(repository: string, appOrigin?: string): Promise<PreviewOriginRegistration | null>;
  activePreviewOrigin(repository: string, appOrigin?: string): Promise<string | null>;
  registerPreviewOrigin(repository: string, origin: string, operator: string, appOrigin: string): Promise<PreviewOriginRegistration>;
  retirePreviewOrigin(repository: string, operator: string, appOrigin: string): Promise<PreviewOriginRegistration | null>;
  nativeComputeFailureReason(key:string):Promise<string|null>;
  setNativeComputeFailureReason(key:string,reason:"storage_capacity"|"storage_unconfigured"|"storage_retired"|"storage_reconciliation"|"build_failed"):Promise<void>;
  nativeComputeFailure(key: string): Promise<boolean>;
  setNativeComputeFailure(key: string, failed: boolean): Promise<void>;
  nativeComputeStatus(key: string): Promise<{ active: boolean; sandboxName: string; token: string; deadline: number } | null>;
  existingDeploymentRequest(target: AcceptedDeploymentTarget, serviceId: string, environment: string, key: string, actorId: string): Promise<DeploymentRecord | null>;
  claimNativeCompute(key: string): Promise<string | null>;
  finishNativeCompute(key: string, token: string): Promise<void>;
  reserveRepositoryReadOperation(operationId:string,accountKey:string):Promise<CoreGitAdmission>;
  repositoryReadContext(userId:string|null,taskId?:string|null,candidateId?:string|null):Promise<RepositoryReadContext>;
  assertRepositoryReadContext(context:RepositoryReadContext,userId:string|null,taskId?:string|null,credentialHash?:string,candidateId?:string|null):Promise<boolean>;
  reserveCoreGitOperation(operationId: string, accountKey: string, budget: CoreGitBudget): Promise<CoreGitAdmission>;
  markManagedDispatchAttempted(runIds: string[], accountKey: string): Promise<void>;
  cancelUnstartedManagedSpend(runIds: string[], accountKey: string): Promise<void>;
  managedSpendReserved(month: string, accountKey?: string): Promise<number>;
  managedReservationAttribution(input: {month:string;cursor?:string}): ReturnType<ManagedSpendLedger["attributionPage"]>;
  reserveManagedSpendBatch(inputs: ManagedEnvelope[], budget: ManagedBudget): Promise<ManagedAdmission[]>;
  reserveManagedSpend(input: ManagedEnvelope, budget: ManagedBudget): Promise<ManagedAdmission>;
  consumeManagedSpend(runId: string, inputBytes: number, outputTokens: number, containerSeconds: number): Promise<ManagedReservation>;

  acceptedDeploymentTarget(journalId:string):Promise<{canonicalRepoName:string;target:AcceptedDeploymentTarget}|null>;
  acceptedDeploymentTargets():Promise<AcceptedDeploymentTarget[]>;
  privateRecoveryTargets():Promise<PrivateRecoveryTarget[]>;
  listDeployments():Promise<DeploymentRecord[]>;
  requestDeployment(target:AcceptedDeploymentTarget,serviceId:string,environment:string,key:string,actorId:string):Promise<{kind:"created"|"duplicate";deployment:DeploymentRecord}>;
  discussionList(publicOnly:boolean,actor?:PublicCommunityActor):Promise<ReturnType<RepositoryDiscussions["list"]>>;
  publicDiscussionActivity(query:string,ids?:string[]):Promise<DiscussionTopic[]>;
  publicDiscussionActivitySnapshot(ids:string[]):Promise<{directory:DirectoryState;grant:PublicGrantMetadata|null;topics:DiscussionTopic[]}>;
  discussionTopic(id:string,publicOnly:boolean,actor?:PublicCommunityActor):Promise<ReturnType<RepositoryDiscussions["topic"]>>;
  discussionSettings(actor:PublicCommunityActor,input?:unknown):Promise<{enabled:boolean}>;
  discussionPermissions(actor:PublicCommunityActor,id:string,publicOnly:boolean,canAdminister?:boolean):Promise<ReturnType<RepositoryDiscussions["permissions"]>>;
  discussionMutate(actor:PublicCommunityActor,operation:"create"|"reply"|"edit"|"remove"|"control",input:unknown,id:string|undefined,publicOnly:boolean,canAdminister?:boolean):Promise<ReturnType<RepositoryDiscussions["create"]>>;
  publicCommunity(publicOnly?: boolean): Promise<{ policy: PublicCommunityPolicy; posts: PublicPost[] }>;
  configurePublicCommunity(policy: PublicCommunityPolicy, confirmed: boolean, actor: PublicCommunityActor): Promise<PublicCommunityPolicy>;
  createPublicPost(actor: PublicCommunityActor, input: Parameters<RepositoryPublicCommunity["createPost"]>[1]): Promise<PublicPost>;
  signedPublicPosts(actor: PublicCommunityActor): Promise<{ posts: Array<PublicPost & { canEdit: boolean; canRemove: boolean }>; authorDisplayName: string }>;
  editPublicPost(actor: PublicCommunityActor, postId: string, input: { title: string; body: string; expectedVersion: number }): Promise<PublicPost>;
  removePublicPost(actor: PublicCommunityActor, postId: string, expectedVersion: number): Promise<void>;
  requestPublicContribution(actor: PublicCommunityActor, input: Parameters<RepositoryPublicCommunity["requestContribution"]>[1]): Promise<ContributionRequest>;
  publicContributionRequests(actor: PublicCommunityActor): Promise<ContributionRequest[]>;
  decidePublicContribution(actor: PublicCommunityActor, requestId: string, decision: "approved" | "rejected", confirmedPrivateAccess: boolean): Promise<ContributionRequest>;
  reconcileContributorRegistrations(): Promise<void>;
  cancelContributorRegistration(userId: string): Promise<void>;
  accountLifecycle(): Promise<"active" | "deleting" | "deleted">;
  previewAvailable(): Promise<boolean>;
  beginAccountDeletion(): Promise<void>;
  finishAccountDeletion(): Promise<void>;
  accountArtifactDeleted(name:string):Promise<boolean>;
  recordAccountArtifactDeleted(name:string):Promise<void>;
  getAgentRun(runId: string): Promise<AgentRunRecord | null>;
  claimAgentRun(input: AgentRunInput): Promise<AgentRunClaim>;
  resumeAgentRun(runId: string, taskId: string, previousRunId: string): Promise<AgentRunClaim>;
  saveAgentProposal(runId: string, taskId: string, files: Record<string, string>): Promise<boolean>;
  markAgentPushed(runId: string, taskId: string, commit: string): Promise<boolean>;
  checkpointAgentRun(runId: string, taskId: string, eventId: string, commit: string): Promise<boolean>;
  failAgentRun(runId: string, taskId: string): Promise<boolean>;
  repositoryModerationState(): Promise<PublicationModerationState>;
  profileModerationState(ownerId: string): Promise<PublicationModerationState>;
  moderateRepository(input: unknown, operatorAccountKey: string): Promise<PublicationModerationDecision>;
  moderateProfile(ownerId: string, input: unknown, operatorAccountKey: string): Promise<PublicationModerationDecision>;
  moderationHistory(kind: PublicationModerationKind, targetId: string): Promise<PublicationModerationDecision[]>;
  publicGrant(): Promise<PublicGrantMetadata | null>;
  publicContributionsFor(userId: string): Promise<{ grant: PublicGrantMetadata; contributions: Array<{ commit: string; acceptedAt: string }> } | null>;
  directoryState(): Promise<DirectoryState>;
  configureDirectory(input: unknown, actor: string): Promise<DirectoryState>;
  registerDirectory(input: DirectoryRegistration): Promise<void>;
  directoryPage(cursor?: string): Promise<{rows:DirectoryRegistration[];nextCursor:string|null}>;
  repositoryVisibility(): Promise<"public" | "private">;
  setRepositoryVisibility(visibility: "public" | "private", confirmed: boolean, by: string): Promise<void>;
  saveImportJob(job: ImportJob): Promise<void>;
  getImportJob(id: string): Promise<ImportJob | null>;
  listImportJobs(): Promise<ImportJob[]>;
  claimImportHistoryOperation(input: { projectId: string; head: string; canonicalRepoName: string; ownerId: string; instanceId: string; protocolVersion?:2 }): Promise<ImportHistoryOperation>;
  getImportHistoryOperation(instanceId: string): Promise<ImportHistoryOperation | null>;
  listImportHistoryOperations(): Promise<ImportHistoryOperation[]>;
  externalCheckReports(candidateId: string): Promise<ReturnType<RepositoryConnections["reports"]>>;
  serviceCandidateSnapshot(serviceId: string, candidateId: string, commit: string, nonce: string): Promise<ReturnType<RepositoryConnections["serviceCandidateSnapshot"]> | null>;
  listConnections(): Promise<{ connections: ConnectionMetadata[]; policy: ExternalCheckPolicy }>;
  createConnection(name: string, capabilities: IntegrationCapability[]): Promise<{ connection: ConnectionMetadata; secret: string }>;
  revokeConnection(id: string): Promise<void>;
  connectionSigningConfig(id: string): Promise<{ secret: string; capabilities: IntegrationCapability[] } | null>;
  setConnectionPolicy(policy: ExternalCheckPolicy): Promise<ExternalCheckPolicy>;
  externalChecks(candidateId: string): Promise<ExternalCheckState | null>;
  registerExternalRun(candidateId: string, checkId: string, runId: string): Promise<ExternalCheckState>;
  acceptIntegrationCallback(callback: IntegrationCallback): Promise<CallbackReceipt>;
  listProjects(): Promise<ProjectRow[]>;
  addProject(p: { id: string; name: string; role: "owner" | "member"; kind: string }): Promise<void>;
  removeProject(id: string): Promise<void>;
  roleOf(userId: string): Promise<"owner" | "member" | null>;
  addMember(userId: string, role: "owner" | "member", label?: string): Promise<void>;
  removeMember(userId: string): Promise<void>;
  listMembers(): Promise<Array<{ user_id: string; role: string; label: string | null; added_at: string }>>;
  createInvite(createdBy: string): Promise<string>;
  acceptInvite(token: string, userId: string, label?: string): Promise<boolean>;
  logActivity(actor: string, type: string, summary: string, opts?: { exceptUser?: string }): Promise<void>;
  addInbox(item: { projectId: string; projectName: string; kind: "direct" | "activity"; type: string; title: string }): Promise<void>;
  listInbox(filter: "direct" | "activity" | "snoozed" | "archived"): Promise<InboxRow[]>;
  setInboxState(id: number, state: "unread" | "archived" | "snoozed"): Promise<void>;
  inboxUnread(): Promise<{ direct: number; activity: number }>;
  domainsFor(projectId: string): Promise<DomainRow[]>;
  getProfile(): Promise<Profile>;
  publicProfileState(): Promise<PublicProfileState>;
  peopleSnapshot():Promise<PeopleSnapshot>;
  configureDiscovery(input:unknown,userId:string):Promise<ReturnType<CommunityPeople["state"]>>;
  registerPerson(value:PeopleRegistration):Promise<void>;
  deliveredDiscovery(version:number):Promise<void>;
  peoplePage(cursor?:string):Promise<ReturnType<CommunityPeople["page"]>>;
  followingForHandle(handle:string):Promise<FollowingRecord|null>;
  replayFollowing(handle:string,input:unknown):Promise<ReturnType<CommunityPeople["replayFollowing"]>>;
  followingRecord(targetAccount:string):Promise<FollowingRecord|null>;
  followingPage(cursor?:string):Promise<ReturnType<CommunityPeople["followingPage"]>>;
  setFollowing(target:{accountKey:string;ownerId:string;handle:string},input:unknown):Promise<ReturnType<CommunityPeople["setFollowing"]>>;
  publicAcceptedActivity(userId:string):Promise<{directory:DirectoryState;grant:PublicGrantMetadata|null;contributions:Array<{commit:string;acceptedAt:string}>}>;
  publicActivityProjects():Promise<Array<{id:string}>>;
  setPublicProfileVisibility(visibility: "public" | "private", confirmed: boolean, ownerId: string, expectedVersion?: number): Promise<void>;
  listIssues(state: "open" | "closed"): Promise<IssueRow[]>;
  getIssue(n: number): Promise<IssueRow | null>;
  createIssue(i: { title: string; body: string; author: string }): Promise<IssueRow>;
  createMemberIssue(userId:string,input:MemberIssueInput):Promise<IssueRow>;
  setIssueState(n: number, state: "open" | "closed", by: string): Promise<IssueRow | null>;
  listComments(subject: string): Promise<CommentRow[]>;
  listMemberCommentsPage(userId: string, subject: string, cursor?: string): Promise<CommentPage>;
  addMemberComment(userId: string, input: MemberCommentInput): Promise<CommentRow>;
  addComment(c: { subject: string; author: string; body: string; path?: string; line?: number; commit?: string }): Promise<CommentRow>;
  setProfile(p: Profile, expectedVersion?: number): Promise<void>;
  claimHandle(handle: string, accountKey: string): Promise<boolean>;
  commitHandle(handle: string, accountKey: string): Promise<void>;
  releaseHandle(handle: string, accountKey: string): Promise<void>;
  accountForHandle(handle: string): Promise<string | null>;
  claimDomain(domain: string, projectId: string): Promise<DomainRow>;
  verifyDomain(domain: string, projectId: string): Promise<{ lostBy: string[] }>;
  releaseDomain(domain: string, projectId: string): Promise<void>;
  createApiToken(userId: string, label: string, secret: string, opts?: TokenScope): Promise<{ id: string }>;
  listApiTokens(): Promise<ApiTokenRow[]>;
  revokeApiToken(id: string): Promise<void>;
  verifyApiToken(secret: string): Promise<{ userId: string; scope: TokenScope["scope"]; repo: string | null } | null>;
  recordProbe(component: string, ok: boolean, latencyMs?: number, detail?: string): Promise<void>;
  statusSummary(): Promise<ComponentStatus[]>;
  recordWorkflowOutcome(kind: WorkflowKind, instanceId: string, status: WorkflowOutcome): Promise<void>;
  workflowCounts(sinceMs: number): Promise<WorkflowCount[]>;
  listRepositoryWorkflows(): Promise<Array<{ instanceId: string; kind: "agent" | "integration" | "scenario" }>>;
  registerWorkflow(instanceId: string, kind: "agent" | "integration" | "scenario", taskId?: string, actorId?: string, nativeRuntimeProtocolVersion?:1): Promise<void>;
  assertWorkflowControlAuthority(context:RepositoryReadContext,userId:string,run:OwnedWorkflow,mutation:boolean,viaToken:boolean,credentialHash?:string,sessionExpiresAt?:number):Promise<boolean>;
  getWorkflowRun(instanceId: string): Promise<{ instanceId: string; kind: "agent" | "integration" | "scenario"; actorId: string | null } | null>;
  admitIntegrationDispatch(eventId: string, taskIds: string[]): Promise<{ terminal: boolean; actorId: string | null }>;
  recordIntegrationDispatchOutcome(eventId: string, status: WorkflowOutcome): Promise<void>;
  ownerPublicationReadbacks(actor:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number):Promise<PublicationReadbackReport[]>;
  checkOwnerPublicationReadback(journalId:string,requestId:string,actor:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number):Promise<PublicationReadbackReport>;
  getMirror(): Promise<{ target: string | null; enabled: boolean; hasToken: boolean; runs: Array<{ id: string; commit: string; status: string; detail: string; at: string }> }>;
  /** Server-side only (workflow and mirror route); never returned to clients. */
  mirrorSecret(): Promise<{ target: string; token: string } | null>;
  setMirror(p: { target?: string; token?: string; enabled?: boolean }): Promise<void>;
  deleteMirror(): Promise<void>;
  recordMirrorRun(commit: string, status: string, detail: string): Promise<void>;
  forumList(input:{category?:string;q?:string;sort?:string}):Promise<ReturnType<PlatformCommunity["list"]>>;
  forumTopic(id:string):Promise<ReturnType<PlatformCommunity["topic"]>>;
  forumCreate(actor:PublicCommunityActor,input:unknown,topicId?:string):Promise<ReturnType<PlatformCommunity["create"]>>;
  forumEdit(actor:PublicCommunityActor,id:string,input:unknown):Promise<ReturnType<PlatformCommunity["edit"]>>;
  forumPermissions(actor:PublicCommunityActor,topicId:string,moderator:boolean):Promise<ReturnType<PlatformCommunity["permissions"]>>;
  forumRemove(actor:PublicCommunityActor,id:string,input:unknown,moderator:boolean):Promise<ReturnType<PlatformCommunity["remove"]>>;
  fileReport(r: { reporter: string; kind: string; target: string; details: string; publicationTarget?: ReportPublicationTarget }): Promise<ReportRow>;
  getReport(id: string): Promise<ReportRow | null>;
  listReportsPage(filter: { status?: "open" | "resolved"; reporter?: string; cursor?: string | null }): Promise<{ reports: ReportRow[]; nextCursor: string | null }>;
  listReports(filter: { status?: "open" | "resolved"; reporter?: string }): Promise<ReportRow[]>;
  resolveReport(id: string, resolution: string, by: string): Promise<ReportRow | null>;
  reportBacklog(): Promise<{ open: number; oldestOpenHours: number | null }>;
  listProbes(sinceMs: number): Promise<Array<{ component: string; at: number; ok: number; latency_ms: number | null; detail: string | null }>>;
  addWebhook(url: string, events: string[]): Promise<{ id: string; secret: string }>;
  listWebhooks(): Promise<WebhookRow[]>;
  removeWebhook(id: string): Promise<void>;
  listDeliveries(limit: number): Promise<DeliveryRow[]>;
  getDelivery(id: string): Promise<{ delivery: DeliveryRow & { payload: string }; webhook: { url: string; secret: string; active: number } } | null>;
  markDelivery(id: string, result: { ok: boolean; status?: number; error?: string; latencyMs?: number; final?: boolean }): Promise<number>;
  redeliver(id: string): Promise<boolean>;
  isBlocked(id: string): Promise<boolean>;
  beginRetainedCredential(input:RetainedInput,purpose:"workspace"|"canonical",expiresAt:number,scope:"read"|"write"):Promise<boolean>;
  recordRetainedCredential(inputId:string,purpose:"workspace"|"canonical",repoName:string,token:string,expiresAt:number):Promise<void>;
  revokeRetainedCredential(inputId:string,purpose:"workspace"|"canonical"):Promise<boolean>;
  markRetainedCredentialRevoked(inputId:string,purpose:"workspace"|"canonical",token:string):Promise<void>;
  retainedCredentialSummary(inputId:string,purpose:"workspace"|"canonical"):Promise<ReturnType<RetainedCredentialIncidents["summary"]>>;
  lookupRetainedInput(taskId:string,candidateId:string,commit:string,base?:string,userId?:string):Promise<RetainedInputReceipt|null>;
  assertRetainedInput(input:RetainedInput):Promise<boolean>;
  beginRebaseResume(id:string,actor:HumanDecisionActor,expectedVersion:number,idempotencyKey:string,credentialHash?:string,sessionExpiresAt?:number):Promise<OwnerRebaseResumeResult>;
  pauseRebaseResume(id:string,generation:number,workflowId:string,reason:string):Promise<void>;
  beginRebaseResumeCredential(id:string,generation:number,purpose:SavedRebaseResumeCredentialPurpose,expiresAt:number,scope:"read"|"write"):Promise<boolean>;
  recordRebaseResumeCredential(id:string,generation:number,purpose:SavedRebaseResumeCredentialPurpose,repoName:string,token:string,expiresAt:number):Promise<void>;
  revokeRebaseResumeCredential(id:string,generation:number,purpose:SavedRebaseResumeCredentialPurpose):Promise<boolean>;
  markRebaseResumeCredentialRevoked(id:string,purpose:SavedRebaseResumeCredentialPurpose,token:string):Promise<void>;
  stopRebaseResumeForDeletion():Promise<boolean>;
  ownerRebaseResumeStatus(applicationId:string,actor:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number):Promise<RebaseResumeAttempt|null>;
  rebaseResumeCurrent(id:string):Promise<RebaseResumeAttempt|null>;
  assertRebaseResume(id:string,generation:number,workflowId:string):Promise<{application:RebaseApplication;snapshot:RebaseRecoverySnapshot;actor:HumanDecisionActor;accountKey:string;nativeRunId:string;workflowId:string;receipt?:RebaseRecoveryReceipt}>;
  markRebaseResumeDispatch(id:string,generation:number,state:RebaseResumeAttempt["dispatch"]):Promise<RebaseResumeAttempt>;
  rebaseResumeNativeIntent(id:string,generation:number,workflowId:string):Promise<RebaseResumeAttempt>;
  rebaseResumeNativeStopped(id:string,generation:number,nativeRunId:string):Promise<RebaseResumeAttempt>;
  observeRebaseResume(id:string,generation:number,actor?:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number):Promise<RebaseResumeAttempt>;
  finishRebaseResume(id:string,generation:number,workflowId:string,proof:RebaseRecoveryProof):Promise<RebaseRecoveryReceipt>;
  reconcileRebaseApplication(id:string,actor:HumanDecisionActor,expectedVersion:number,idempotencyKey:string,credentialHash?:string,sessionExpiresAt?:number):Promise<OwnerRebaseRecoveryResult>;
  admitIntegrationNativeCommand(workflowId:string,candidateId:string,nativeId:string,commandId:string):Promise<IntegrationNativeRuntimeScope>;
  integrationNativeCommandAllowed(scope:IntegrationNativeRuntimeScope,nativeId:string,commandId:string):Promise<boolean>;
  finishIntegrationNativeCommand(scope:IntegrationNativeRuntimeScope,nativeId:string,commandId:string,outcome:"completed"|"refused"):Promise<void>;
  stopIntegrationNativeForDeletion():Promise<boolean>;
  declareIntegrationNativeRuntime(workflowId:string,candidateId:string):Promise<void>;
  reserveIntegrationNativeRuntime(workflowId:string,candidateId:string,nativeId:string,stage:string):Promise<void>;
  confirmIntegrationNativeRuntimeStopped(workflowId:string,candidateId:string,nativeId:string):Promise<void>;
  legacyCandidateRuntimeAvailable(candidateId:string):Promise<boolean>;
  legacyCandidateRerunReport(candidateId:string,actor:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number):Promise<{candidateId:string;expectedCommit:string|null;inputs:Record<string,{commit:string;base:string}>;eligible:boolean;detail:string;operation?:{id:string;phase:LegacyCandidateRerun["phase"];dispatch:LegacyCandidateRerun["dispatch"];abandoned?:LegacyCandidateRerun["abandoned"];successorCandidateId?:string;successorWorkflowId:string;successorDecisionId?:string;continuationWorkflowId?:string}}> ;
  prepareLegacyCandidateRerun(candidateId:string,expectedCommit:string|null,requestId:string,actor:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number,expectedInputs?:Record<string,{commit:string;base:string}>):Promise<LegacyCandidateRerun>;
  getLegacyCandidateRerun(id:string):Promise<LegacyCandidateRerun|null>;
  abandonLegacyCandidateRerun(id:string,actor:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number):Promise<LegacyCandidateRerun>;
  markLegacyCandidateRerunDispatch(id:string,dispatch:"unknown"|"observed"):Promise<LegacyCandidateRerun>;
  assertLegacyCandidateRerun(id:string,actor?:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number,holder?:string):Promise<LegacyCandidateRerun>;
  stopLegacyCandidateRerun(id:string,allowChangedInputs?:boolean,actor?:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number):Promise<LegacyCandidateRerun>;
  commitLegacyCandidateRerunReassignment(id:string):Promise<LegacyCandidateRerun>;
  attachLegacyCandidateRerunSuccessor(id:string,candidateId:string):Promise<LegacyCandidateRerun>;
  ownerRebaseApplications(actor:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number):Promise<{applications:OwnerRebaseApplication[];truncated:boolean}>;
  prepareRebaseApplication(input:RetainedInput,commit:string,base:string,parentAccepted:boolean):Promise<RebaseApplication>;
  recordRebaseRemoteOutcome(id:string,observedCommit:string):Promise<RebaseApplication>;
  rebaseApplication(taskId:string,workflowId:string,candidateId:string,targetBase:string):Promise<RebaseApplication|null>;
  prepareRetainedInput(taskId:string,workflowId:string,candidateId:string,id:string,followup?:boolean):Promise<RetainedInput>;
  recordRetainedInput(input:RetainedInput,proof:{commit:string;base:string}):Promise<RetainedInputReceipt>;
  applyRebase(taskId: string, r: { commit?: string; base?: string; parentAccepted?: boolean; failed?: string; expected?:RetainedInput; receiptId?:string;applicationId?:string }): Promise<void>;
  listActivity(limit: number): Promise<ActivityRow[]>;
  setVerificationPolicy(policy: Record<string, unknown>): Promise<void>;
  destroy(): Promise<void>;
  repositoryDeletionPending(): Promise<boolean>;
  beginRepositoryDeletion(): Promise<void>;
  repositoryArtifactDeleted(name: string): Promise<boolean>;
  recordRepositoryArtifactDeleted(name: string): Promise<void>;
  initialize(init: { projectId: string; projectName: string; canonicalRepoName: string; head: string; tree?: string; verificationPolicy: Record<string, unknown>; kind?: "demo" | "import" | "empty"; defaultBranch?: string; ownerId?: string; source?: string }): Promise<FlareGitProjectState>;
  createTask(task: Task, actorId?: string,creationInput?:TaskCreationInput): Promise<Task & {creationReplayed?:boolean}>;
  taskCreationReplay(taskId:string,actorId:string,input:TaskCreationInput):Promise<Task|null>;
  mintGitCapability(userId: string, taskId: string | null, write: boolean, parentTokenHash?: string): Promise<{token: string; expiresInSeconds: number}>;
  verifyGitCapability(secret: string, taskId: string | null, write: boolean): Promise<{userId:string;parentTokenHash:string|null}|null>;
  canGitAccess(userId: string, taskId: string | null, write: boolean): Promise<boolean>;
  apiTokenHashActive(hash: string): Promise<boolean>;
  apiTokenHashCanRead(hash:string,userId:string,projectId:string,write?:boolean):Promise<boolean>;
  apiTokenHashCanAdminister(hash: string, userId: string, projectId: string): Promise<boolean>;
  beginArtifactAllocation(input:Omit<PendingArtifactAllocation,"phase">,scope:"account"|"project"):Promise<void>;
  activateArtifactAllocation(name:string,operationId:string,scope:"account"|"project"):Promise<void>;
  settleArtifactAllocation(name:string,operationId:string):Promise<void>;
  pendingArtifactAllocations():Promise<PendingArtifactAllocation[]>;
  reconcileArtifactInventory(namespace:string,names:string[]):Promise<void>;
  claimArtifactExisting(name:string,userId:string,kind:ArtifactKind,projectId:string):Promise<void>;
  reserveArtifactStorage(name:string,owner:string,kind:ArtifactKind,projectId:string,policy:StorageAdmissionPolicy):Promise<StorageReservation>;
  recordArtifactDeletion(name:string,confirmed:boolean):Promise<void>;
  artifactProjectManifest(projectId:string):Promise<Array<{name:string;state:string}>>;
  artifactOwnerManifest(owner:string):Promise<Array<{name:string;state:string;projectId:string|null}>>;
  artifactStorageSnapshot():Promise<ReturnType<ArtifactStorageAdmission["snapshot"]>>;

  revokeGitCapabilities(userId: string): Promise<void>;
  resolveDecision(decisionId: string, selectedOptionId: string, actor: HumanDecisionActor, credentialHash?: string, sessionExpiresAt?:number): Promise<{ taskIds: string[];legacyRerunId?:string;continuationWorkflowId?:string }>;
  getState(): Promise<FlareGitProjectState>;
  claimLanding(req: { holder: string; taskIds: string[]; preservationProtocolVersion?: 1 }): Promise<ClaimResult>;
  recordVerification(candidateId: string, commit: string, evidence: VerificationEvidence): Promise<void>;
  recordComposition(candidateId: string, attempts: RepairAttempt[]): Promise<void>;
  awaitReview(candidateId: string, commit: string, workflowInstanceId: string): Promise<void>;
  recordReview(candidateId: string, review: { approved: boolean; actor: HumanDecisionActor; note?: string }, expectedCommit: string, credentialHash?: string): Promise<{ ok: boolean; instanceId?: string; error?: string; review?: CandidateGeneration["review"] }>;
  preparePublish(candidateId: string): Promise<PrepareResult>;
  authorizeCandidatePublication(candidateId: string, commit: string): Promise<boolean>;
  completePublish(journalId: string): Promise<void>;
  abortPublish(candidateId: string, journalId: string | undefined, reason: string, outcome: "failed" | "stale"): Promise<void>;
  cancelTask(taskId: string): Promise<void>;
  failAgentTask(taskId: string, runId?: string): Promise<void>;
  beginAgentTask(taskId: string, runId?: string): Promise<boolean>;
  getBilling(): Promise<{ plan: "free" | "pro"; status: string; subscriptionId?: string; updatedAt: string }>;
  setBilling(b: { plan: "free" | "pro"; status: string; subscriptionId?: string; updatedAt: string }): Promise<void>;
  usageToday(): Promise<number>;
  consumeRun(limit: number, admissionKey?: string): Promise<{ allowed: boolean; used: number }>;
  ingestMemberCheckpoint(ev:{eventId:string;taskId:string;commit:string;ready:boolean;filesChanged?:string[]},userId:string,context:RepositoryReadContext,credentialHash?:string,sessionExpiresAt?:number):Promise<{applied:boolean}>;
  ingestCheckpoint(ev: { eventId: string; taskId: string; commit: string; ready: boolean; filesChanged?: string[] }): Promise<{ applied: boolean }>;
}

const LEASE_MS = 20 * 60_000;

/**
 * Authoritative project state (SQLite-backed). Single writer: every transition — event ingestion,
 * landing lease, publication ledger, decisions — is validated and committed here, so duplicate or
 * late events and concurrent landings cannot corrupt accepted state.
 */
export type PreviewOriginRegistration = { repository_id: string; origin: string; status: "active" | "retired"; registered_by: string; registered_at: string; retired_by: string | null; retired_at: string | null };

export class RepositoryController extends DurableObject<Env> {
  private previewOriginSchemaReady = false;
  private previewMigrationFingerprint: string | null = null;

  private previewOriginTable(appOrigin?: string): void {
    if (!this.previewOriginSchemaReady) {
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS preview_origins(repository_id TEXT NOT NULL,origin TEXT PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('active','retired')),registered_by TEXT NOT NULL,registered_at TEXT NOT NULL,retired_by TEXT,retired_at TEXT); CREATE UNIQUE INDEX IF NOT EXISTS preview_origins_active_repository ON preview_origins(repository_id) WHERE status='active'; CREATE INDEX IF NOT EXISTS preview_origins_repository_history ON preview_origins(repository_id,registered_at DESC); CREATE TABLE IF NOT EXISTS preview_origin_migration(id INTEGER PRIMARY KEY CHECK(id=1),fingerprint TEXT NOT NULL)");
      this.previewOriginSchemaReady = true;
    }
    const fingerprint = JSON.stringify([this.env.REPOSITORY_PREVIEW_ORIGINS ?? "{}", this.env.CLERK_ISSUER ?? "", this.env.CLERK_AUTHORIZED_PARTIES ?? ""]);
    if (this.previewMigrationFingerprint === fingerprint) return;
    const previous = this.ctx.storage.sql.exec<{ fingerprint: string }>("SELECT fingerprint FROM preview_origin_migration WHERE id=1").toArray()[0];
    if (previous?.fingerprint === fingerprint) { this.previewMigrationFingerprint = fingerprint; return; }
    // Reserve every legacy assignment before allowing registrations. Static config
    // can never revive a tombstone or overwrite a durable reservation.
    const legacy = previewOrigins({ ...this.env, REPOSITORY_PREVIEW_ORIGINS: this.env.REPOSITORY_PREVIEW_ORIGINS ?? "{}" }, appOrigin);
    if (!legacy) throw new Error("Legacy preview origin configuration is invalid");
    this.ctx.storage.transactionSync(() => {
      for (const [repository, origin] of legacy) {
        if (!validPreviewRegistration(this.env, repository, origin, appOrigin)) throw new Error("Legacy preview origin configuration is invalid");
        const rows = this.ctx.storage.sql.exec<PreviewOriginRegistration>("SELECT * FROM preview_origins WHERE origin=?", origin).toArray();
        if (rows.some((row) => row.repository_id !== repository)) throw new Error("Preview origin reservation conflicts with legacy configuration");
        if (!rows.length) {
          const reserved = this.ctx.storage.sql.exec("SELECT origin FROM preview_origins WHERE repository_id=?", repository).toArray().length > 0;
          const now = new Date().toISOString();
          this.ctx.storage.sql.exec("INSERT INTO preview_origins(repository_id,origin,status,registered_by,registered_at,retired_by,retired_at) VALUES(?,?,?,'static-migration',?,?,?)", repository, origin, reserved ? "retired" : "active", now, reserved ? "static-migration" : null, reserved ? now : null);
        }
      }
      this.ctx.storage.sql.exec("INSERT INTO preview_origin_migration VALUES(1,?) ON CONFLICT(id) DO UPDATE SET fingerprint=excluded.fingerprint", fingerprint);
    });
    this.previewMigrationFingerprint = fingerprint;
  }

  async activePreviewOrigin(repository: string, appOrigin?: string): Promise<string | null> {
    this.previewOriginTable(appOrigin);
    const row = this.ctx.storage.sql.exec<{ origin: string }>("SELECT origin FROM preview_origins WHERE repository_id=? AND status='active' LIMIT 1", repository).toArray()[0];
    return row ? validPreviewRegistration(this.env, repository, row.origin, appOrigin) : null;
  }

  async previewOrigin(repository: string, appOrigin?: string): Promise<PreviewOriginRegistration | null> {
    this.previewOriginTable(appOrigin);
    const active = this.ctx.storage.sql.exec<PreviewOriginRegistration>("SELECT * FROM preview_origins WHERE repository_id=? AND status='active' LIMIT 1", repository).toArray()[0];
    const row = active ?? this.ctx.storage.sql.exec<PreviewOriginRegistration>("SELECT * FROM preview_origins WHERE repository_id=? ORDER BY registered_at DESC LIMIT 1", repository).toArray()[0];
    if (!row) return null;
    if (!validPreviewRegistration(this.env, repository, row.origin, appOrigin)) return { ...row, status: "retired" };
    return row;
  }

  async registerPreviewOrigin(repository: string, origin: string, operator: string, appOrigin: string): Promise<PreviewOriginRegistration> {
    const normalized = validPreviewRegistration(this.env, repository, origin, appOrigin);
    if (!normalized || normalized !== origin) throw new Error("Use the exact HTTPS native Worker origin for this repository");
    this.previewOriginTable(appOrigin);
    return this.ctx.storage.transactionSync(() => {
      const rows = this.ctx.storage.sql.exec<PreviewOriginRegistration>("SELECT * FROM preview_origins WHERE (repository_id=? AND status='active') OR origin=?", repository, origin).toArray();
      if (rows.length) {
        const row = rows[0]!;
        if (rows.length !== 1 || row.repository_id !== repository || row.origin !== origin || row.status !== "active") throw new Error("Retire the active assignment before replacing it; retired origins cannot be reused");
        return row;
      }
      this.ctx.storage.sql.exec("INSERT INTO preview_origins(repository_id,origin,status,registered_by,registered_at) VALUES(?,?,'active',?,?)", repository, origin, operator, new Date().toISOString());
      return this.ctx.storage.sql.exec<PreviewOriginRegistration>("SELECT * FROM preview_origins WHERE origin=?", origin).one();
    });
  }

  async retirePreviewOrigin(repository: string, operator: string, appOrigin: string): Promise<PreviewOriginRegistration | null> {
    this.previewOriginTable(appOrigin);
    this.ctx.storage.sql.exec("UPDATE preview_origins SET status='retired',retired_by=?,retired_at=? WHERE repository_id=? AND status='active'", operator, new Date().toISOString(), repository);
    return this.previewOrigin(repository, appOrigin);
  }

  private state: FlareGitProjectState | null = null;
  private historyAttemptLocal(id:string,actor:HistoryInspectionActor|undefined,allowPaused=false){
    if(!actor)throw new Error("Exact inspection attempt authority required");
    const inspection=new ImportHistoryInspection(this.ctx.storage).authority(id),attempt=new ImportHistoryAttempts(this.ctx.storage).get(id),state=this.load();
    if(!inspection||!attempt||attempt.generation!==actor.generation||attempt.workflowId!==actor.workflowId||attempt.terminal||(!allowPaused&&inspection.status!=="running")||this.repositoryDeleting()||state.projectId!==inspection.scope.projectId||state.canonicalRepoName!==inspection.scope.canonicalRepoName||new PrivateRecoveryOperations(this.ctx.storage).incarnation()!==inspection.scope.incarnation||this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",inspection.scope.ownerId).toArray()[0]?.role!=="owner")throw new Error("Inspection attempt was replaced or its authority changed");
    return inspection.scope;
  }
  async assertHistoryInspectionAttempt(id:string,generation:number,workflowId:string){
    const actor={generation,workflowId},scope=this.historyAttemptLocal(id,actor);
    if(await accountOf(this.env,scope.accountKey).accountLifecycle()!=="active")throw new Error("Inspection account is unavailable");
    this.historyAttemptLocal(id,actor);
  }
  private historySnapshot(operationId:string):HistoryInspectionSnapshot|null{
    const value=new ImportHistoryInspection(this.ctx.storage).get(operationId);
    return value?{...value,currentAttempt:new ImportHistoryAttempts(this.ctx.storage).get(operationId)}:null;
  }
  private async authorizeHistoryInspection(operationId:string,accountKey?:string,expectedHead?:string){
    const known=new ImportHistoryInspection(this.ctx.storage).get(operationId),state=this.load();
    const key=known?.scope.accountKey??accountKey;
    if(!key||this.repositoryDeleting())throw new Error("Inspection owner unavailable");
    const account=accountOf(this.env,key);
    const [operation,job,lifecycle]=await Promise.all([account.getImportHistoryOperation(operationId),account.getImportJob(state.projectId),account.accountLifecycle()]);
    if(!operation||!job||lifecycle!=="active"||job.status!=="ready"||job.ownerId!==operation.ownerId||job.id!==state.projectId||operation.projectId!==state.projectId||job.canonicalRepoName!==state.canonicalRepoName||operation.canonicalRepoName!==state.canonicalRepoName||job.importedHead!==operation.head||!job.importedBranch||(expectedHead!==undefined&&operation.head!==expectedHead)||await accountKeyFor(operation.ownerId)!==key)throw new Error("Inspection import authority changed");
    if(await this.roleOf(operation.ownerId)!=="owner")throw new Error("Inspection owner access revoked");
    if(await account.accountLifecycle()!=="active")throw new Error("Inspection account was sealed during authorization");
    if(!known&&operation.protocolVersion!==2)throw new Error("Legacy inspection dispatch remains unconfirmed");
    const scope={operationId,projectId:state.projectId,incarnation:new PrivateRecoveryOperations(this.ctx.storage).incarnation(),ownerId:operation.ownerId,accountKey:key,canonicalRepoName:state.canonicalRepoName,source:job.source,branch:job.importedBranch,head:operation.head};
    const fresh=this.load();
    if(this.repositoryDeleting()||fresh.projectId!==scope.projectId||fresh.canonicalRepoName!==scope.canonicalRepoName||new PrivateRecoveryOperations(this.ctx.storage).incarnation()!==scope.incarnation||this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",scope.ownerId).toArray()[0]?.role!=="owner"||(known&&JSON.stringify(known.scope)!==JSON.stringify(scope)))throw new Error("Inspection scope changed during authorization");
    return scope;
  }
  async beginHistoryInspection(id:string,accountKey:string,head:string){const scope=await this.authorizeHistoryInspection(id,accountKey,head);new ImportHistoryInspection(this.ctx.storage).begin(scope);return this.historySnapshot(id)!;}
  async getHistoryInspection(id:string){if(!new ImportHistoryInspection(this.ctx.storage).get(id))return null;await this.authorizeHistoryInspection(id);return this.historySnapshot(id);}
  async importHistoryBatch(id:string,side:HistorySide,limit=256){await this.authorizeHistoryInspection(id);return new ImportHistoryInspection(this.ctx.storage).batch(id,side,limit);}
  async commitHistoryChunk(id:string,side:HistorySide,chunk:HistoryChunk,actor?:HistoryInspectionActor){const result=await new ImportHistoryInspection(this.ctx.storage).commit(id,side,chunk,async()=>{if(!actor)throw new Error("Exact inspection attempt required");await this.assertHistoryInspectionAttempt(id,actor.generation,actor.workflowId);},()=>{this.historyAttemptLocal(id,actor);});return{...result,snapshot:this.historySnapshot(id)!};}
  async pauseHistoryInspection(id:string,reason:string,actor?:HistoryInspectionActor){if(!actor)throw new Error("Exact inspection attempt required");await this.assertHistoryInspectionAttempt(id,actor.generation,actor.workflowId);this.historyAttemptLocal(id,actor);new ImportHistoryInspection(this.ctx.storage).pause(id,reason);return this.historySnapshot(id)!;}
  async resumeHistoryInspection(id:string,actor?:HistoryInspectionActor){await this.authorizeHistoryInspection(id);this.historyAttemptLocal(id,actor,true);new ImportHistoryInspection(this.ctx.storage).resume(id);return this.historySnapshot(id)!;}
  async finishHistoryInspection(id:string,actor?:HistoryInspectionActor){if(!actor)throw new Error("Exact inspection attempt required");await this.assertHistoryInspectionAttempt(id,actor.generation,actor.workflowId);this.historyAttemptLocal(id,actor);new ImportHistoryInspection(this.ctx.storage).finish(id);return this.historySnapshot(id)!;}
  async historyInspectionAttempt(id:string){await this.authorizeHistoryInspection(id);return new ImportHistoryAttempts(this.ctx.storage).get(id);}
  async startHistoryInspectionAttempt(id:string,generation:number){await this.authorizeHistoryInspection(id);const snapshot=this.historySnapshot(id);if(!snapshot||["verified","mismatch"].includes(snapshot.status))throw new Error("Inspection already finished");return this.ctx.storage.transactionSync(()=>{const fresh=this.load(),scope=snapshot.scope;if(this.repositoryDeleting()||fresh.projectId!==scope.projectId||fresh.canonicalRepoName!==scope.canonicalRepoName||new PrivateRecoveryOperations(this.ctx.storage).incarnation()!==scope.incarnation||this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",scope.ownerId).toArray()[0]?.role!=="owner")throw new Error("Inspection resume authority changed");const attempt=new ImportHistoryAttempts(this.ctx.storage).start(id,generation);new ImportHistoryInspection(this.ctx.storage).resume(id);return attempt;});}
  async markHistoryInspectionDispatch(id:string,generation:number){await this.authorizeHistoryInspection(id);return new ImportHistoryAttempts(this.ctx.storage).dispatchUnknown(id,generation);}
  async observeHistoryInspectionAttempt(id:string,generation:number,status:string){await this.authorizeHistoryInspection(id);if(status!=="queued"&&status!=="running"&&status!=="waiting"&&status!=="complete"&&status!=="errored"&&status!=="terminated")throw new Error("Inspection provider state is unconfirmed");return new ImportHistoryAttempts(this.ctx.storage).observed(id,generation,status);}
  async historyInspectionNativeIntent(id:string,generation:number,workflowId?:string){if(!workflowId)throw new Error("Exact inspection native attempt required");await this.assertHistoryInspectionAttempt(id,generation,workflowId);this.historyAttemptLocal(id,{generation,workflowId});return new ImportHistoryAttempts(this.ctx.storage).nativeAllocationIntent(id,generation);}
  async historyInspectionNativeStopped(id:string,generation:number,nativeRunId:string){
    const attempt=new ImportHistoryAttempts(this.ctx.storage).get(id);
    if(!attempt||attempt.generation!==generation||attempt.nativeRunId!==nativeRunId)throw new Error("Inspection native identity changed");
    if(attempt.nativeState==="unallocated"||attempt.nativeState==="stopped")return new ImportHistoryAttempts(this.ctx.storage).nativeStopped(id,generation,nativeRunId);
    const sandbox=this.env.INTEGRATOR.getByName(nativeRunId);
    await sandbox.destroy();if((await sandbox.lifetimeStatus())?.state!=="stopped")throw new Error("Inspection native stop is unconfirmed");
    return new ImportHistoryAttempts(this.ctx.storage).nativeStopped(id,generation,nativeRunId);
  }
  async listHistoryInspectionAttemptsForCleanup(){if(!this.repositoryDeleting())throw new Error("Inspection cleanup requires deletion fence");new ImportHistoryInspection(this.ctx.storage);const ids=this.ctx.storage.sql.exec<{id:string}>("SELECT id FROM history_inspections ORDER BY id").toArray();return ids.flatMap(row=>{const attempt=new ImportHistoryAttempts(this.ctx.storage).get(row.id);return attempt?[attempt]:[];});}
  async previewGenerationCredentialIncident(g:string,repoName:string,token:string,expiresAt:number){
    const record=new RepositoryPreviewGenerations(this.ctx.storage).get(g);
    if(!record||repoName!==`flaregit-${record.identity.projectId}`||record.identity.projectId!==this.load().projectId)throw new Error("Preview credential incident repository mismatch");
    await new PreviewCredentialIncidents(this.ctx.storage).record(g,repoName,token,expiresAt,undefined,()=>{
      const current=new RepositoryPreviewGenerations(this.ctx.storage).get(g);
      if(!current||current.identity.projectId!==record.identity.projectId||current.identity.incarnation!==record.identity.incarnation||repoName!==`flaregit-${current.identity.projectId}`||this.load().canonicalRepoName!==repoName)throw new Error("Preview credential incident scope changed");
    });
    await this.ensureRecoveryAlarm();
  }
  async previewGenerationCredentialSummary(g:string){const incidents=new PreviewCredentialIncidents(this.ctx.storage);incidents.pendingBatch();return incidents.summary(g);}
  private async retryPreviewCredentialIncidents(){
    const incidents=new PreviewCredentialIncidents(this.ctx.storage),pending=incidents.pendingBatch();
    for(const incident of pending){
      if(!incidents.markAttempt(incident.generation))continue;
      try{using repo=await this.env.ARTIFACTS.get(incident.repoName);if(await repo.revokeToken(incident.token))await incidents.markRevoked(incident.generation,incident.token);}catch{console.error("Preview credential revocation retry unavailable");}
    }
    if(this.ctx.storage.sql.exec("SELECT generation FROM preview_credential_incidents WHERE status='pending' LIMIT 1").toArray().length)await this.ensureRecoveryAlarm();
  }
  async previewGenerationBegin(commit:string,canonicalRepo:string,actorId:string,expected:string|null,key:string,sourceKey?:string){
    if(await this.roleOf(actorId)!=="owner"||await accountOf(this.env,await accountKeyFor(actorId)).accountLifecycle()!=="active")throw new Error("Active preview owner required");
    const identity=await this.previewStorageScope(commit,canonicalRepo);
    if(await this.roleOf(actorId)!=="owner")throw new Error("Preview owner access changed");
    return new RepositoryPreviewGenerations(this.ctx.storage).begin(identity,actorId,expected,key,sourceKey);
  }
  async previewGenerationGet(g:string){return new RepositoryPreviewGenerations(this.ctx.storage).get(g);}
  async previewGenerationLatest(commit:string){return new RepositoryPreviewGenerations(this.ctx.storage).latest(commit);}
  async previewGenerationActive(commit:string){return new RepositoryPreviewGenerations(this.ctx.storage).active(commit);}
  async previewGenerationScope(g:string){
    const generations=new RepositoryPreviewGenerations(this.ctx.storage),record=generations.get(g);
    if(!record||record.state==="quarantined"||generations.latest(record.identity.commit)?.generation!==g)throw new Error("Preview generation was superseded");
    if(await this.roleOf(record.actorId)!=="owner"||await accountOf(this.env,await accountKeyFor(record.actorId)).accountLifecycle()!=="active")throw new Error("Preview actor access changed");
    const scope=await this.previewStorageScope(record.identity.commit,this.load().canonicalRepoName);
    if(JSON.stringify(scope)!==JSON.stringify(record.identity))throw new Error("Preview generation owner or incarnation changed");
    return{...scope,generation:g};
  }
  async previewGenerationClaim(g:string){await this.previewGenerationScope(g);return new RepositoryPreviewGenerations(this.ctx.storage).markBuilding(g);}
  async previewGenerationFail(g:string,reason:string){new RepositoryPreviewGenerations(this.ctx.storage).fail(g,reason);}
  async previewGenerationPromote(g:string,hash:string){
    const before=await this.previewGenerationScope(g);
    if(!await globalOf(this.env).previewGenerationStorageReady(previewManifestPrefix(before),hash))throw new Error("Preview generation upload receipts are unconfirmed");
    const scope=await this.previewGenerationScope(g),{generation:_,...identity}=scope;void _;
    new RepositoryPreviewGenerations(this.ctx.storage).promote(g,identity,hash);
  }
  async previewGenerationStorageReady(key:string,hash:string){
    new PreviewStorageWriters(this.ctx.storage);
    const row=this.ctx.storage.sql.exec<{payload:string}>("SELECT payload FROM preview_storage_reservations WHERE physical_key=?",key).toArray()[0];
    if(!row)return false;
    const manifest=JSON.parse(row.payload) as PreviewStorageManifest;
    if(!manifest.identity.generation||manifest.manifestHash!==hash||previewManifestPrefix(manifest.identity)!==key)return false;
    if(this.ctx.storage.sql.exec("SELECT physical_key FROM preview_generation_quarantines WHERE physical_key=?",key).toArray().length)return false;
    const writers=this.ctx.storage.sql.exec<{closed:number;pending:string}>("SELECT closed,pending FROM preview_copy_writers WHERE physical_key=?",key).toArray();
    if(!writers.length||writers.some(writer=>!writer.closed||(JSON.parse(writer.pending) as unknown[]).length))return false;
    for(const asset of manifest.assets){const object=await this.env.EVIDENCE_BUCKET.head(`${key}/${asset.path}`);if(!object||object.size!==asset.size||object.customMetadata?.manifestHash!==hash||object.customMetadata?.sha256!==asset.sha256)return false;}
    return !(await this.previewStorageWriterState(key)).unfinished;
  }
  async previewGenerationForRead(commit:string,inc:string,g:string){
    const generations=new RepositoryPreviewGenerations(this.ctx.storage),record=generations.get(g);
    if(!record||record.state!=="ready"||record.identity.commit!==commit||record.identity.incarnation!==inc||!record.manifestHash)return false;
    try{const scope=await this.previewStorageScope(commit,this.load().canonicalRepoName);return JSON.stringify(scope)===JSON.stringify(record.identity);}catch{return false;}
  }
  async previewLegacyGenerationAllowed(commit:string){return !new RepositoryPreviewGenerations(this.ctx.storage).latest(commit);}
  private savedPreviewManifest(key:string,identity:PreviewStorageIdentity){
    new PreviewStorageLedger(this.ctx.storage);
    const row=this.ctx.storage.sql.exec<{payload:string}>("SELECT payload FROM preview_storage_reservations WHERE physical_key=?",key).toArray()[0];
    if(!row)throw new Error("Saved funded preview manifest unavailable");
    const manifest=JSON.parse(row.payload) as PreviewStorageManifest;
    if(previewManifestPrefix(manifest.identity)!==key||["projectId","commit","incarnation","accountKey"].some(field=>manifest.identity[field as keyof PreviewStorageIdentity]!==identity[field as keyof PreviewStorageIdentity]))throw new Error("Preview recovery storage scope changed");
    return manifest;
  }
  async previewGenerationEstimate(key:string,identity:PreviewStorageIdentity,g:string){const manifest=this.savedPreviewManifest(key,identity);return createPreviewStorageManifest({...identity,generation:g},manifest.assets);}
  async previewGenerationCapacity(key:string,identity:PreviewStorageIdentity){const manifest=this.savedPreviewManifest(key,identity);return new PreviewStorageLedger(this.ctx.storage).capacity(manifest.totalBytes,identity.accountKey,previewStorageBudget(this.env));}
  async reservePreviewGenerationEstimate(manifest:PreviewStorageManifest):Promise<PreviewStorageAdmission>{await validatePreviewStorageManifest(manifest);try{this.ctx.storage.transactionSync(()=>{new PreviewStorageLedger(this.ctx.storage).estimate(manifest,previewStorageBudget(this.env));new PreviewStorageWriters(this.ctx.storage).registerPreview(previewManifestPrefix(manifest.identity));});return{allowed:true};}catch(error){if(error instanceof PreviewStorageAdmissionError)return{allowed:false,reason:error.reason};throw error;}}
  async finalizePreviewGenerationManifest(manifest:PreviewStorageManifest):Promise<PreviewStorageAdmission>{await validatePreviewStorageManifest(manifest);try{this.ctx.storage.transactionSync(()=>{new PreviewStorageLedger(this.ctx.storage).finalize(manifest,previewStorageBudget(this.env));const key=previewManifestPrefix(manifest.identity);if(this.ctx.storage.sql.exec("SELECT physical_key FROM preview_copy_writers WHERE physical_key=?",key).toArray().length)throw new Error("Generation already has upload activity");const writers=new PreviewStorageWriters(this.ctx.storage),plan=writers.plan(key);this.ctx.storage.sql.exec("UPDATE preview_copy_plans SET doc=? WHERE physical_key=?",JSON.stringify({...plan,keys:manifest.assets.map(asset=>`${key}/${asset.path}`),bytes:manifest.totalBytes}),key);});return{allowed:true};}catch(error){if(error instanceof PreviewStorageAdmissionError)return{allowed:false,reason:error.reason};throw error;}}
  async quarantinePreviewStorage(key:string,identity:PreviewStorageIdentity){this.savedPreviewManifest(key,identity);new PreviewStorageWriters(this.ctx.storage);this.ctx.storage.sql.exec("INSERT OR IGNORE INTO preview_generation_quarantines VALUES(?)",key);}
  async reservePreviewWriter(key:string,writerId:string):Promise<void>{const writers=new PreviewStorageWriters(this.ctx.storage);writers.registerPreview(key);writers.begin(key,writerId);}
  async beginPreviewPut(key:string,writerId:string,assetPath:string):Promise<void>{new PreviewStorageWriters(this.ctx.storage).dispatch(key,writerId,assetPath?`${key}/${assetPath}`:key);}
  async finishPreviewPut(key:string,writerId:string,assetPath:string):Promise<void>{new PreviewStorageWriters(this.ctx.storage).settled(key,writerId,assetPath?`${key}/${assetPath}`:key);}
  async finishPreviewWriter(key:string,writerId:string):Promise<void>{new PreviewStorageWriters(this.ctx.storage).finish(key,writerId);}
  async registerPreviewEvidenceCopy(identity:PreviewStorageManifest["identity"],id:string,size:number,sha256:string,writerId:string):Promise<string>{const writers=new PreviewStorageWriters(this.ctx.storage),key=writers.registerEvidence(identity,id,size,sha256);writers.begin(key,writerId);return key;}
  private scopedEvidenceCopyTable():void{this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS scoped_evidence_copies(id TEXT PRIMARY KEY,object_key TEXT NOT NULL,legacy_pending INTEGER NOT NULL DEFAULT 1)");try{this.ctx.storage.sql.exec("ALTER TABLE scoped_evidence_copies ADD COLUMN legacy_pending INTEGER NOT NULL DEFAULT 1");}catch{/* Existing column. */}}
  async recordScopedEvidenceCopy(id:string,key:string,incarnation:string):Promise<void>{
    const state=this.load(),projectId=state.projectId;
    if(this.repositoryDeleting()||!state.evidence[id]||new PrivateRecoveryOperations(this.ctx.storage).incarnation()!==incarnation||key!==`evidence/${projectId}/${incarnation}/${id}.json`||! EVIDENCE_COPY_ID.test(id))throw new Error("Evidence copy scope changed");
    const legacyPresent=!!await this.env.EVIDENCE_BUCKET.head(`evidence/${id}.json`);
    const current=this.load();
    if(this.repositoryDeleting()||current.projectId!==projectId||!current.evidence[id]||new PrivateRecoveryOperations(this.ctx.storage).incarnation()!==incarnation)throw new Error("Evidence copy context changed");
    this.scopedEvidenceCopyTable();
    const previous=this.ctx.storage.sql.exec<{object_key:string}>("SELECT object_key FROM scoped_evidence_copies WHERE id=?",id).toArray()[0];
    if(previous&&previous.object_key!==key)throw new Error("Evidence copy reference is immutable");
    this.ctx.storage.sql.exec("INSERT INTO scoped_evidence_copies VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET legacy_pending=MAX(scoped_evidence_copies.legacy_pending,excluded.legacy_pending)",id,key,legacyPresent?1:0);
  }
  async previewCleanupScope():Promise<{projectId:string;incarnation:string;legacyEvidence:boolean;legacyInventory:boolean}>{if(!this.repositoryDeleting())throw new Error("Preview cleanup requires a deletion fence");const state=this.load(true);this.scopedEvidenceCopyTable();const tracked=new Set(this.ctx.storage.sql.exec<{id:string}>("SELECT id FROM scoped_evidence_copies WHERE legacy_pending=0").toArray().map(row=>row.id));this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS preview_copy_tracking_era(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL)");return{projectId:state.projectId,incarnation:new PrivateRecoveryOperations(this.ctx.storage).incarnation(),legacyEvidence:Object.keys(state.evidence).some(id=>!tracked.has(id)),legacyInventory:!this.ctx.storage.sql.exec("SELECT id FROM preview_copy_tracking_era WHERE id=1 AND version=1").toArray().length};}
  async fencePreviewCleanup(projectId:string,incarnation:string):Promise<PreviewCopyPlan[]>{return new PreviewStorageWriters(this.ctx.storage).fence(projectId,incarnation);}
  async previewCopyCleanupReady(key:string):Promise<boolean>{return new PreviewStorageWriters(this.ctx.storage).cleanupReady(key);}
  async finishPreviewCopyCleanup(key:string):Promise<void>{
    const writers=new PreviewStorageWriters(this.ctx.storage),plan=writers.plan(key);
    if(!writers.cleanupReady(key))throw new Error("Preview cleanup writers are unconfirmed");
    if(plan.keys.length<1||plan.keys.length>1000||plan.keys.some(objectKey=>objectKey.split("/").some(segment=>segment===".."||segment===".")||objectKey.includes("\\")||(plan.kind==="preview"?!objectKey.startsWith(`${plan.physicalKey}/`):objectKey!==plan.physicalKey)))throw new Error("Preview cleanup key scope is invalid");
    // Independently prove every server-recorded object absent. A helper assertion
    // or an unconfirmed delete response is never sufficient to release capacity.
    for(const objectKey of plan.keys)if(await this.env.EVIDENCE_BUCKET.head(objectKey))throw new Error("Preview storage absence is unconfirmed");
    this.ctx.storage.transactionSync(()=>{
      if(!writers.cleanupReady(key))throw new Error("Preview cleanup writer scope changed");
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS preview_copy_cleanup_receipts(physical_key TEXT PRIMARY KEY,keys_json TEXT NOT NULL,confirmed_at TEXT NOT NULL)");
      this.ctx.storage.sql.exec("INSERT OR IGNORE INTO preview_copy_cleanup_receipts VALUES(?,?,?)",key,JSON.stringify(plan.keys),new Date().toISOString());
      writers.retire(key);
      if(plan.kind==="preview")this.ctx.storage.sql.exec("DELETE FROM preview_storage_reservations WHERE physical_key=?",key);
      else this.ctx.storage.sql.exec("DELETE FROM evidence_storage_reservations WHERE physical_key=?",key);
    });
  }
  async reserveEvidenceStorage(identity:PreviewStorageIdentity,id:string,size:number,sha256:string):Promise<PreviewStorageAdmission>{
    try{new EvidenceStorageLedger(this.ctx.storage).reserve(identity,id,size,sha256,previewStorageBudget({PREVIEW_STORAGE_GLOBAL_BYTES:this.env.EVIDENCE_STORAGE_GLOBAL_BYTES,PREVIEW_STORAGE_ACCOUNT_BYTES:this.env.EVIDENCE_STORAGE_ACCOUNT_BYTES}));return{allowed:true};}
    catch(error){if(error instanceof PreviewStorageAdmissionError)return{allowed:false,reason:error.reason};throw error;}
  }
  async previewStorageReadmission(identity:PreviewStorageIdentity):Promise<PreviewStorageAdmission>{return new PreviewStorageLedger(this.ctx.storage).readmit(identity,previewStorageBudget(this.env));}
  async ownerStorageContext(ownerId:string):Promise<OwnerStorageContext|null>{return ownerStorageContext(this.ctx.storage,ownerId);}
  async storageCopyReportPage(projectId:string,incarnation:string,after:number):Promise<CopyReportPage>{return copyReportPage(this.ctx.storage,projectId,incarnation,after);}
  async storagePrivateReportPage(projectId:string,incarnation:string,after:number):Promise<ReturnType<typeof privateRecoveryReportPage>>{return privateRecoveryReportPage(this.ctx.storage,projectId,incarnation,after);}
  async reservePreviewStorage(manifest:PreviewStorageManifest):Promise<PreviewStorageAdmission>{await validatePreviewStorageManifest(manifest);try{new PreviewStorageLedger(this.ctx.storage).reserve(manifest,previewStorageBudget(this.env));return{allowed:true};}catch(error){if(error instanceof PreviewStorageAdmissionError){if(error.reason!=="storage_retired")new PreviewStorageLedger(this.ctx.storage).rememberRefusal(manifest);return{allowed:false,reason:error.reason};}throw error;}}
  async previewStorageScope(commit:string,canonicalRepoName:string):Promise<PreviewStorageManifest["identity"]>{
    const retained=(state:FlareGitProjectState)=>state.acceptedState.currentCommit===commit||state.journal.some(entry=>entry.state==="ACCEPTED"&&entry.newHead===commit)||Object.values(state.candidates).some(candidate=>candidate.candidateCommit===commit&&candidate.evidenceId&&state.evidence[candidate.evidenceId]?.status==="passed");
    const selectedOwner=()=>this.ctx.storage.sql.exec<{user_id:string}>("SELECT user_id FROM members WHERE role='owner' ORDER BY added_at,user_id LIMIT 1").toArray()[0]?.user_id;
    const state=this.load();
    if(this.repositoryDeleting()||!isSafeSha(commit)||state.canonicalRepoName!==canonicalRepoName||!retained(state))throw new Error("Preview repository scope changed");
    const projectId=state.projectId,incarnation=new PrivateRecoveryOperations(this.ctx.storage).incarnation(),ownerId=selectedOwner();
    if(!ownerId)throw new Error("Preview owner is unavailable");
    const accountKey=await accountKeyFor(ownerId);
    if(await accountOf(this.env,accountKey).accountLifecycle()!=="active")throw new Error("Preview owner authority changed");
    const current=this.load();
    if(this.repositoryDeleting()||current.projectId!==projectId||current.canonicalRepoName!==canonicalRepoName||!retained(current)||new PrivateRecoveryOperations(this.ctx.storage).incarnation()!==incarnation||selectedOwner()!==ownerId)throw new Error("Preview repository or owner scope changed during authorization");
    return {projectId,incarnation,commit,accountKey};
  }
  async reservePrivateRecoveryStorage(id:string,accountKey:string):Promise<void>{new PrivateRecoveryStorage(this.ctx.storage).reserve(id,accountKey);}
  async releasePrivateRecoveryStorage(id: string, accountKey: string): Promise<void> { new PrivateRecoveryStorage(this.ctx.storage).release(id, accountKey); }
  async privateRecoveryBeginUpload(id: string, expectedScope: string): Promise<void> {
    const op = await this.privateRecoveryOperation(id);
    if (!op || recoveryScopeId(op) !== expectedScope || !await this.privateRecoveryAuthorize(id, op.ownerId)) throw new Error("Recovery authorization changed");
    const ops = new PrivateRecoveryOperations(this.ctx.storage), current = ops.get(id);
    if (!current || recoveryScopeId(current) !== expectedScope || !this.privateRecoveryScopeCurrent(current)) throw new Error("Recovery authorization changed");
    ops.beginUpload(id);
  }
  async privateRecoverySaveUpload(id: string, uploadId: string, expectedScope: string): Promise<void> {
    const op = await this.privateRecoveryOperation(id);
    if (!op || recoveryScopeId(op) !== expectedScope || !await this.privateRecoveryAuthorize(id, op.ownerId)) throw new Error("Recovery authorization changed");
    const ops = new PrivateRecoveryOperations(this.ctx.storage), current = ops.get(id);
    if (!current || recoveryScopeId(current) !== expectedScope || !this.privateRecoveryScopeCurrent(current)) throw new Error("Recovery authorization changed");
    ops.saveUpload(id, uploadId);
  }
  async privateRecoveryCloseUpload(id: string, uploadId: string, expectedScope: string): Promise<void> { const ops=new PrivateRecoveryOperations(this.ctx.storage), op=ops.get(id); if(!op||recoveryScopeId(op)!==expectedScope)throw new Error("Recovery scope changed");ops.closeUpload(id, uploadId); }
  async privateRecoveryBeginDeletion(id: string, ownerId: string): Promise<PrivateRecoveryOperation> {
    if (await this.roleOf(ownerId) !== "owner") throw new Error("Owner recovery authorization required");
    const ops = new PrivateRecoveryOperations(this.ctx.storage), op = ops.get(id);
    const currentRole = this.ctx.storage.sql.exec<{role: string}>("SELECT role FROM members WHERE user_id=?", ownerId).toArray()[0]?.role;
    if (!op || currentRole !== "owner" || op.incarnation !== ops.incarnation() || op.canonicalRepoName !== this.load().canonicalRepoName) throw new Error("Recovery scope changed");
    ops.beginDeletion(id);
    const retiring = ops.get(id);
    if (!retiring) throw new Error("Unknown recovery operation");
    return retiring;
  }
  async privateRecoveryFinishDeletion(id: string): Promise<void> {
    const ops = new PrivateRecoveryOperations(this.ctx.storage);
    if (this.repositoryDeleting()) ops.beginDeletion(id);
    ops.finishDeletion(id);
  }
  async privateRecoveryCleanupList(): Promise<PrivateRecoveryOperation[]> { return new PrivateRecoveryOperations(this.ctx.storage).all(); }
  async privateRecoveryOperation(id:string):Promise<PrivateRecoveryOperation|null>{return new PrivateRecoveryOperations(this.ctx.storage).get(id);}
  async privateRecoveryList():Promise<PrivateRecoveryOperation[]>{return new PrivateRecoveryOperations(this.ctx.storage).list();}
  async privateRecoveryPrepare(id:string,commit:string,tree:string|null,ownerId:string,accountKey:string):Promise<PrivateRecoveryOperation>{
   if(!/^[a-f0-9-]{36}$/.test(id)||this.repositoryDeleting()||await this.roleOf(ownerId)!=="owner")throw new Error("Owner recovery authorization required");
   const ops=new PrivateRecoveryOperations(this.ctx.storage),old=ops.get(id);
   if (old?.cacheState) throw new Error("Recovery cache is retired");
   if(tree===null&&old?.journalId==="baseline"&&old.commit===commit&&old.ownerId===ownerId)tree=old.tree;
   const state=this.load(),target=(await this.privateRecoveryTargets()).find(item=>item.commit===commit&&item.tree===tree);
   if(!target)throw new Error("Recovery requires an accepted journal or durable baseline target");
   if(accountKey!==await accountKeyFor(ownerId))throw new Error("Recovery account scope mismatch");
   if(this.repositoryDeleting()||await this.roleOf(ownerId)!=="owner")throw new Error("Recovery authorization changed");
   const proposed: PrivateRecoveryOperation = {id,projectId:state.projectId,incarnation:ops.incarnation(),commit,tree,journalId:target.journalId,canonicalRepoName:state.canonicalRepoName,ownerId,accountKey,status:"pending",dispatchState:"not-started",uploadState:"not-started",createdAt:new Date().toISOString()};
   return this.ctx.storage.transactionSync(() => {
     const currentState = this.load(), legacy = this.legacyRecoveryTarget();
     const currentRole = this.ctx.storage.sql.exec<{role: string}>("SELECT role FROM members WHERE user_id=?", ownerId).toArray()[0]?.role;
     const captureLegacy = !currentState.acceptedBaseline && target.journalId === "baseline";
     if (captureLegacy) {
       if (!legacy || tree !== null || legacy.commit !== commit || legacy.acceptedAt !== target.acceptedAt || currentRole !== "owner" || proposed.projectId !== currentState.projectId || proposed.canonicalRepoName !== currentState.canonicalRepoName || proposed.incarnation !== ops.incarnation()) throw new Error("Legacy accepted baseline changed");
     } else if (!this.privateRecoveryScopeCurrent(proposed)) throw new Error("Recovery authorization changed");
     if (!old && ops.all().some(operation => !operation.cacheState && operation.incarnation === proposed.incarnation && operation.canonicalRepoName === proposed.canonicalRepoName && operation.commit === proposed.commit && (operation.status === "pending" || operation.status === "ready"))) throw new Error("This accepted commit already has an active recovery snapshot");
     const operation = ops.create(proposed);
     if (captureLegacy) {
       const previous = currentState.acceptedBaseline;
       try { currentState.acceptedBaseline = { commit: legacy!.commit, acceptedAt: legacy!.acceptedAt }; this.save(); }
       catch (error) { currentState.acceptedBaseline = previous; throw error; }
     }
     return operation;
   });
  }
  async privateRecoveryMarkDispatch(id: string, dispatchState: "uncertain" | "started", expectedScope: string): Promise<void> {
    const op = await this.privateRecoveryOperation(id);
    if (!op || recoveryScopeId(op) !== expectedScope || !await this.privateRecoveryAuthorize(id, op.ownerId)) throw new Error("Recovery authorization changed");
    const current = new PrivateRecoveryOperations(this.ctx.storage).get(id);
    if (!current || recoveryScopeId(current) !== expectedScope || !this.privateRecoveryScopeCurrent(current)) throw new Error("Recovery authorization changed");
    new PrivateRecoveryOperations(this.ctx.storage).markDispatch(id, dispatchState);
  }
  async privateRecoveryAuthorize(id:string,ownerId:string):Promise<boolean>{
   const ops=new PrivateRecoveryOperations(this.ctx.storage),op=ops.get(id);
   if(!op||op.cacheState||op.ownerId!==ownerId||this.repositoryDeleting()||await this.roleOf(ownerId)!=="owner"||op.incarnation!==ops.incarnation()||op.canonicalRepoName!==this.load().canonicalRepoName)return false;
   const target=(await this.privateRecoveryTargets()).find(item=>item.journalId===op.journalId);return target?.commit===op.commit&&target.tree===op.tree;
  }
  private privateRecoveryScopeCurrent(op:PrivateRecoveryOperation):boolean {
    const state=this.load(),ops=new PrivateRecoveryOperations(this.ctx.storage);
    const role=this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",op.ownerId).toArray()[0]?.role;
    if(op.cacheState||this.repositoryDeleting()||role!=="owner"||op.incarnation!==ops.incarnation()||op.projectId!==state.projectId||op.canonicalRepoName!==state.canonicalRepoName)return false;
    if(op.journalId==="baseline")return state.acceptedBaseline?.commit===op.commit&&(state.acceptedBaseline.tree??null)===op.tree;
    const journal=state.journal.find(item=>item.id===op.journalId&&item.state==="ACCEPTED"&&item.newHead===op.commit&&item.candidateTree===op.tree);
    return !!journal&&state.acceptedState.history.some(item=>item.commit===journal.newHead&&item.candidateId===journal.candidateId);
  }
  async privateRecoveryRecordTree(id:string,tree:string,expectedScope:string):Promise<PrivateRecoveryOperation>{
    const ops=new PrivateRecoveryOperations(this.ctx.storage),op=ops.get(id);
    if(!op||recoveryScopeId(op)!==expectedScope||!isSafeSha(tree)||!await this.privateRecoveryAuthorize(id,op.ownerId))throw new Error("Recovery authorization changed");
    return this.ctx.storage.transactionSync(()=>{
      const current=ops.get(id);
      if(!current||recoveryScopeId(current)!==expectedScope||!this.privateRecoveryScopeCurrent(current)||current.status!=="pending")throw new Error("Recovery authorization changed");
      const state=this.load(),baseline=state.acceptedBaseline;
      if(op.journalId!=="baseline"||!baseline||baseline.commit!==op.commit||(baseline.tree&&baseline.tree!==tree))throw new Error("Accepted baseline scope changed");
      const updated=ops.recordTree(id,tree);baseline.tree=tree;this.save();return updated;
    });
  }
  async privateRecoveryReadable(id:string):Promise<boolean>{
   const ops=new PrivateRecoveryOperations(this.ctx.storage),op=ops.get(id);
   if(!op||op.cacheState||op.status!=="ready"||!op.receipt||this.repositoryDeleting()||op.incarnation!==ops.incarnation()||op.canonicalRepoName!==this.load().canonicalRepoName)return false;
   const target=(await this.privateRecoveryTargets()).find(item=>item.journalId===op.journalId);return target?.commit===op.commit&&target.tree===op.tree;
  }
  async privateRecoveryComplete(id:string,receipt:PrivateRecoveryReceipt):Promise<void>{
    const op=await this.privateRecoveryOperation(id);if(!op||!await this.privateRecoveryAuthorize(id,op.ownerId))throw new Error("Recovery authorization changed");
    this.ctx.storage.transactionSync(()=>{const ops=new PrivateRecoveryOperations(this.ctx.storage),current=ops.get(id);if(!current||recoveryScopeId(current)!==recoveryScopeId(op)||!this.privateRecoveryScopeCurrent(current))throw new Error("Recovery authorization changed");ops.complete(id,receipt);});
  }
  async privateRecoveryFail(id:string,_message:string,expectedScope:string):Promise<void>{const ops=new PrivateRecoveryOperations(this.ctx.storage),operation=ops.get(id);if(operation&&recoveryScopeId(operation)===expectedScope)ops.fail(id);}


  async acceptedDeploymentTarget(journalId:string):Promise<{canonicalRepoName:string;target:AcceptedDeploymentTarget}|null>{
    const state=this.load(),journal=state.journal.find(item=>item.id===journalId&&item.state==="ACCEPTED");
    if(!journal?.candidateTree)return null;
    const accepted=state.acceptedState.history.find(item=>item.commit===journal.newHead&&item.candidateId===journal.candidateId);
    if(!accepted)return null;
    return {canonicalRepoName:state.canonicalRepoName,target:{journalId,candidateId:journal.candidateId,commit:journal.newHead,tree:journal.candidateTree,acceptedAt:accepted.acceptedAt,recoverableRef:`refs/flaregit/deployments/${journalId}`}};
  }
  private legacyRecoveryTarget(): PrivateRecoveryTarget | null {
    const state = this.load();
    if (state.acceptedBaseline || state.journal.some(entry => entry.state === "ACCEPTED") || !/^[a-f0-9]{40}$/.test(state.acceptedState.currentCommit) || typeof state.canonicalRepoName !== "string" || !state.canonicalRepoName || !Number.isFinite(Date.parse(state.acceptedState.acceptedAt))) return null;
    const history = state.acceptedState.history;
    if (!Array.isArray(history) || (history.length && history.at(-1)?.commit !== state.acceptedState.currentCommit)) return null;
    return { journalId: "baseline", commit: state.acceptedState.currentCommit, tree: null, acceptedAt: state.acceptedState.acceptedAt };
  }

  private publicGitSharingTarget(ownerId: string): PublicGitConsentScope | null {
    if (this.repositoryDeleting() || this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",ownerId).toArray()[0]?.role !== "owner") return null;
    this.visibilityTable();
    const visibility = this.ctx.storage.sql.exec<{visibility:string;version:number;confirmed_by:string}>("SELECT visibility,version,confirmed_by FROM repository_visibility WHERE id=1").toArray()[0];
    const state = this.load();
    if (visibility?.visibility !== "public" || !visibility.confirmed_by || new PublicationModeration(this.ctx.storage).state("repository",state.projectId).suppressed) return null;
    const operations = new PrivateRecoveryOperations(this.ctx.storage);
    const op = operations.all().find(item => item.ownerId === ownerId && item.commit === state.acceptedState.currentCommit && item.status === "ready" && !!item.receipt && this.privateRecoveryScopeCurrent(item));
    if (!op?.receipt || !op.tree || op.receipt.projectId !== state.projectId || op.receipt.incarnation !== operations.incarnation() || op.receipt.commit !== op.commit || op.receipt.tree !== op.tree || op.receipt.journalId !== op.journalId || op.receipt.objectScope !== "exact-accepted-reachable-closure") return null;
    return {incarnation:operations.incarnation(),commit:op.commit,tree:op.tree,publicationVersion:visibility.version};
  }
  async publicGitSharingState(ownerId: string): Promise<{publication:PublicGitPublication|null;target:PublicGitConsentScope|null}> {
    if (await this.roleOf(ownerId) !== "owner") throw new Error("Only the owner can inspect Git sharing consent");
    return {publication:new PublicGitPublicationLedger(this.ctx.storage).state(),target:this.publicGitSharingTarget(ownerId)};
  }
  async decidePublicGitSharing(ownerId: string, value: unknown): Promise<PublicGitPublication|null> {
    const parsed = z.object({enabled:z.boolean(),consent:z.unknown().optional(),mutation:z.unknown()}).strict().parse(value);
    return this.ctx.storage.transactionSync(() => {
      if (this.repositoryDeleting() || this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",ownerId).toArray()[0]?.role !== "owner") throw new Error("Owner Git sharing authorization changed");
      const ledger = new PublicGitPublicationLedger(this.ctx.storage);
      const current = this.publicGitSharingTarget(ownerId);
      if (parsed.enabled && !current) throw new Error("Prepare the current accepted private recovery snapshot before confirming Git sharing");
      const scope = current ?? ledger.state();
      if (!scope) return null;
      return ledger.decide({enabled:parsed.enabled,consent:parsed.consent,mutation:parsed.mutation},current ?? scope,ownerId);
    });
  }

  async privateRecoveryTargets():Promise<PrivateRecoveryTarget[]>{
    const state=this.load(),records=await Promise.all(state.journal.filter(entry=>entry.state==="ACCEPTED").map(entry=>this.acceptedDeploymentTarget(entry.id))),targets:PrivateRecoveryTarget[]=records.filter((entry):entry is NonNullable<typeof entry>=>entry!==null).map(({target})=>({journalId:target.journalId,commit:target.commit,tree:target.tree,acceptedAt:target.acceptedAt})),baseline=state.acceptedBaseline;
    if(baseline&&isSafeSha(baseline.commit)&&(!baseline.tree||isSafeSha(baseline.tree)))targets.unshift({journalId:"baseline",commit:baseline.commit,tree:baseline.tree??null,acceptedAt:baseline.acceptedAt});
    else { const legacy = this.legacyRecoveryTarget(); if (legacy) targets.unshift(legacy); }
    return targets;
  }
  async listDeployments():Promise<DeploymentRecord[]>{return new RepositoryDeployments(this.ctx.storage,this.load().projectId).list();}
  async acceptedDeploymentTargets():Promise<AcceptedDeploymentTarget[]>{
    const targets=await Promise.all(this.load().journal.filter(entry=>entry.state==="ACCEPTED").slice(-100).map(entry=>this.acceptedDeploymentTarget(entry.id)));
    return targets.filter((entry):entry is NonNullable<typeof entry>=>entry!==null).map(entry=>entry.target);
  }
  async requestDeployment(target:AcceptedDeploymentTarget,serviceId:string,environment:string,key:string,actorId:string){
    if(await this.roleOf(actorId)!=="owner")throw new Error("Only the owner can request a deployment");
    const accepted=await this.acceptedDeploymentTarget(target.journalId);
    if(!accepted||JSON.stringify(accepted.target)!==JSON.stringify(target))throw new Error("Deployment target must match an accepted publication journal");
    const service=this.connections().signingConfig(serviceId);
    if(!service?.capabilities.includes("report-deployment"))throw new Error("Deployment reporting service unavailable");
    if(!(await this.listWebhooks()).some(hook=>hook.active&&hook.events.split(",").includes("deployment.requested")))throw new Error("Configure an active deployment.requested webhook before requesting delivery");
    await this.ensureRecoveryAlarm();
    let deliveryIds:string[]=[];
    const result=new RepositoryDeployments(this.ctx.storage,this.load().projectId).request(target,serviceId,environment,key,actorId,event=>{deliveryIds=this.stageEvent(event.type,event.data,{id:event.id,createdAt:event.createdAt});});
    await Promise.allSettled(deliveryIds.map(deliveryId=>this.env.INTEGRATION_QUEUE.send({type:"webhook.deliver",projectId:this.load().projectId,deliveryId})));
    return result;
  }

  private discussions(publicOnly:boolean){return new RepositoryDiscussions(this.ctx.storage,publicOnly);}
  private discussionEnabled(publicOnly:boolean):boolean {
    if(this.repositoryDeleting())return false;
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS repository_discussion_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL)");
    const published=this.community().policy();
    if(publicOnly){this.requirePublicRepository();return published.enabled&&published.scopes.includes("discussions");}
    return this.ctx.storage.sql.exec<{enabled:number}>("SELECT enabled FROM repository_discussion_settings WHERE id=1").toArray()[0]?.enabled===1;
  }
  private async assertDiscussionAccess(publicOnly:boolean,actor?:PublicCommunityActor){
    if(!publicOnly&&(!actor||!await this.roleOf(actor.userId)))throw new Error("Repository membership required");
    if(!this.discussionEnabled(publicOnly))throw new Error("Repository discussions are disabled");
  }
  async discussionSettings(actor:PublicCommunityActor,input?:unknown){
    if(this.repositoryDeleting())throw new Error("Repository deletion is in progress");
    const role=await this.roleOf(actor.userId);if(!role||input!==undefined&&role!=="owner")throw new Error("Repository membership required; only owner can configure discussions");
    this.discussionEnabled(false);
    if(input!==undefined){if(this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",actor.userId).toArray()[0]?.role!=="owner")throw new Error("Owner access changed");if(typeof input!=="object"||input===null||Array.isArray(input))throw new Error("Invalid discussion settings");const value=input as Record<string,unknown>;if(Object.keys(value).some(k=>!["enabled","confirmed"].includes(k))||typeof value.enabled!=="boolean"||value.enabled&&value.confirmed!==true)throw new Error("Explicit owner confirmation required");this.ctx.storage.sql.exec("INSERT INTO repository_discussion_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled",value.enabled?1:0);}
    return {enabled:this.ctx.storage.sql.exec<{enabled:number}>("SELECT enabled FROM repository_discussion_settings WHERE id=1").toArray()[0]?.enabled===1};
  }
  async discussionList(publicOnly:boolean,actor?:PublicCommunityActor){await this.assertDiscussionAccess(publicOnly,actor);return this.discussions(publicOnly).list();}
  async publicDiscussionActivity(query:string,ids?:string[]){await this.assertDiscussionAccess(true);return this.discussions(true).activity(query,ids);}
  async publicDiscussionActivitySnapshot(ids:string[]){
    // All visibility, policy, moderation, listing and selected-content reads are
    // synchronous within one DO invocation: no revocation window between RPCs.
    const grant=this.publicGrantSnapshot();
    const directory=new PublicDirectory(this.ctx.storage).state();
    const topics=grant&&directory.enabled&&this.discussionEnabled(true)?this.discussions(true).activity("",ids):[];
    return {directory,grant,topics};
  }
  async discussionTopic(id:string,publicOnly:boolean,actor?:PublicCommunityActor){await this.assertDiscussionAccess(publicOnly,actor);return this.discussions(publicOnly).topic(id);}
  async discussionPermissions(actor:PublicCommunityActor,id:string,publicOnly:boolean,canAdminister=false){const owner=canAdminister&&await this.roleOf(actor.userId)==="owner";await this.assertDiscussionAccess(publicOnly,actor);return this.discussions(publicOnly).permissions(actor,id,owner);}
  async discussionMutate(actor:PublicCommunityActor,operation:"create"|"reply"|"edit"|"remove"|"control",input:unknown,id:string|undefined,publicOnly:boolean,canAdminister=false){
    await this.assertDiscussionAccess(publicOnly,actor);
    return this.ctx.storage.transactionSync(()=>{
      const role=this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",actor.userId).toArray()[0]?.role;const owner=canAdminister&&role==="owner";if(!publicOnly&&!role)throw new Error("Repository membership changed");
      if(!this.discussionEnabled(publicOnly))throw new Error("Discussion access changed");const ledger=this.discussions(publicOnly);
      if(operation==="create"){if(typeof input==="object"&&input!==null&&"category" in input&&input.category==="announcements"&&!owner)throw new Error("Announcements require maintainer");return ledger.create(actor,input);}
      if(!id)throw new Error("Discussion id required");
      if(operation==="reply")return ledger.create(actor,input,id);
      if(operation==="edit")return ledger.edit(actor,id,input);
      if(operation==="remove")return ledger.remove(actor,id,input,owner);
      return ledger.control(actor,id,input,owner);
    });
  }
  private community() { return new RepositoryPublicCommunity(this.ctx.storage, this.load().projectId); }
  private requirePublicRepository(): void {
    this.visibilityTable();
    const row = this.ctx.storage.sql.exec<{ visibility: string }>("SELECT visibility FROM repository_visibility WHERE id=1").toArray()[0];
    if (row?.visibility !== "public" || new PublicationModeration(this.ctx.storage).state("repository",this.load().projectId).suppressed) throw new Error("Repository is not public");
  }
  async publicCommunity(publicOnly?: boolean): Promise<{ policy: PublicCommunityPolicy; posts: PublicPost[] }> {
    if (publicOnly) this.requirePublicRepository();
    const community = this.community();
    return { policy: community.policy(), posts: community.listPublic() };
  }
  async configurePublicCommunity(policy: PublicCommunityPolicy, confirmed: boolean, actor: PublicCommunityActor): Promise<PublicCommunityPolicy> {
    if (await this.roleOf(actor.userId) !== "owner") throw new Error("Only the owner can configure public participation");
    if (policy.enabled) this.requirePublicRepository();
    this.visibilityTable();
    return this.ctx.storage.transactionSync(() => {
      const configured = this.community().configure(policy, confirmed, actor, actor.userId);
      this.ctx.storage.sql.exec("UPDATE repository_visibility SET version=version+1 WHERE id=1");
      return configured;
    });
  }
  async createPublicPost(actor: PublicCommunityActor, input: Parameters<RepositoryPublicCommunity["createPost"]>[1]): Promise<PublicPost> {
    this.requirePublicRepository();
    return this.community().createPost(actor, input);
  }
  async signedPublicPosts(actor: PublicCommunityActor) {
    const owner = await this.roleOf(actor.userId) === "owner";
    this.requirePublicRepository();
    const posts = this.community().listPublic();
    const authors = new Map(this.ctx.storage.sql.exec<{ id: string; author_id: string }>("SELECT id,author_id FROM public_community_posts WHERE removed=0").toArray().map((row) => [row.id, row.author_id]));
    return { posts: posts.map((post) => ({ ...post, canEdit: owner || authors.get(post.id) === actor.userId, canRemove: owner || authors.get(post.id) === actor.userId })), authorDisplayName: actorName(actor) };
  }
  async editPublicPost(actor: PublicCommunityActor, postId: string, input: { title: string; body: string; expectedVersion: number }): Promise<PublicPost> {
    const ownerId = await this.roleOf(actor.userId) === "owner" ? actor.userId : "";
    this.requirePublicRepository();
    return this.community().editPost(actor, postId, input, ownerId);
  }
  async removePublicPost(actor: PublicCommunityActor, postId: string, expectedVersion: number): Promise<void> {
    const ownerId = await this.roleOf(actor.userId) === "owner" ? actor.userId : "";
    this.requirePublicRepository();
    this.community().removePost(actor, postId, ownerId, expectedVersion);
  }
  async requestPublicContribution(actor: PublicCommunityActor, input: Parameters<RepositoryPublicCommunity["requestContribution"]>[1]): Promise<ContributionRequest> {
    this.requirePublicRepository();
    return this.community().requestContribution(actor, input);
  }
  async publicContributionRequests(actor: PublicCommunityActor): Promise<ContributionRequest[]> {
    this.requirePublicRepository();
    const ownerId = await this.roleOf(actor.userId) === "owner" ? actor.userId : "";
    this.requirePublicRepository();
    return this.community().requestsFor(actor, ownerId).map((request)=>this.contributionRegistration(request));
  }
  private registrationTable(): void {this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS member_registrations(request_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,account_key TEXT NOT NULL,status TEXT NOT NULL)");}
  private contributionRegistration(request:ContributionRequest):ContributionRequest {
    this.registrationTable();
    const row=this.ctx.storage.sql.exec<{status:"pending"|"registered"|"revoked"}>("SELECT status FROM member_registrations WHERE request_id=?",request.id).toArray()[0];
    return row?{...request,registrationStatus:row.status}:request;
  }
  async decidePublicContribution(actor: PublicCommunityActor, requestId: string, decision: "approved" | "rejected", confirmedPrivateAccess: boolean): Promise<ContributionRequest> {
    await this.ensureRecoveryAlarm();
    if (await this.roleOf(actor.userId) !== "owner") throw new Error("Only the owner can decide contribution access");
    this.requirePublicRepository();
    this.registrationTable();
    const decided=this.ctx.storage.transactionSync(() => {
      const community = this.community();
      const previous = community.requestsFor(actor, actor.userId).find((request) => request.id === requestId);
      const request = community.decideRequest(actor, requestId, decision, confirmedPrivateAccess, actor.userId);
      const existingMember=this.ctx.storage.sql.exec("SELECT user_id FROM members WHERE user_id=?",request.requesterUserId).toArray().length>0;
      // Reconcile legacy approved members that predate the outbox, but never use
      // approval replay to restore a removed member.
      if ((previous?.status === "requested"||existingMember) && request.status === "approved") this.ctx.storage.sql.exec("INSERT OR IGNORE INTO member_registrations VALUES(?,?,?,'pending')",request.id,request.requesterUserId,request.requesterAccountKey);
      return request;
    });
    await this.reconcileContributorRegistrations();
    return this.contributionRegistration(decided);
  }
  async reconcileContributorRegistrations():Promise<void> {
    this.registrationTable();
    const rows=this.ctx.storage.sql.exec<{request_id:string;user_id:string;account_key:string}>("SELECT request_id,user_id,account_key FROM member_registrations WHERE status='pending'").toArray();
    for(const row of rows) {
      try {
        const state=this.load();
        const account=accountOf(this.env,row.account_key);
        if(await account.accountLifecycle()!=="active") {await this.cancelContributorRegistration(row.user_id);continue;}
        const role=await this.roleOf(row.user_id);
        await account.addProject({id:state.projectId,name:state.projectName,role:role==="owner"?"owner":"member",kind:state.kind??"demo"});
        this.requirePublicRepository();
        this.ctx.storage.transactionSync(()=>{
          const current=this.ctx.storage.sql.exec<{status:string}>("SELECT status FROM member_registrations WHERE request_id=?",row.request_id).toArray()[0];
          if(current?.status!=="pending")return;
          const request=this.community().requestsFor({userId:row.user_id,accountKey:row.account_key,displayName:"Contributor"},"").find(item=>item.id===row.request_id);
          if(!request||request.status!=="approved")throw new Error("Registration intent is stale");
          this.ctx.storage.sql.exec("INSERT OR IGNORE INTO members (user_id,role,label,added_at) VALUES (?,'member',?,?)",row.user_id,request.requesterName,new Date().toISOString());
          this.ctx.storage.sql.exec("UPDATE member_registrations SET status='registered' WHERE request_id=?",row.request_id);
        });
      } catch { /* Durable pending intent is retried by the alarm; no access is silently granted. */ }
    }
    if(this.ctx.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM member_registrations WHERE status='pending'").toArray()[0]!.n)await this.ensureRecoveryAlarm();
  }
  async cancelContributorRegistration(userId:string):Promise<void> {
    if(await this.roleOf(userId)==="owner")throw new Error("The owner cannot be removed");
    this.registrationTable();
    this.ctx.storage.transactionSync(()=>{this.ctx.storage.sql.exec("UPDATE member_registrations SET status='revoked' WHERE user_id=?",userId);this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id=?",userId);});
  }
  private accountLifecycleState():"active"|"deleting"|"deleted" {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS account_lifecycle(id INTEGER PRIMARY KEY,status TEXT NOT NULL)");
    return this.ctx.storage.sql.exec<{status:"deleting"|"deleted"}>("SELECT status FROM account_lifecycle WHERE id=1").toArray()[0]?.status??"active";
  }
  async accountLifecycle():Promise<"active"|"deleting"|"deleted"> {return this.accountLifecycleState();}
  async beginAccountDeletion():Promise<void> {
    if(this.accountLifecycleState()==="deleted")throw new Error("Account is deleted");
    this.ctx.storage.sql.exec("INSERT INTO account_lifecycle VALUES(1,'deleting') ON CONFLICT(id) DO UPDATE SET status='deleting'");
  }
  async finishAccountDeletion():Promise<void> {
    if(this.accountLifecycleState()!=="deleting")throw new Error("Account deletion was not started");
    const tables=this.ctx.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='account_lifecycle'").toArray();
    this.ctx.storage.transactionSync(()=>{for(const table of tables)this.ctx.storage.sql.exec(`DELETE FROM "${table.name.replaceAll('"','""')}"`);this.ctx.storage.sql.exec("UPDATE account_lifecycle SET status='deleted' WHERE id=1");});
    this.state=null;
  }
  async accountArtifactDeleted(name:string):Promise<boolean> {this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS account_artifact_deletions(name TEXT PRIMARY KEY)");return this.ctx.storage.sql.exec("SELECT name FROM account_artifact_deletions WHERE name=?",name).toArray().length>0;}
  async recordAccountArtifactDeleted(name:string):Promise<void> {this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS account_artifact_deletions(name TEXT PRIMARY KEY)");this.ctx.storage.sql.exec("INSERT OR IGNORE INTO account_artifact_deletions VALUES(?)",name);}

  private agentRuns() { return new AgentRunLedger(this.ctx.storage); }
  private agentScope(task: Task, projectScope: string[]): string[] {
    const scope = [...new Set((task.allowedScope ?? projectScope).flatMap((requested) => projectScope.flatMap((allowed) => requested === "*" ? [allowed] : allowed === "*" ? [requested] : requested.startsWith(allowed) ? [requested] : allowed.startsWith(requested) ? [allowed] : [])))];
    if (!scope.length) throw new Error("Change has no permitted agent scope");
    return scope;
  }
  async getAgentRun(runId: string): Promise<AgentRunRecord | null> { return this.agentRuns().get(runId); }
  async claimAgentRun(input: AgentRunInput): Promise<AgentRunClaim> {
    const state = this.load();
    const task = state.tasks[input.taskId];
    if (!task || ["accepted", "cancelled", "integrating", "verifying"].includes(task.status) || input.branch !== task.workspace.branch) throw new Error("Change cannot start this agent run");
    const settings = settingsFor(state.verificationPolicy);
    try {
      return this.ctx.storage.transactionSync(() => {
        const result = this.agentRuns().claim({ ...input, goal: task.goal, allowedScope: this.agentScope(task, settings.allowedScope), protectedPaths: settings.protectedPaths });
        if (result.kind === "claimed") {
          task.agentRunId = result.run.runId;
          task.status = "working";
          this.save();
        }
        return result;
      });
    } catch (error) { this.state = null; throw error; }
  }
  async resumeAgentRun(runId: string, taskId: string, previousRunId: string): Promise<AgentRunClaim> {
    const state = this.load();
    const task = state.tasks[taskId];
    if (!task || task.agentRunId !== previousRunId || ["accepted", "cancelled", "integrating", "verifying"].includes(task.status)) throw new Error("Saved agent work is no longer selected for this change");
    const settings = settingsFor(state.verificationPolicy);
    try {
      return this.ctx.storage.transactionSync(() => {
        const result = this.agentRuns().resume(runId, taskId, previousRunId, this.agentScope(task, settings.allowedScope), settings.protectedPaths, task.goal);
        if (result.kind === "claimed") { task.agentRunId = result.run.runId; task.status = "working"; this.save(); }
        return result;
      });
    } catch (error) { this.state = null; throw error; }
  }
  async saveAgentProposal(runId: string, taskId: string, files: Record<string, string>): Promise<boolean> { return this.agentRuns().propose(runId, taskId, files); }
  async markAgentPushed(runId: string, taskId: string, commit: string): Promise<boolean> { return this.agentRuns().markPushed(runId, taskId, commit); }
  async checkpointAgentRun(runId: string, taskId: string, eventId: string, commit: string): Promise<boolean> {
    const task = this.load().tasks[taskId];
    if (!task || task.agentRunId !== runId || task.currentCommit !== commit || !["ready", "integrating", "verifying", "accepted"].includes(task.status)) return false;
    return this.agentRuns().checkpoint(runId, taskId, eventId, commit);
  }
  async failAgentRun(runId: string, taskId: string): Promise<boolean> {
    const state = this.load();
    try {
      return this.ctx.storage.transactionSync(() => {
        const failed = this.agentRuns().fail(runId, taskId);
        const task = state.tasks[taskId];
        if (failed && task && (task.agentRunId === runId || task.agentWorkflowInstanceId === runId) && !["accepted", "cancelled", "integrating", "verifying", "ready"].includes(task.status)) {
          task.status = "blocked";
          task.blockedReason = "Agent run failed. Saved context, proposed files and pushed checkpoints remain recoverable.";
          task.updatedAt = new Date().toISOString();
          this.save();
        }
        return failed;
      });
    } catch (error) { this.state = null; throw error; }
  }

  async directoryState(): Promise<DirectoryState> { return new PublicDirectory(this.ctx.storage).state(); }
  async registerDirectory(input: DirectoryRegistration): Promise<void> { new PublicDirectory(this.ctx.storage).register(input); }
  async directoryPage(cursor?: string): Promise<{rows:DirectoryRegistration[];nextCursor:string|null}> { return new PublicDirectory(this.ctx.storage).page(cursor); }
  async configureDirectory(input: unknown, actor: string): Promise<DirectoryState> {
    if (await this.roleOf(actor) !== "owner") throw new Error("Only the owner can publish directory listings");
    await this.ensureRecoveryAlarm();
    if (this.repositoryDeleting()) throw new Error("Repository deletion is in progress");
    this.visibilityTable();
    const directory = new PublicDirectory(this.ctx.storage);
    const visibility = this.ctx.storage.sql.exec<{visibility:string}>("SELECT visibility FROM repository_visibility WHERE id=1").toArray()[0];
    directory.configure(input, visibility?.visibility === "public" && !new PublicationModeration(this.ctx.storage).state("repository",this.load().projectId).suppressed);
    await this.reconcileDirectoryRegistration();
    return directory.state();
  }
  private async reconcileDirectoryRegistration(): Promise<void> {
    const directory = new PublicDirectory(this.ctx.storage);
    if (!this.ctx.storage.sql.exec("SELECT 1 FROM project WHERE id=1").toArray()[0]) return;
    const pending = directory.pending(this.load().projectId);
    if (!pending) return;
    try { await globalOf(this.env).registerDirectory(pending); directory.delivered(pending.version); }
    catch { await this.ensureRecoveryAlarm(); }
  }

  private visibilityTable(): void { this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS repository_visibility (id INTEGER PRIMARY KEY CHECK(id=1), visibility TEXT NOT NULL, version INTEGER NOT NULL, confirmed_by TEXT NOT NULL)"); }
  async repositoryVisibility(): Promise<"public" | "private"> {
    this.visibilityTable();
    const row = this.ctx.storage.sql.exec<{ visibility: string }>("SELECT visibility FROM repository_visibility WHERE id=1").toArray()[0];
    return row?.visibility === "public" ? "public" : "private";
  }
  async publicGrant(): Promise<PublicGrantMetadata | null> {
    return this.publicGrantSnapshot();
  }
  private publicGrantSnapshot(): PublicGrantMetadata | null {
    if (this.repositoryDeleting()) return null;
    this.visibilityTable();
    const row = this.ctx.storage.sql.exec<{ visibility: string; version: number; confirmed_by: string }>("SELECT visibility,version,confirmed_by FROM repository_visibility WHERE id=1").toArray()[0];
    if (row?.visibility !== "public" || !row.confirmed_by || new PublicationModeration(this.ctx.storage).state("repository",this.load().projectId).suppressed) return null;
    const state = this.load();
    return { visibility: "public", confirmedByOwner: true, acceptedCommit: state.acceptedState.currentCommit, name: state.projectName, canonicalRepoName: state.canonicalRepoName, version: row.version };
  }
  async publicContributionsFor(userId: string): Promise<{ grant: PublicGrantMetadata; contributions: Array<{ commit: string; acceptedAt: string }> } | null> {
    if (!userId) return null;
    const grant = await this.publicGrant();
    if (!grant || !this.ctx.storage.sql.exec<{ role: string }>("SELECT role FROM members WHERE user_id=?", userId).toArray()[0]) return null;
    this.gitTables();
    const state = this.load();
    const taskIds = new Set(this.ctx.storage.sql.exec<{ task_id: string }>("SELECT task_id FROM git_task_writers WHERE user_id=?", userId).toArray()
      .filter((row) => state.tasks[row.task_id]?.contributor.type === "human").map((row) => row.task_id));
    const contributions = state.acceptedState.history.slice(-100)
      .filter((record) => /^[a-f0-9]{40}$/.test(record.commit) && record.participatingTasks.some((taskId) => taskIds.has(taskId)))
      .map((record) => ({ commit: record.commit, acceptedAt: record.acceptedAt }));
    return { grant, contributions };
  }
  async setRepositoryVisibility(visibility: "public" | "private", confirmed: boolean, by: string): Promise<void> {
    if (this.repositoryDeleting()) throw new Error("Repository deletion is in progress");
    if (!by || !["public", "private"].includes(visibility) || (visibility === "public" && confirmed !== true)) throw new Error("Explicit owner confirmation is required");
    if (visibility === "public" && (await this.repositoryModerationState()).suppressed) throw new Error("Public repository publication is suppressed; see the owner moderation notice");
    if (await this.roleOf(by) !== "owner") throw new Error("Only the owner can change visibility");
    await this.ensureRecoveryAlarm();
    this.visibilityTable();
    const directory = new PublicDirectory(this.ctx.storage);
    if (visibility === "private") { const current = directory.state(); if (current.enabled) directory.configure({enabled:false,confirmed:true,expectedVersion:current.version},false); }
    if (visibility === "public" && new PublicationModeration(this.ctx.storage).state("repository",this.load().projectId).suppressed) throw new Error("Public repository publication is suppressed");
    this.ctx.storage.sql.exec("INSERT INTO repository_visibility VALUES (1,?,1,?) ON CONFLICT(id) DO UPDATE SET visibility=excluded.visibility,version=version+1,confirmed_by=excluded.confirmed_by", visibility, by);
    await this.reconcileDirectoryRegistration();
    await this.logActivity("Maintainer", "repository.visibility", `Repository is now ${visibility}`);
  }

  private importTable(): void { this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS import_jobs (id TEXT PRIMARY KEY, doc TEXT NOT NULL)"); }
  async getImportJob(id: string): Promise<ImportJob | null> {
    this.importTable();
    const row = this.ctx.storage.sql.exec<{ doc: string }>("SELECT doc FROM import_jobs WHERE id=?", id).toArray()[0];
    return row ? JSON.parse(row.doc) as ImportJob : null;
  }
  async listImportJobs(): Promise<ImportJob[]> {
    this.importTable();
    return this.ctx.storage.sql.exec<{ doc: string }>("SELECT doc FROM import_jobs ORDER BY id").toArray().map((row) => JSON.parse(row.doc) as ImportJob);
  }
  async saveImportJob(job: ImportJob): Promise<void> {
    this.importTable();
    this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql.exec<{ doc: string }>("SELECT doc FROM import_jobs WHERE id=?", job.id).toArray()[0];
      if (row) {
        const previous = JSON.parse(row.doc) as ImportJob;
        const immutable = ({ status: _status, updatedAt: _updated, detail: _detail, importedHead: _head, importedBranch: _branch, ...identity }: ImportJob) => identity;
        if (JSON.stringify(immutable(previous)) !== JSON.stringify(immutable(job))) throw new Error("Import job identity cannot change");
        if (previous.importedHead && (previous.importedHead !== job.importedHead || previous.importedBranch !== job.importedBranch)) throw new Error("Import snapshot cannot change");
        if (previous.status === "ready" && (!previous.importedHead || job.status !== "ready")) return;
      } else {
        const reserved = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM (SELECT id FROM projects UNION SELECT id FROM import_jobs WHERE json_extract(doc, '$.status') <> 'ready')").toArray()[0]!.count;
        if (reserved >= 10) throw new Error("Repository limit reached, including saved imports (10)");
        const jobs = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM import_jobs").toArray()[0]!.count;
        if (jobs >= 100) throw new Error("Import job history limit reached; contact support");
      }
      this.ctx.storage.sql.exec("INSERT INTO import_jobs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc", job.id, JSON.stringify(job));
    });
  }

  async claimImportHistoryOperation(input: Omit<ImportHistoryOperation, "createdAt">): Promise<ImportHistoryOperation> {
    if (input.protocolVersion!==undefined&&input.protocolVersion!==2)throw new Error("Invalid import inspection protocol");
    if (!/^[a-z0-9]{12,16}$/.test(input.projectId) || !/^[a-f0-9]{40}$/.test(input.head) || !/^import-history-[A-Za-z0-9_-]{1,90}$/.test(input.instanceId)) throw new Error("Invalid history operation");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS import_history_operations(instance TEXT PRIMARY KEY,scope TEXT UNIQUE,doc TEXT)");
    return this.ctx.storage.transactionSync(() => {
      const scope = `${input.projectId}:${input.head}:${input.ownerId}`;
      const previous = this.ctx.storage.sql.exec<{doc:string}>("SELECT doc FROM import_history_operations WHERE scope=?", scope).toArray()[0];
      if (previous) return JSON.parse(previous.doc) as ImportHistoryOperation;
      const count = this.ctx.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM import_history_operations").toArray()[0]!.n;
      if (count >= 1000) throw new Error("Import inspection operation limit reached");
      const operation = { ...input, createdAt: new Date().toISOString() };
      this.ctx.storage.sql.exec("INSERT INTO import_history_operations VALUES(?,?,?)", input.instanceId, scope, JSON.stringify(operation));
      return operation;
    });
  }
  async listImportHistoryOperations(): Promise<ImportHistoryOperation[]> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS import_history_operations(instance TEXT PRIMARY KEY,scope TEXT UNIQUE,doc TEXT)");
    return this.ctx.storage.sql.exec<{doc:string}>("SELECT doc FROM import_history_operations ORDER BY instance").toArray().map((row)=>JSON.parse(row.doc) as ImportHistoryOperation);
  }
  async getImportHistoryOperation(instanceId: string): Promise<ImportHistoryOperation | null> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS import_history_operations(instance TEXT PRIMARY KEY,scope TEXT UNIQUE,doc TEXT)");
    const row = this.ctx.storage.sql.exec<{doc:string}>("SELECT doc FROM import_history_operations WHERE instance=?", instanceId).toArray()[0];
    return row ? JSON.parse(row.doc) as ImportHistoryOperation : null;
  }

  /** Capability previews remain private artifacts of an existing, active owner.
   * Failures propagate so the broker distinguishes unavailable authority from revocation. */
  async previewAvailable(): Promise<boolean> {
    const projectExists = () => this.ctx.storage.sql.exec("SELECT 1 FROM project WHERE id=1").toArray().length > 0;
    const owners = () => this.ctx.storage.sql.exec<{user_id:string}>("SELECT user_id FROM members WHERE role='owner' ORDER BY user_id").toArray().map(row => row.user_id);
    if (this.repositoryDeleting() || !projectExists()) return false;
    const before = owners();
    if (!before.length) return false;
    const lifecycles = await Promise.all(before.map(async owner => accountOf(this.env, await accountKeyFor(owner)).accountLifecycle()));
    return lifecycles.every(lifecycle => lifecycle === "active") && !this.repositoryDeleting() && projectExists() && JSON.stringify(owners()) === JSON.stringify(before);
  }

  private connections() { return new RepositoryConnections(this.ctx.storage, this.load().projectId); }
  async externalCheckReports(candidateId: string) { return this.connections().reports(candidateId); }
  /** Connections inherit current repository owner authority, never retained data
   * from a deleting account or repository. Recheck membership after remote RPCs. */
  private async connectionAuthorityActive(): Promise<boolean> {
    if (this.repositoryDeleting()) return false;
    const owners = this.ctx.storage.sql.exec<{user_id: string}>("SELECT user_id FROM members WHERE role='owner' ORDER BY user_id").toArray().map(row => row.user_id);
    if (!owners.length) return false;
    try {
      const lifecycles = await Promise.all(owners.map(async owner => accountOf(this.env, await accountKeyFor(owner)).accountLifecycle()));
      if (lifecycles.some(lifecycle => lifecycle !== "active")) return false;
    } catch { return false; }
    const current = this.ctx.storage.sql.exec<{user_id: string}>("SELECT user_id FROM members WHERE role='owner' ORDER BY user_id").toArray().map(row => row.user_id);
    return !this.repositoryDeleting() && JSON.stringify(current) === JSON.stringify(owners);
  }
  async serviceCandidateSnapshot(serviceId: string, candidateId: string, commit: string, nonce: string) {
    if (!await this.connectionAuthorityActive()) return null;
    return this.connections().serviceCandidateSnapshot(serviceId, candidateId, commit, nonce);
  }
  async listConnections(): Promise<{ connections: ConnectionMetadata[]; policy: ExternalCheckPolicy }> { const ledger = this.connections(); return { connections: ledger.list(), policy: ledger.policy() }; }
  async createConnection(name: string, capabilities: IntegrationCapability[]) { const created = this.connections().create(name, capabilities); return { connection: created.metadata, secret: created.secret }; }
  async revokeConnection(id: string): Promise<void> { this.connections().revoke(id); }
  async connectionSigningConfig(id: string) {
    if (!await this.connectionAuthorityActive()) return null;
    return this.connections().signingConfig(id);
  }
  async setConnectionPolicy(policy: ExternalCheckPolicy): Promise<ExternalCheckPolicy> { const ledger = this.connections(); ledger.setPolicy(policy); return ledger.policy(); }
  async externalChecks(candidateId: string): Promise<ExternalCheckState | null> { return this.connections().candidateState(candidateId); }
  async registerExternalRun(candidateId: string, checkId: string, runId: string): Promise<ExternalCheckState> {
    const candidate = this.load().candidates[candidateId];
    if (candidate?.status !== "awaiting_review" || candidate.review) throw new Error("Checks can only be retried before the review decision");
    return this.connections().registerRun(candidateId, checkId, runId);
  }
  async acceptIntegrationCallback(callback: IntegrationCallback): Promise<CallbackReceipt> {
    if (this.repositoryDeleting()) return { kind: "rejected", reason: "Repository service authority unavailable" };
    return this.connections().accept(callback, () => this.connectionAuthorityActive());
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS project (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS billing (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (user_id TEXT PRIMARY KEY, role TEXT NOT NULL, label TEXT, added_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY, created_by TEXT NOT NULL, expires_at INTEGER NOT NULL, used_by TEXT);
      CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, type TEXT NOT NULL, summary TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, url TEXT NOT NULL, secret TEXT NOT NULL, events TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, seq INTEGER NOT NULL DEFAULT 0, queue_ms INTEGER, webhook_id TEXT NOT NULL, event TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_status INTEGER, last_error TEXT, latency_ms INTEGER, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, project_name TEXT NOT NULL, kind TEXT NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'unread');
      CREATE TABLE IF NOT EXISTS domains (domain TEXT NOT NULL, project_id TEXT NOT NULL, token TEXT NOT NULL, verified_at TEXT, PRIMARY KEY (domain, project_id));
      CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS handles (handle TEXT PRIMARY KEY, account_key TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS issues (number INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open', author TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_by TEXT);
      CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, path TEXT, line INTEGER, "commit" TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS comments_subject ON comments (subject, id);
      CREATE TABLE IF NOT EXISTS member_issue_receipts(actor_id TEXT NOT NULL,event_key TEXT NOT NULL,payload TEXT NOT NULL,issue_number INTEGER NOT NULL,PRIMARY KEY(actor_id,event_key));
      CREATE TABLE IF NOT EXISTS member_comment_receipts(actor_id TEXT NOT NULL,event_key TEXT NOT NULL,payload TEXT NOT NULL,comment_id INTEGER NOT NULL,PRIMARY KEY(actor_id,event_key));
      CREATE TABLE IF NOT EXISTS mirror (id INTEGER PRIMARY KEY CHECK (id = 1), target TEXT NOT NULL, token TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mirror_runs (id TEXT PRIMARY KEY, commit_sha TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, at TEXT NOT NULL, reporter TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, details TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', resolution TEXT, resolved_by TEXT, resolved_at TEXT);
      CREATE TABLE IF NOT EXISTS probes (id INTEGER PRIMARY KEY AUTOINCREMENT, component TEXT NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL, latency_ms INTEGER, detail TEXT);
      CREATE INDEX IF NOT EXISTS probes_component_at ON probes (component, at);
      CREATE TABLE IF NOT EXISTS workflow_runs (kind TEXT NOT NULL, instance_id TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, PRIMARY KEY (kind, instance_id));
      CREATE TABLE IF NOT EXISTS project_workflows (instance_id TEXT PRIMARY KEY, kind TEXT NOT NULL, actor_id TEXT);
      CREATE TABLE IF NOT EXISTS api_tokens (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL, last_used TEXT);
      CREATE TABLE IF NOT EXISTS runs (day TEXT PRIMARY KEY, n INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK (id = 1), holder TEXT NOT NULL, expires_at INTEGER NOT NULL);
    `);
    try{this.ctx.storage.sql.exec("ALTER TABLE project_workflows ADD COLUMN native_protocol INTEGER");}catch{/* Existing column. */}
    // Databases created before ordered delivery lack these columns.
    for (const col of ["seq INTEGER NOT NULL DEFAULT 0", "queue_ms INTEGER"]) {
      try { this.ctx.storage.sql.exec(`ALTER TABLE deliveries ADD COLUMN ${col}`); } catch { /* already present */ }
    }
    try { this.ctx.storage.sql.exec("ALTER TABLE project_workflows ADD COLUMN actor_id TEXT"); } catch { /* already present */ }
    for (const col of ["scope TEXT NOT NULL DEFAULT 'full'", "repo TEXT", "expires_at INTEGER"]) {
      try { this.ctx.storage.sql.exec(`ALTER TABLE api_tokens ADD COLUMN ${col}`); } catch { /* already present */ }
    }
  }

  private load(allowDeleting = false): FlareGitProjectState {
    if (!allowDeleting && this.repositoryDeleting()) throw new Error("Repository deletion is in progress");
    if (this.state) return this.state;
    const row = this.ctx.storage.sql.exec<{ doc: string }>("SELECT doc FROM project WHERE id = 1").toArray()[0];
    if (!row) throw new Error("Project not initialized: call initialize() with the seeded canonical head");
    this.state = JSON.parse(row.doc) as FlareGitProjectState;
    return this.state;
  }

  private save(): void {
    if (this.repositoryDeleting()) throw new Error("Repository deletion is in progress");
    this.ctx.storage.sql.exec("INSERT INTO project (id, doc) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc", JSON.stringify(this.state));
  }

  /** First-time setup with the real head of the canonical Artifacts repository. */
  async initialize(init: { projectId: string; projectName: string; canonicalRepoName: string; head: string; tree?: string; verificationPolicy: Record<string, unknown>; kind?: "demo" | "import" | "empty"; defaultBranch?: string; ownerId?: string; source?: string }): Promise<FlareGitProjectState> {
    if (this.repositoryDeleting()) throw new Error("Repository deletion has sealed this identity");
    const existing = this.ctx.storage.sql.exec("SELECT 1 FROM project WHERE id = 1").toArray();
    if (existing.length > 0) return this.load();
    this.state = {
      projectId: init.projectId,
      projectName: init.projectName,
      canonicalRepoName: init.canonicalRepoName,
      acceptedBaseline: { commit: init.head, tree: init.tree, acceptedAt: new Date().toISOString() },
      acceptedState: { currentCommit: init.head, acceptedAt: new Date().toISOString(), buildDigest: "seed", activeRequirements: [], history: [] },
      tasks: {},
      candidates: {},
      evidence: {},
      decisions: {},
      journal: [],
      policyVersion: 1,
      verificationPolicy: init.verificationPolicy,
      kind: init.kind,
      defaultBranch: init.defaultBranch ?? "main",
      ownerId: init.ownerId,
      source: init.source,
    };
    if (init.ownerId) await this.addMember(init.ownerId, "owner");
    await this.logActivity(init.ownerId ?? "system", "project.created", `Repository ${init.projectName} created`);
    this.ctx.storage.transactionSync(()=>{
      this.save();
      this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS preview_copy_tracking_era(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL)");
      this.ctx.storage.sql.exec("INSERT INTO preview_copy_tracking_era VALUES(1,1)");
    });
    return this.state;
  }

  async getState(): Promise<FlareGitProjectState> {
    return this.load(true);
  }

  /** Returns false if this event id was already processed (at-least-once delivery safe). */
  private firstDelivery(eventId: string): boolean {
    const res = this.ctx.storage.sql.exec("INSERT OR IGNORE INTO events (id, at) VALUES (?, ?)", eventId, new Date().toISOString());
    return res.rowsWritten > 0;
  }

  private async ensureRecoveryAlarm(delayMs = 2 * 60_000): Promise<void> {
    const deadline = Date.now() + delayMs;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > deadline) await this.ctx.storage.setAlarm(deadline);
  }

  private async requireTaskCreationActor(actorId:string):Promise<void>{
    if(!actorId||!await this.roleOf(actorId)||this.repositoryDeleting())throw new Error("Task creation access changed");
    const accountKey=await accountKeyFor(actorId);
    if(await accountOf(this.env,accountKey).accountLifecycle()!=="active")throw new Error("Task creation account is unavailable");
    const role=this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",actorId).toArray()[0]?.role;
    if(this.repositoryDeleting()||(role!=="owner"&&role!=="member"))throw new Error("Task creation access changed");
  }
  async taskCreationReplay(taskId:string,actorId:string,input:TaskCreationInput):Promise<Task|null>{
    await this.requireTaskCreationActor(actorId);
    const state=this.load(),task=state.tasks[taskId];if(!task)return null;
    if(!this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='task_creation_receipts'").toArray().length)throw new Error("Legacy task has no creation receipt");
    const receipt=this.ctx.storage.sql.exec<{actor_id:string;payload:string}>("SELECT actor_id,payload FROM task_creation_receipts WHERE task_id=?",taskId).toArray()[0];
    const writer=this.ctx.storage.sql.exec<{user_id:string}>("SELECT user_id FROM git_task_writers WHERE task_id=?",taskId).toArray()[0];
    if(!receipt||receipt.actor_id!==actorId||writer?.user_id!==actorId||receipt.payload!==taskCreationPayload(input))throw new Error("Task creation retry identity changed or is unavailable");
    return task;
  }
  async createTask(task: Task, actorId?: string,creationInput?:TaskCreationInput): Promise<Task & {creationReplayed?:boolean}> {
    const payload=creationInput?taskCreationPayload(creationInput):null;
    if(creationInput&&(!actorId||task.goal!==creationInput.goal||(task.dependsOn??null)!==creationInput.dependsOn||(task.issue??null)!==creationInput.issue))throw new Error("Task creation input or authority changed");
    if(creationInput)await this.requireTaskCreationActor(actorId!);
    const s = this.load();
    if (s.tasks[task.id]) {if(creationInput){const existing=await this.taskCreationReplay(task.id,actorId!,creationInput);if(!existing)throw new Error("Saved task changed during creation retry");return {...existing,creationReplayed:true};}return s.tasks[task.id]!;}
    const next={...s,tasks:{...s.tasks,[task.id]:task}};
    this.ctx.storage.transactionSync(() => {
      if(creationInput&&this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",actorId!).toArray()[0]?.role===undefined)throw new Error("Task creation access changed");
      if(actorId) { this.gitTables(); this.ctx.storage.sql.exec("INSERT INTO git_task_writers(task_id,user_id) VALUES (?,?)",task.id,actorId); }
      if(payload){this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS task_creation_receipts(task_id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL)");this.ctx.storage.sql.exec("INSERT INTO task_creation_receipts VALUES(?,?,?,?)",task.id,actorId!,payload,task.createdAt);}
      if(this.repositoryDeleting())throw new Error("Repository deletion is in progress");
      this.ctx.storage.sql.exec("INSERT INTO project (id, doc) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc",JSON.stringify(next));
    });
    this.state=next;
    await this.logActivity(task.contributor.name, "task.created", `Change started: ${task.goal}`);
    return creationInput?{...task,creationReplayed:false}:task;
  }

  async ingestCheckpoint(ev: { eventId: string; taskId: string; commit: string; ready: boolean; filesChanged?: string[] }): Promise<{ applied: boolean }> {
    await this.ensureRecoveryAlarm();
    return this.applyCheckpoint(ev);
  }
  private async applyCheckpoint(ev:{eventId:string;taskId:string;commit:string;ready:boolean;filesChanged?:string[]},fence?:()=>void):Promise<{applied:boolean}>{
    const s = this.load();
    const task = s.tasks[ev.taskId];
    if (!task || task.status === "cancelled" || task.status === "accepted") return { applied: false };
    let deliveries: string[] = [];
    let applied = false;
    try {
      this.ctx.storage.transactionSync(() => {
        fence?.();
        if (!this.firstDelivery(ev.eventId)) return;
        // A push that arrives while the task is being integrated is newer work; it applies after the landing.
        task.currentCommit = ev.commit;
        task.checkpoints.push({
          id: `chk_${crypto.randomUUID()}`,
          commitHash: ev.commit,
          author: task.contributor.name,
          message: ev.ready ? "Ready for integration" : "Work in progress",
          timestamp: new Date().toISOString(),
          isReadyForIntegration: ev.ready,
          filesChanged: ev.filesChanged ?? [],
        });
        if (task.status !== "integrating" && task.status !== "verifying") task.status = ev.ready ? "ready" : "checkpointed";
        task.updatedAt = new Date().toISOString();
        if (ev.ready) deliveries = this.stageEvent("change.ready", { change: task.id, commit: ev.commit, goal: task.goal });
        this.save();
        applied = true;
      });
    } catch (error) { this.state = null; throw error; }
    if (!applied) return { applied: false };
    for (const deliveryId of deliveries) await this.env.INTEGRATION_QUEUE.send({ type: "webhook.deliver", projectId: s.projectId, deliveryId }).catch(() => undefined);
    await this.logActivity(task.contributor.name, ev.ready ? "task.ready" : "task.pushed", `${task.id} ${ev.ready ? "is ready for integration" : "pushed a checkpoint"} (${ev.commit.slice(0, 7)})`, { exceptUser: task.contributor.id });
    return { applied: true };
  }

  // ---- account registry (used on the per-account instance) ----
  async listProjects(): Promise<ProjectRow[]> {
    return this.ctx.storage.sql.exec("SELECT id, name, role, kind, created_at FROM projects ORDER BY created_at DESC").toArray() as unknown as ProjectRow[];
  }
  async addProject(p: { id: string; name: string; role: "owner" | "member"; kind: string }): Promise<void> {
    if(this.accountLifecycleState()!=="active")throw new Error("Account is not active");
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO projects (id, name, role, kind, created_at) VALUES (?, ?, ?, ?, ?)", p.id, p.name, p.role, p.kind, new Date().toISOString());
  }
  async removeProject(id: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM projects WHERE id = ?", id);
  }

  // ---- membership and invites (per project) ----
  async roleOf(userId: string): Promise<"owner" | "member" | null> {
    const row = this.ctx.storage.sql.exec<{ role: string }>("SELECT role FROM members WHERE user_id = ?", userId).toArray()[0];
    return (row?.role as "owner" | "member" | undefined) ?? null;
  }
  async addMember(userId: string, role: "owner" | "member", label?: string): Promise<void> {
    if (this.repositoryDeleting()) throw new Error("Repository deletion is in progress");
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO members (user_id, role, label, added_at) VALUES (?, ?, ?, ?)", userId, role, label ?? null, new Date().toISOString());
  }
  async removeMember(userId: string): Promise<void> {
    const role = await this.roleOf(userId);
    if (role === "owner") throw new Error("The owner cannot be removed");
    await this.cancelContributorRegistration(userId);
  }
  async listMembers() {
    return this.ctx.storage.sql.exec<{ user_id: string; role: string; label: string | null; added_at: string }>("SELECT user_id, role, label, added_at FROM members ORDER BY added_at").toArray();
  }
  async createInvite(createdBy: string): Promise<string> {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    this.ctx.storage.sql.exec("INSERT INTO invites (token, created_by, expires_at) VALUES (?, ?, ?)", token, createdBy, Date.now() + 7 * 86_400_000);
    return token;
  }
  /** Single-use: the first signed-in user to present a valid token becomes a member. */
  async acceptInvite(token: string, userId: string, label?: string): Promise<boolean> {
    const row = this.ctx.storage.sql.exec<{ expires_at: number; used_by: string | null }>("SELECT expires_at, used_by FROM invites WHERE token = ?", token).toArray()[0];
    if (!row || row.used_by || row.expires_at < Date.now()) return false;
    this.ctx.storage.sql.exec("UPDATE invites SET used_by = ? WHERE token = ?", userId, token);
    if (!(await this.roleOf(userId))) await this.addMember(userId, "member", label);
    await this.logActivity(userId, "member.joined", `${label ?? "A collaborator"} joined the repository`);
    return true;
  }

  // ---- outgoing webhooks: durable outbox, signed delivery through the queue, visible log ----
  async addWebhook(url: string, events: string[]): Promise<{ id: string; secret: string }> {
    if (!Array.isArray(events) || events.length === 0 || events.some((event) => !(WEBHOOK_EVENTS as readonly string[]).includes(event))) throw new Error("Choose supported webhook events");
    const id = `wh_${crypto.randomUUID()}`;
    const secret = `whsec_${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))}`;
    const chosen = [...new Set(events)];
    this.ctx.storage.sql.exec("INSERT INTO webhooks (id, url, secret, events, active, created_at) VALUES (?, ?, ?, ?, 1, ?)", id, url, secret, chosen.join(","), new Date().toISOString());
    return { id, secret };
  }
  async listWebhooks(): Promise<WebhookRow[]> {
    return this.ctx.storage.sql.exec("SELECT id, url, events, active, created_at FROM webhooks ORDER BY created_at").toArray() as unknown as WebhookRow[];
  }
  async removeWebhook(id: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM webhooks WHERE id = ?", id);
  }
  async listDeliveries(limit: number): Promise<DeliveryRow[]> {
    return this.ctx.storage.sql
      .exec("SELECT id, seq, queue_ms, webhook_id, event, status, attempts, last_status, last_error, latency_ms, created_at, updated_at FROM deliveries ORDER BY created_at DESC LIMIT ?", Math.min(limit, 100))
      .toArray() as unknown as DeliveryRow[];
  }
  async getDelivery(id: string) {
    const d = this.ctx.storage.sql.exec("SELECT * FROM deliveries WHERE id = ?", id).toArray()[0] as unknown as (DeliveryRow & { payload: string }) | undefined;
    if (!d) return null;
    const w = this.ctx.storage.sql.exec("SELECT url, secret, active FROM webhooks WHERE id = ?", d.webhook_id).toArray()[0] as unknown as { url: string; secret: string; active: number } | undefined;
    return w ? { delivery: d, webhook: w } : null;
  }
  /** Records an attempt. Returns the attempt count so the consumer can decide whether to back off or give up. */
  async markDelivery(id: string, r: { ok: boolean; status?: number; error?: string; latencyMs?: number; final?: boolean }): Promise<number> {
    const row = this.ctx.storage.sql.exec<{ attempts: number; status: string }>("SELECT attempts, status FROM deliveries WHERE id = ?", id).toArray()[0];
    if (!row) throw new Error("Unknown delivery");
    // Concurrent queue deliveries can complete out of order. A confirmed success is terminal.
    if (row.status === "success") return row.attempts;
    const attempts = (row?.attempts ?? 0) + 1;
    if (attempts === 1) {
      this.ctx.storage.sql.exec("UPDATE deliveries SET queue_ms = MAX(0, CAST((julianday(?) - julianday(created_at)) * 86400000 AS INTEGER)) WHERE id = ?", new Date().toISOString(), id);
    }
    const status = r.ok ? "success" : r.final ? "failed" : "pending";
    this.ctx.storage.sql.exec(
      "UPDATE deliveries SET status = ?, attempts = ?, last_status = ?, last_error = ?, latency_ms = ?, updated_at = ? WHERE id = ?",
      status, attempts, r.status ?? null, r.error ? r.error.slice(0, 300) : null, r.latencyMs ?? null, new Date().toISOString(), id
    );
    return attempts;
  }
  private assertRetainedLocal(input:RetainedInput,checkpoint=true):void {
    const state=this.load(),task=state.tasks[input.taskId],candidate=state.candidates[input.candidateId];
    const actor=this.ctx.storage.sql.exec<{actor_id:string|null;kind:string}>("SELECT actor_id,kind FROM project_workflows WHERE instance_id=?",input.workflowId).toArray()[0];
    if(actor?.kind!=="integration"||actor.actor_id!==input.actorId||!this.ctx.storage.sql.exec("SELECT role FROM members WHERE user_id=?",input.actorId).toArray().length)throw new Error("Registered integration actor changed");
    if(input.followup&&(!candidate||candidate.status!=="accepted"||!candidate.candidateCommit||!candidate.participatingTaskIds.includes(input.taskId)||!state.acceptedState.history.some(entry=>entry.candidateId===candidate.id&&entry.commit===candidate.candidateCommit)||!state.journal.some(entry=>entry.state==="ACCEPTED"&&entry.candidateId===candidate.id&&entry.newHead===candidate.candidateCommit)))throw new Error("Accepted followup history required");
    if(this.repositoryDeleting()||state.projectId!==input.projectId||state.canonicalRepoName!==input.canonicalRepoName||this.readRepositoryIncarnation()!==input.incarnation||!task||(checkpoint&&(task.currentCommit!==input.commit||task.baseCommit!==input.base))||task.workspace.repoName!==input.workspaceRepoName||task.workspace.branch!==input.branch||(checkpoint&&task.dependsOn!==input.dependsOn)||(checkpoint&&!input.followup&&["accepted","cancelled"].includes(task.status))||candidate?.workflowInstanceId!==input.workflowId||this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",input.ownerId).toArray()[0]?.role!=="owner")throw new Error("Retained input authority or checkpoint changed");
  }
  private async authorizeRetainedInput(input:RetainedInput,checkpoint=true):Promise<void>{retainedInputSchema.parse(input);if(await accountKeyFor(input.ownerId)!==input.accountKey||await accountOf(this.env,input.accountKey).accountLifecycle()!=="active")throw new Error("Retained input owner unavailable");if(await accountOf(this.env,await accountKeyFor(input.actorId)).accountLifecycle()!=="active")throw new Error("Integration actor unavailable");this.assertRetainedLocal(input,checkpoint);}
  async prepareRetainedInput(taskId:string,workflowId:string,candidateId:string,id:string,followup?:boolean):Promise<RetainedInput>{
    const state=this.load(),task=state.tasks[taskId];if(!task)throw new Error("Contribution unavailable");
    const ownerId=this.ctx.storage.sql.exec<{user_id:string}>("SELECT user_id FROM members WHERE role='owner' ORDER BY user_id LIMIT 1").toArray()[0]?.user_id;if(!ownerId)throw new Error("Owner unavailable");
    const actor=await this.getWorkflowRun(workflowId);if(actor?.kind!=="integration"||!actor.actorId)throw new Error("Registered integration actor required");
    const input:RetainedInput={id,...(followup?{followup:true as const}:{}),actorId:actor.actorId,projectId:state.projectId,incarnation:new PrivateRecoveryOperations(this.ctx.storage).incarnation(),taskId,commit:task.currentCommit,base:task.baseCommit,canonicalRepoName:state.canonicalRepoName,workspaceRepoName:task.workspace.repoName,branch:task.workspace.branch,workflowId,candidateId,ownerId,accountKey:await accountKeyFor(ownerId),protectedRef:`refs/flaregit/inputs/${new PrivateRecoveryOperations(this.ctx.storage).incarnation()}/${taskId}/${task.currentCommit}`,protectedBaseRef:`refs/flaregit/inputs/${new PrivateRecoveryOperations(this.ctx.storage).incarnation()}/${taskId}/${task.baseCommit}`,...(task.dependsOn?{dependsOn:task.dependsOn}:{}),version:1};
    await this.authorizeRetainedInput(input);return input;
  }
  private retainedReceiptHistorical(input:RetainedInput):boolean {
    if(input.followup||!new RetainedCredentialIncidents(this.ctx.storage).canonicalWriteIssued(input))return false;
    const candidate=this.load().candidates[input.candidateId];
    if(!candidate||!candidate.participatingTaskIds.includes(input.taskId)||candidate.participatingCommits[input.taskId]!==input.commit)return false;
    const frozen=candidate.frozenContributorProofs?.find(item=>item.id===input.taskId&&item.commit===input.commit);
    return !frozen||frozen.baseCommit===input.base;
  }
  async recordRetainedInput(input:RetainedInput,proof:{commit:string;base:string}):Promise<RetainedInputReceipt>{
    const historical=this.retainedReceiptHistorical(input);
    await this.authorizeRetainedInput(input,!historical);
    return this.ctx.storage.transactionSync(()=>{if(historical&&!this.retainedReceiptHistorical(input))throw new Error("Historical retained input provenance changed");this.assertRetainedLocal(input,!historical);return new RetainedInputs(this.ctx.storage).record(input,proof);});
  }
  async beginRetainedCredential(input:RetainedInput,purpose:"workspace"|"canonical",expiresAt:number,scope:"read"|"write"):Promise<boolean>{
    if(input.followup&&(purpose!=="canonical"||scope!=="read"))throw new Error("Accepted followup only permits canonical reads");
    await this.ensureRecoveryAlarm();await this.authorizeRetainedInput(input);
    return new RetainedCredentialIncidents(this.ctx.storage).begin(input,purpose,expiresAt,scope,()=>this.assertRetainedLocal(input));
  }
  async recordRetainedCredential(inputId:string,purpose:"workspace"|"canonical",repoName:string,token:string,expiresAt:number):Promise<void>{
    await new RetainedCredentialIncidents(this.ctx.storage).record(inputId,purpose,repoName,token,expiresAt);
    await this.ensureRecoveryAlarm();
  }
  async revokeRetainedCredential(inputId:string,purpose:"workspace"|"canonical"):Promise<boolean>{
    const incidents=new RetainedCredentialIncidents(this.ctx.storage),summary=incidents.summary(inputId,purpose);
    if(summary?.status==="revoked")return true;
    const pending=incidents.credentialForRevocation(inputId,purpose);if(!pending)return false;
    const admission=await globalOf(this.env).reserveCoreGitOperation(`retained-cleanup-${crypto.randomUUID()}`,pending.accountKey,this.currentGitBudget()).catch(()=>null);
    if(!admission?.allowed||!incidents.markAttempt(inputId,purpose))return false;
    try{using repo=await this.env.ARTIFACTS.get(pending.repoName);if(!await repo.revokeToken(pending.token))return false;await incidents.markRevoked(inputId,purpose,pending.token);return true;}catch{return false;}
  }
  async markRetainedCredentialRevoked(inputId:string,purpose:"workspace"|"canonical",token:string):Promise<void>{await new RetainedCredentialIncidents(this.ctx.storage).markRevoked(inputId,purpose,token);}
  async retainedCredentialSummary(inputId:string,purpose:"workspace"|"canonical"){const incidents=new RetainedCredentialIncidents(this.ctx.storage);incidents.pendingBatch();return incidents.summary(inputId,purpose);}
  private async retryRetainedCredentialIncidents(){
    const incidents=new RetainedCredentialIncidents(this.ctx.storage),pending=incidents.pendingBatch();
    for(const incident of pending){
      if(!incidents.markAutomaticSweep(incident.inputId,incident.purpose))continue;
      const admission=await globalOf(this.env).reserveCoreGitOperation(`retained-cleanup-${crypto.randomUUID()}`,incident.accountKey,this.currentGitBudget()).catch(()=>null);
      if(!admission?.allowed||!incidents.markAttempt(incident.inputId,incident.purpose))continue;
      try{using repo=await this.env.ARTIFACTS.get(incident.repoName);if(await repo.revokeToken(incident.token))await incidents.markRevoked(incident.inputId,incident.purpose,incident.token);}catch{console.error("Retained credential revocation retry unavailable");}
    }
    const wake=incidents.nextWake();if(wake!==null)await this.ensureRecoveryAlarm(Math.max(1,wake-Date.now()));
  }
  async lookupRetainedInput(taskId:string,candidateId:string,commit:string,base?:string,userId?:string):Promise<RetainedInputReceipt|null>{
    if(!userId)throw new Error("Current member required for retained source");
    const context=await this.repositoryReadContext(userId,null);
    const state=this.load(),candidate=state.candidates[candidateId];
    this.assertReadLocal(context,userId,null);
    if(!candidate||candidate.participatingCommits[taskId]!==commit)throw new Error("Frozen candidate input does not match retained source");
    const receipt=new RetainedInputs(this.ctx.storage).lookup(taskId,candidateId,commit,base);
    if(!receipt)return null;
    if(receipt.projectId!==context.projectId||receipt.incarnation!==context.incarnation||receipt.canonicalRepoName!==context.canonicalRepoName||receipt.workflowId!==candidate.workflowInstanceId)throw new Error("Retained source scope changed");
    return receipt;
  }
  async assertRetainedInput(input:RetainedInput):Promise<boolean>{try{await this.authorizeRetainedInput(input);return true;}catch{return false;}}
  private async authorizeRebaseRecovery(actor:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number):Promise<()=>void>{
    const incarnation=this.readRepositoryIncarnation();const current=await this.authorizeHumanDecision(actor,credentialHash,true);
    const assert=()=>{current();if(this.readRepositoryIncarnation()!==incarnation||(!actor.viaToken&&(!Number.isFinite(sessionExpiresAt)||Date.now()>=sessionExpiresAt!)))throw new Error("Owner recovery authority changed");};assert();return assert;
  }
  private async integrationRuntimeScope(workflowId:string,candidateId:string):Promise<IntegrationNativeRuntimeScope>{
    const run=await this.getWorkflowRun(workflowId),state=this.load(),candidate=state.candidates[candidateId],incarnation=this.readRepositoryIncarnation();
    if(!run?.actorId||run.kind!=="integration"||!candidate||candidate.workflowInstanceId!==workflowId||!incarnation)throw new LegacyRerunError("Native workflow identity needs recovery.");
    const accountKey=await accountKeyFor(run.actorId);
    const current=this.load();if(this.readRepositoryIncarnation()!==incarnation||current.projectId!==state.projectId||current.candidates[candidateId]?.workflowInstanceId!==workflowId)throw new LegacyRerunError("Native workflow scope changed.");
    return{workflowId,candidateId,projectId:state.projectId,incarnation,actorId:run.actorId,accountKey};
  }
  private assertIntegrationNativeLocal(scope:IntegrationNativeRuntimeScope):void{const state=this.load();if(this.repositoryDeleting()||state.projectId!==scope.projectId||this.readRepositoryIncarnation()!==scope.incarnation||state.candidates[scope.candidateId]?.workflowInstanceId!==scope.workflowId||!this.ctx.storage.sql.exec("SELECT role FROM members WHERE user_id=?",scope.actorId).toArray().length)throw new LegacyRerunError("Native runtime scope or authority changed.");}
  private integrationNativeMissingCoverage():{instance_id:string;native_protocol:number|null}[]{return this.ctx.storage.sql.exec<{instance_id:string;native_protocol:number|null}>("SELECT p.instance_id,p.native_protocol FROM project_workflows p LEFT JOIN integration_native_coverage c ON c.workflow_id=p.instance_id WHERE p.kind='integration' AND c.workflow_id IS NULL LIMIT 21").toArray();}
  async stopIntegrationNativeForDeletion():Promise<boolean>{
    if(!this.repositoryDeleting())throw new Error("Deletion fence required");const runtime=new IntegrationNativeRuntimeLedger(this.ctx.storage),missing=this.integrationNativeMissingCoverage();if(missing.length>20)return false;
    for(const run of missing){if(run.native_protocol!==1||Object.values(this.load(true).candidates).some(candidate=>candidate.workflowInstanceId===run.instance_id))return false;try{const handle=await this.env.INTEGRATION_WORKFLOW.get(run.instance_id);let status=(await handle.status()).status;if(!["complete","errored","terminated"].includes(status)){await handle.terminate();status=(await handle.status()).status;}if(!["complete","errored","terminated"].includes(status))return false;}catch{return false;}}
    const page=runtime.pendingScopes();for(const scope of page.scopes){if(scope.projectId!==this.load(true).projectId||scope.incarnation!==this.readRepositoryIncarnation())return false;runtime.seal(scope);try{const handle=await this.env.INTEGRATION_WORKFLOW.get(scope.workflowId);let status=(await handle.status()).status;if(!["complete","errored","terminated"].includes(status)){await handle.terminate();status=(await handle.status()).status;}if(!["complete","errored","terminated"].includes(status))return false;for(const allocation of runtime.allocations(scope)){const sandbox=this.env.INTEGRATOR.getByName(`native-${allocation.nativeRunId}`);await sandbox.destroy();if((await sandbox.lifetimeStatus())?.state!=="stopped")return false;runtime.confirmStopped(scope,allocation.nativeRunId,{nativeRunId:allocation.nativeRunId,state:"stopped"});}if(runtime.recovery(scope)!=="stopped")return false;}catch{return false;}}
    return !page.truncated&&!runtime.hasUnconfirmed();
  }
  async declareIntegrationNativeRuntime(workflowId:string,candidateId:string):Promise<void>{const scope=await this.integrationRuntimeScope(workflowId,candidateId);this.assertIntegrationNativeLocal(scope);if(this.load().candidates[candidateId]?.preservationProtocolVersion!==1||await accountOf(this.env,scope.accountKey).accountLifecycle()!=="active")throw new LegacyRerunError("Native runtime authority changed.");this.assertIntegrationNativeLocal(scope);new IntegrationNativeRuntimeLedger(this.ctx.storage).declareCoverage(scope);}
  async reserveIntegrationNativeRuntime(workflowId:string,candidateId:string,nativeId:string,stage:string):Promise<void>{const scope=await this.integrationRuntimeScope(workflowId,candidateId);this.assertIntegrationNativeLocal(scope);if(await accountOf(this.env,scope.accountKey).accountLifecycle()!=="active")throw new LegacyRerunError("Native runtime authority changed.");this.assertIntegrationNativeLocal(scope);new IntegrationNativeRuntimeLedger(this.ctx.storage).reserve(scope,nativeId,stage);}
  async admitIntegrationNativeCommand(workflowId:string,candidateId:string,nativeId:string,commandId:string):Promise<IntegrationNativeRuntimeScope>{const scope=await this.integrationRuntimeScope(workflowId,candidateId);this.assertIntegrationNativeLocal(scope);if(await accountOf(this.env,scope.accountKey).accountLifecycle()!=="active")throw new LegacyRerunError("Native command authority changed.");this.assertIntegrationNativeLocal(scope);new IntegrationNativeRuntimeLedger(this.ctx.storage).admitCommand(scope,nativeId,commandId);return scope;}
  async integrationNativeCommandAllowed(scope:IntegrationNativeRuntimeScope,nativeId:string,commandId:string):Promise<boolean>{try{this.assertIntegrationNativeLocal(scope);if(await accountOf(this.env,scope.accountKey).accountLifecycle()!=="active")return false;this.assertIntegrationNativeLocal(scope);return new IntegrationNativeRuntimeLedger(this.ctx.storage).commandAllowed(scope,nativeId,commandId);}catch{return false;}}
  async finishIntegrationNativeCommand(scope:IntegrationNativeRuntimeScope,nativeId:string,commandId:string,outcome:"completed"|"refused"):Promise<void>{new IntegrationNativeRuntimeLedger(this.ctx.storage).finishCommand(scope,nativeId,commandId,{outcome});}
  async confirmIntegrationNativeRuntimeStopped(workflowId:string,candidateId:string,nativeId:string):Promise<void>{const scope=await this.integrationRuntimeScope(workflowId,candidateId);const lifetime=await this.env.INTEGRATOR.getByName(`native-${nativeId}`).lifetimeStatus();if(lifetime?.state!=="stopped")throw new LegacyRerunError("Native shutdown is unconfirmed.");new IntegrationNativeRuntimeLedger(this.ctx.storage).confirmStopped(scope,nativeId,{nativeRunId:nativeId,state:"stopped"});}
  async legacyCandidateRuntimeAvailable(candidateId:string):Promise<boolean>{try{const candidate=this.load().candidates[candidateId];if(!candidate?.workflowInstanceId)return false;const scope=await this.integrationRuntimeScope(candidate.workflowInstanceId,candidateId);return new IntegrationNativeRuntimeLedger(this.ctx.storage).recovery(scope)!=="recovery_required";}catch{return false;}}
  private legacyRerunSnapshot(candidateId:string):LegacyRerunSnapshot {
    const state=this.load(),candidate=state.candidates[candidateId],incarnation=this.readRepositoryIncarnation();
    if(!candidate||!incarnation)throw new LegacyRerunError("Saved candidate is unavailable.");
    const tasks=candidate.participatingTaskIds.map(id=>{const task=state.tasks[id];if(!task)throw new LegacyRerunError("Saved contribution is unavailable.");return {id:task.id,currentCommit:task.currentCommit,baseCommit:task.baseCommit,workspace:{repoName:task.workspace.repoName,branch:task.workspace.branch},dependsOn:task.dependsOn,status:task.status,activeCandidateId:task.activeCandidateId,agentRunId:task.agentRunId};});
    return {projectId:state.projectId,incarnation,canonicalRepoName:state.canonicalRepoName,candidate:structuredClone(candidate),tasks,busy:tasks.some(task=>{if(!task.agentRunId)return false;const run=this.agentRuns().get(task.agentRunId);return !run||["claimed","proposed","pushed"].includes(run.phase);}),publicationBlocked:state.journal.some(entry=>entry.candidateId===candidateId&&(entry.state==="PREPARED"||entry.state==="ACCEPTED"))||state.acceptedState.history.some(entry=>entry.candidateId===candidateId)};
  }
  async legacyCandidateRerunReport(candidateId:string,actor:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number){
    const assert=await this.authorizeRebaseRecovery(actor,credentialHash,sessionExpiresAt);assert();const snapshot=this.legacyRerunSnapshot(candidateId),expectedCommit=snapshot.candidate.candidateCommit??null,inputs:Record<string,{commit:string;base:string}>={};
    for(const proof of snapshot.candidate.frozenContributorProofs??[])if(snapshot.candidate.participatingCommits[proof.id]===proof.commit)inputs[proof.id]={commit:proof.commit,base:proof.baseCommit};
    const saved=new LegacyCandidateReruns(this.ctx.storage).forCandidate(candidateId);let eligible=true,detail="Run a fresh candidate from these exact saved contributions. This candidate and its review remain preserved.";
    try{if(saved?.phase==="abandoned"){assertLegacyRerunEligible(snapshot,expectedCommit);detail="The previous rerun was abandoned before dispatch. Its audit and preserved candidate remain available.";}else if(saved){this.assertLegacyRerunScope(saved);if(saved.phase==="awaiting_decision"){eligible=false;detail="Resolve the linked product decision to continue from these preserved inputs.";}if(saved.phase==="attached"){eligible=false;detail="The fresh candidate is linked below. Its progress and review remain separate from this preserved candidate.";}}else assertLegacyRerunEligible(snapshot,expectedCommit);}catch(error){eligible=false;detail=error instanceof LegacyRerunError?error.message:"Frozen contribution context is unavailable.";}
    return {candidateId,expectedCommit,inputs,eligible,detail,...(saved?{operation:{id:saved.id,phase:saved.phase,dispatch:saved.dispatch,abandoned:saved.abandoned,successorCandidateId:saved.successorCandidateId,successorWorkflowId:saved.successorWorkflowId,successorDecisionId:saved.successorDecisionId,continuationWorkflowId:saved.continuationWorkflowId}}:{})};
  }
  async prepareLegacyCandidateRerun(candidateId:string,expectedCommit:string|null,requestId:string,actor:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number,expectedInputs?:Record<string,{commit:string;base:string}>):Promise<LegacyCandidateRerun>{
    const assert=await this.authorizeRebaseRecovery(actor,credentialHash,sessionExpiresAt);assert();
    return this.ctx.storage.transactionSync(()=>{assert();const snapshot=this.legacyRerunSnapshot(candidateId);if(!expectedInputs)throw new LegacyRerunError("Exact frozen contribution inputs are required.");const attempt=new LegacyCandidateReruns(this.ctx.storage).prepare({id:requestId,expectedCommit,actor,snapshot,credentialHash,sessionExpiresAt,expectedInputs});this.assertLegacyRerunScope(attempt);attempt.credentialHash=credentialHash;attempt.sessionExpiresAt=sessionExpiresAt;new LegacyCandidateReruns(this.ctx.storage).save(attempt);return attempt;});
  }
  async getLegacyCandidateRerun(id:string):Promise<LegacyCandidateRerun|null>{return new LegacyCandidateReruns(this.ctx.storage).get(id);}
  async markLegacyCandidateRerunDispatch(id:string,dispatch:"unknown"|"observed"):Promise<LegacyCandidateRerun>{const attempt=await this.assertLegacyCandidateRerun(id),assert=await this.authorizeHumanDecision(attempt.actor,attempt.credentialHash,true);assert();this.assertLegacyRerunScope(attempt);return new LegacyCandidateReruns(this.ctx.storage).markDispatch(id,dispatch);}
  async abandonLegacyCandidateRerun(id:string,actor:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number):Promise<LegacyCandidateRerun>{
    let assert=await this.authorizeRebaseRecovery(actor,credentialHash,sessionExpiresAt);assert();const ledger=new LegacyCandidateReruns(this.ctx.storage);let attempt=ledger.get(id);if(!attempt)throw new LegacyRerunError("Saved rerun is unavailable.");
    const scopeOnly=()=>{assert();const state=this.load(),candidate=state.candidates[attempt!.predecessorCandidateId];if(state.projectId!==attempt!.snapshot.projectId||state.canonicalRepoName!==attempt!.snapshot.canonicalRepoName||this.readRepositoryIncarnation()!==attempt!.snapshot.incarnation||!candidate||JSON.stringify(candidate)!==JSON.stringify(attempt!.snapshot.candidate)||state.journal.some(entry=>entry.candidateId===candidate.id&&(entry.state==="PREPARED"||entry.state==="ACCEPTED"))||state.acceptedState.history.some(entry=>entry.candidateId===candidate.id))throw new LegacyRerunError("The preserved candidate or publication state changed.");};scopeOnly();
    if(attempt.phase==="abandoned")return attempt;
    if(attempt.dispatch!=="not_started"||attempt.successorCandidateId)throw new LegacyRerunError("A dispatched or uncertain rerun cannot be abandoned.");
    attempt=await this.stopLegacyCandidateRerun(id,true,actor,credentialHash,sessionExpiresAt);assert=await this.authorizeRebaseRecovery(actor,credentialHash,sessionExpiresAt);scopeOnly();
    try{return this.ctx.storage.transactionSync(()=>{scopeOnly();const current=ledger.get(id);if(!current||current.dispatch!=="not_started"||!current.vmStopped||!current.terminalState)throw new LegacyRerunError("Stopped predispatch execution must be confirmed before abandonment.");const state=this.load();for(const previous of current.snapshot.tasks){const task=state.tasks[previous.id];if(task&&task.activeCandidateId===current.predecessorCandidateId&&["integrating","verifying"].includes(task.status)&&task.currentCommit===previous.currentCommit&&task.baseCommit===previous.baseCommit&&task.workspace.repoName===previous.workspace.repoName&&task.workspace.branch===previous.workspace.branch&&task.dependsOn===previous.dependsOn&&task.agentRunId===previous.agentRunId){task.status="checkpointed";task.updatedAt=new Date().toISOString();}}const result=ledger.abandon(id,actor);this.save();return result;});}catch(error){this.state=null;throw error;}
  }

  async assertLegacyCandidateRerun(id:string,actor?:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number,holder?:string):Promise<LegacyCandidateRerun>{
    const attempt=new LegacyCandidateReruns(this.ctx.storage).get(id);if(!attempt)throw new LegacyRerunError("Saved rerun is unavailable.");
    if(actor&&(actor.userId!==attempt.actor.userId||actor.viaToken!==attempt.actor.viaToken))throw new LegacyRerunError("This request belongs to another rerun actor.");
    let backgroundActor=attempt.actor,backgroundHash=attempt.credentialHash;
    if(holder&&holder===attempt.continuationWorkflowId&&attempt.continuationActor){const registered=await this.getWorkflowRun(holder);if(registered?.kind!=="integration"||registered.actorId!==attempt.continuationActor.userId)throw new LegacyRerunError("Decision continuation identity changed.");backgroundActor=attempt.continuationActor;backgroundHash=attempt.continuationCredentialHash;}
    else if(holder&&holder!==attempt.successorWorkflowId)throw new LegacyRerunError("Saved rerun workflow identity changed.");
    const assert=actor?await this.authorizeRebaseRecovery(actor,credentialHash,sessionExpiresAt):await this.authorizeHumanDecision(backgroundActor,backgroundHash,true);assert();this.assertLegacyRerunScope(attempt);return attempt;
  }
  private assertLegacyRerunScope(attempt:LegacyCandidateRerun):void{
    const current=this.legacyRerunSnapshot(attempt.predecessorCandidateId);
    if(attempt.phase==="abandoned")throw new LegacyRerunError("This rerun was explicitly abandoned before dispatch.");
    if(attempt.phase==="prepared"||attempt.phase==="stopped"){
      assertLegacyRerunEligible(current,attempt.expectedCommit);
      if(JSON.stringify(current)!==JSON.stringify(attempt.snapshot))throw new LegacyRerunError("The frozen rerun context changed.");
    }else{
      if(current.projectId!==attempt.snapshot.projectId||current.incarnation!==attempt.snapshot.incarnation||current.canonicalRepoName!==attempt.snapshot.canonicalRepoName||current.publicationBlocked||JSON.stringify(current.candidate)!==JSON.stringify(attempt.snapshot.candidate))throw new LegacyRerunError("The predecessor or repository changed.");
      if(attempt.phase==="attached"){
        const successor=attempt.successorCandidateId?this.load().candidates[attempt.successorCandidateId]:undefined;
        if(!successor||successor.workflowInstanceId!==(attempt.continuationWorkflowId??attempt.successorWorkflowId)||successor.predecessorCandidateId!==attempt.predecessorCandidateId||successor.legacyRerunId!==attempt.id||successor.preservationProtocolVersion!==1||JSON.stringify(successor.participatingTaskIds)!==JSON.stringify(attempt.taskIds)||attempt.snapshot.tasks.some(task=>successor.participatingCommits[task.id]!==task.currentCommit||!successor.frozenContributorProofs?.some(proof=>proof.id===task.id&&proof.commit===task.currentCommit&&proof.baseCommit===task.baseCommit)))throw new LegacyRerunError("Saved successor linkage changed.");
        return;
      }
      if(attempt.phase==="awaiting_decision"){const decision=attempt.successorDecisionId?this.load().decisions[attempt.successorDecisionId]:undefined;if(!decision||decision.legacyRerunId!==attempt.id||decision.status!=="pending")throw new LegacyRerunError("Saved product decision ownership changed.");}
      for(const previous of attempt.snapshot.tasks){const task=current.tasks.find(value=>value.id===previous.id);if(!task||task.currentCommit!==previous.currentCommit||task.baseCommit!==previous.baseCommit||task.workspace.repoName!==previous.workspace.repoName||task.workspace.branch!==previous.workspace.branch||task.dependsOn!==previous.dependsOn||task.agentRunId!==previous.agentRunId||task.activeCandidateId!==(attempt.successorCandidateId??previous.activeCandidateId)||task.status!==(attempt.phase==="awaiting_decision"?"needs_decision":"ready"))throw new LegacyRerunError("Reassigned contribution changed.");}
    }
  }
  async stopLegacyCandidateRerun(id:string,allowChangedInputs=false,actor?:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number):Promise<LegacyCandidateRerun>{
    const attempt=allowChangedInputs?new LegacyCandidateReruns(this.ctx.storage).get(id):await this.assertLegacyCandidateRerun(id);if(!attempt)throw new LegacyRerunError("Saved rerun unavailable.");
    const current=actor?await this.authorizeRebaseRecovery(actor,credentialHash,sessionExpiresAt):await this.authorizeHumanDecision(attempt.actor,attempt.credentialHash,true);
    const assertStop=()=>{current();const snapshot=this.legacyRerunSnapshot(attempt.predecessorCandidateId);if(snapshot.projectId!==attempt.snapshot.projectId||snapshot.incarnation!==attempt.snapshot.incarnation||snapshot.canonicalRepoName!==attempt.snapshot.canonicalRepoName||snapshot.publicationBlocked||JSON.stringify(snapshot.candidate)!==JSON.stringify(attempt.snapshot.candidate))throw new LegacyRerunError("Old execution scope changed.");if(!allowChangedInputs)this.assertLegacyRerunScope(attempt);};assertStop();if(attempt.phase!=="prepared")return attempt;
    const workflowId=attempt.snapshot.candidate.workflowInstanceId!,scope=await this.integrationRuntimeScope(workflowId,attempt.predecessorCandidateId),runtime=new IntegrationNativeRuntimeLedger(this.ctx.storage);
    if(runtime.recovery(scope)==="recovery_required")throw new LegacyRerunError("The old native runtime identities were not recorded. Operator recovery is required; no execution is guessed stopped.");
    runtime.seal(scope);const handle=await this.env.INTEGRATION_WORKFLOW.get(workflowId);let status=(await handle.status()).status;
    if(!["complete","errored","terminated"].includes(status)){await handle.terminate();status=(await handle.status()).status;}
    if(status!=="complete"&&status!=="errored"&&status!=="terminated")throw new LegacyRerunError("Old workflow shutdown is unconfirmed.");
    for(const allocation of runtime.allocations(scope)){const sandbox=this.env.INTEGRATOR.getByName(`native-${allocation.nativeRunId}`);await sandbox.destroy();if((await sandbox.lifetimeStatus())?.state!=="stopped")throw new LegacyRerunError("Old native shutdown is unconfirmed.");runtime.confirmStopped(scope,allocation.nativeRunId,{nativeRunId:allocation.nativeRunId,state:"stopped"});}
    assertStop();return this.ctx.storage.transactionSync(()=>{assertStop();if(runtime.recovery(scope)!=="stopped")throw new LegacyRerunError("Old execution remains unconfirmed.");attempt.phase="stopped";attempt.terminalState=status;attempt.vmStopped=true;new LegacyCandidateReruns(this.ctx.storage).save(attempt);return attempt;});
  }
  async commitLegacyCandidateRerunReassignment(id:string):Promise<LegacyCandidateRerun>{
    const attempt=await this.assertLegacyCandidateRerun(id),assert=await this.authorizeHumanDecision(attempt.actor,attempt.credentialHash,true);
    try{return this.ctx.storage.transactionSync(()=>{assert();this.assertLegacyRerunScope(attempt);if(attempt.phase==="reassigned"||attempt.phase==="attached")return attempt;if(attempt.phase!=="stopped"||!attempt.vmStopped||!attempt.terminalState)throw new LegacyRerunError("Saved rerun must confirm execution stopped before reassignment.");const state=this.load();for(const taskId of attempt.taskIds)state.tasks[taskId]!.status="ready";const lease=this.ctx.storage.sql.exec<{holder:string}>("SELECT holder FROM lease WHERE id=1").toArray()[0];if(lease&&lease.holder===attempt.snapshot.candidate.workflowInstanceId)this.ctx.storage.sql.exec("DELETE FROM lease WHERE id=1 AND holder=?",lease.holder);attempt.phase="reassigned";new LegacyCandidateReruns(this.ctx.storage).save(attempt);this.save();return attempt;});}catch(error){this.state=null;throw error;}
  }
  async attachLegacyCandidateRerunSuccessor(id:string,candidateId:string):Promise<LegacyCandidateRerun>{
    const attempt=new LegacyCandidateReruns(this.ctx.storage).get(id);if(!attempt)throw new LegacyRerunError("Saved rerun is unavailable.");const assert=await this.authorizeHumanDecision(attempt.actor,attempt.credentialHash,true);assert();
    return this.ctx.storage.transactionSync(()=>{assert();const candidate=this.load().candidates[candidateId];if(attempt.successorCandidateId===candidateId){this.assertLegacyRerunScope(attempt);return attempt;}if(attempt.phase!=="reassigned"||!candidate||candidate.workflowInstanceId!==(attempt.continuationWorkflowId??attempt.successorWorkflowId)||candidate.predecessorCandidateId!==attempt.predecessorCandidateId||candidate.legacyRerunId!==id)throw new LegacyRerunError("Successor claim does not match this saved rerun.");attempt.successorCandidateId=candidateId;attempt.phase="attached";this.assertLegacyRerunScope(attempt);new LegacyCandidateReruns(this.ctx.storage).save(attempt);return attempt;});
  }
  private ownerRebaseSnapshot(application:RebaseApplication):RebaseRecoverySnapshot {
    const state=this.load(),task=state.tasks[application.input.taskId];if(!task)throw new RebaseRecoveryError("Contribution is unavailable",409);
    const candidate=state.candidates[application.input.candidateId];
    const accepted=Boolean(candidate?.candidateCommit&&state.acceptedState.history.some(entry=>entry.candidateId===candidate.id&&entry.commit===candidate.candidateCommit)&&state.journal.some(entry=>entry.state==="ACCEPTED"&&entry.candidateId===candidate.id&&entry.newHead===candidate.candidateCommit));
    const active=task.activeCandidateId?state.candidates[task.activeCandidateId]:undefined;
    const agent=task.agentRunId?this.agentRuns().get(task.agentRunId):null;
    const agentBusy=Boolean(agent?["claimed","proposed","pushed"].includes(agent.phase):task.status==="working"&&(task.agentWorkflowInstanceId||task.agentRunId));
    return {projectId:state.projectId,incarnation:this.readRepositoryIncarnation(),canonicalRepoName:state.canonicalRepoName,accepted,task:{id:task.id,currentCommit:task.currentCommit,baseCommit:task.baseCommit,workspaceRepoName:task.workspace.repoName,branch:task.workspace.branch,dependsOn:task.dependsOn,status:task.status,busy:agentBusy||Boolean(active&&!["accepted","failed","stale"].includes(active.status))}};
  }
  async ownerRebaseApplications(actor:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number):Promise<{applications:OwnerRebaseApplication[];truncated:boolean}>{
    const assert=await this.authorizeRebaseRecovery(actor,credentialHash,sessionExpiresAt);assert();
    if(!this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='rebase_applications'").toArray().length)return {applications:[],truncated:false};
    const state=this.load(),incarnation=this.readRepositoryIncarnation();const rows=this.ctx.storage.sql.exec<{doc:string}>("SELECT doc FROM rebase_applications ORDER BY rowid DESC LIMIT 51").toArray();
    const ledger=new RebaseRecoveryLedger(this.ctx.storage);
    const applications=rows.slice(0,50).map(row=>JSON.parse(row.doc) as RebaseApplication).filter(value=>value.input.projectId===state.projectId&&value.input.incarnation===incarnation&&value.input.canonicalRepoName===state.canonicalRepoName).map(value=>{const report=ledger.observe(value,this.ownerRebaseSnapshot(value)),attempt=new RebaseResumeAttempts(this.ctx.storage).latest(value.input.id);return {...report,resumeAvailable:Boolean(this.env.REBASE_RESUME_WORKFLOW)&&(report.canReconcile||report.status==="remote_old_resume_required"),...(attempt?{resume:{id:attempt.id,generation:attempt.generation,dispatch:attempt.dispatch,nativeState:attempt.nativeState,terminal:attempt.terminal,pauseReason:attempt.pauseReason}}:{})};});
    assert();return {applications,truncated:rows.length>50};
  }
  async reconcileRebaseApplication(id:string,actor:HumanDecisionActor,expectedVersion:number,idempotencyKey:string,credentialHash?:string,sessionExpiresAt?:number):Promise<OwnerRebaseRecoveryResult>{try{return {ok:true,receipt:await this.reconcileOwnerRebase(id,actor,expectedVersion,idempotencyKey,credentialHash,sessionExpiresAt)};}catch(error){return error instanceof RebaseRecoveryError?{ok:false,status:error.status,error:error.message,...(error.report?{report:error.report}:{})}:{ok:false,status:409,error:"Recovery was not confirmed. Reload saved state before retrying this request."};}}
  private async reconcileOwnerRebase(id:string,actor:HumanDecisionActor,expectedVersion:number,idempotencyKey:string,credentialHash?:string,sessionExpiresAt?:number):Promise<RebaseRecoveryReceipt>{
    const ledger=new RebaseRecoveryLedger(this.ctx.storage);let assert=await this.authorizeRebaseRecovery(actor,credentialHash,sessionExpiresAt);assert();
    const applications=new RetainedInputs(this.ctx.storage),application=applications.application(id);if(!application)throw new RebaseRecoveryError("Saved rebase not found",409);
    const current=this.load();if(application.input.projectId!==current.projectId||application.input.incarnation!==this.readRepositoryIncarnation()||application.input.canonicalRepoName!==current.canonicalRepoName)throw new RebaseRecoveryError("Saved recovery belongs to a different repository scope",409);
    const replay=ledger.preflight(idempotencyKey,id,actor,expectedVersion);if(replay)return replay;
    const snapshot=this.ownerRebaseSnapshot(application),snapshotKey=JSON.stringify(snapshot);
    const report=ledger.observe(application,snapshot);if(report.version!==expectedVersion||(!report.canReconcile&&report.status!=="already_applied"))throw new RebaseRecoveryError(report.detail,409,report);
    const authorize=async()=>{assert=await this.authorizeRebaseRecovery(actor,credentialHash,sessionExpiresAt);assert();if(JSON.stringify(this.ownerRebaseSnapshot(application))!==snapshotKey)throw new RebaseRecoveryError("Contribution changed while checking saved Git state",409);};
    const accountKey=await accountKeyFor(actor.userId);
    const proof=application.status==="applied"?{workspaceHead:null,original:null,originalBase:null,result:null,targetBase:null}:await verifyRebaseRecovery(this.env.ARTIFACTS,application,{authorize,reserveGroup:operationId=>globalOf(this.env).reserveCoreGitOperation(operationId,accountKey,this.currentGitBudget())});
    await authorize();
    try{return ledger.reconcile({application,snapshot,proof,actor,expectedVersion,idempotencyKey},plan=>{
      assert();if(JSON.stringify(this.ownerRebaseSnapshot(application))!==snapshotKey)throw new RebaseRecoveryError("Contribution changed before recovery",409);
      const task=this.load().tasks[application.input.taskId]!;applications.remoteVerified(id,application.commit);
      applications.applyApplication(id,()=>{task.currentCommit=plan.commit;task.baseCommit=plan.base;if(plan.dependsOn===undefined)delete task.dependsOn;else task.dependsOn=plan.dependsOn;task.updatedAt=new Date().toISOString();this.save();});
    },()=>{assert();if(JSON.stringify(this.ownerRebaseSnapshot(application))!==snapshotKey)throw new RebaseRecoveryError("Recovery scope changed",409);});}catch(error){this.state=null;throw error;}
  }
  private async authorizeSavedResume(id:string,generation:number,workflowId:string){
    const attempt=new RebaseResumeAttempts(this.ctx.storage).get(id);
    if(!attempt||attempt.generation!==generation||attempt.workflowId!==workflowId||attempt.terminal)throw new RebaseRecoveryError("Saved recovery attempt is unavailable",409);
    const incarnation=this.readRepositoryIncarnation(),currentAuthority=await this.authorizeHumanDecision(attempt.actor,attempt.credentialHash,true);
    const assert=()=>{currentAuthority();if(this.readRepositoryIncarnation()!==incarnation)throw new RebaseRecoveryError("Saved recovery repository scope changed",409);assertRebaseResumeSessionDelegation(attempt);};assert();
    const application=new RetainedInputs(this.ctx.storage).application(attempt.applicationId);
    if(!application||JSON.stringify(application.input)!==JSON.stringify(attempt.application.input)||application.commit!==attempt.application.commit||application.base!==attempt.application.base)throw new RebaseRecoveryError("Saved rebase identity changed",409);
    const currentScope=this.ownerRebaseSnapshot(application);if(currentScope.projectId!==attempt.scope.projectId||currentScope.incarnation!==attempt.scope.incarnation||currentScope.canonicalRepoName!==attempt.scope.canonicalRepoName)throw new RebaseRecoveryError("Saved recovery scope changed",409);
    const receipt=new RebaseRecoveryLedger(this.ctx.storage).replay(attempt.requestId,attempt.applicationId,attempt.actor,attempt.expectedVersion);
    const validate=()=>{assert();const latest=new RebaseResumeAttempts(this.ctx.storage).latest(attempt.applicationId),live=new RetainedInputs(this.ctx.storage).application(attempt.applicationId),current=this.ownerRebaseSnapshot(application);if(latest?.id!==id||latest.generation!==generation||latest.terminal||!live||JSON.stringify(live.input)!==JSON.stringify(attempt.application.input)||live.commit!==attempt.application.commit||live.base!==attempt.application.base||current.projectId!==attempt.scope.projectId||current.incarnation!==attempt.scope.incarnation||current.canonicalRepoName!==attempt.scope.canonicalRepoName)throw new RebaseRecoveryError("Saved recovery scope or generation changed",409);if(receipt)return;if(JSON.stringify(current)!==JSON.stringify(attempt.snapshot))throw new RebaseRecoveryError("Contribution changed during saved recovery",409);};validate();
    return {attempt,application,validate,receipt};
  }
  async beginRebaseResume(id:string,actor:HumanDecisionActor,expectedVersion:number,idempotencyKey:string,credentialHash?:string,sessionExpiresAt?:number):Promise<OwnerRebaseResumeResult>{
    try{
      const assert=await this.authorizeRebaseRecovery(actor,credentialHash,sessionExpiresAt);assert();
      const application=new RetainedInputs(this.ctx.storage).application(id);if(!application)throw new RebaseRecoveryError("Saved rebase not found",409);
      if(application.input.canonicalRepoName===application.input.workspaceRepoName)throw new RebaseRecoveryError("Saved workspace is not isolated from accepted history",409);
      const snapshot=this.ownerRebaseSnapshot(application),ledger=new RebaseRecoveryLedger(this.ctx.storage),attempts=new RebaseResumeAttempts(this.ctx.storage);
      // Scope validation precedes replay, including recreated repository incarnations.
      const report=ledger.observe(application,snapshot);
      const replay=attempts.replay(id,idempotencyKey,actor,expectedVersion);if(replay)return {ok:true,attempt:replay};
      ledger.preflight(idempotencyKey,id,actor,expectedVersion);
      if(report.version!==expectedVersion||!report.canReconcile||application.status==="applied")throw new RebaseRecoveryError(report.detail,409,report);
      return this.ctx.storage.transactionSync(()=>{assert();if(JSON.stringify(this.ownerRebaseSnapshot(application))!==JSON.stringify(snapshot))throw new RebaseRecoveryError("Contribution changed before resume",409);return {ok:true as const,attempt:attempts.begin({application,snapshot,actor,expectedVersion,requestId:idempotencyKey,credentialHash,sessionExpiresAt})};});
    }catch(error){return error instanceof RebaseRecoveryError?{ok:false,status:error.status,error:error.message}:{ok:false,status:409,error:"Saved resume requires current owner authority"};}
  }
  async pauseRebaseResume(id:string,generation:number,workflowId:string,reason:string):Promise<void>{
    const attempts=new RebaseResumeAttempts(this.ctx.storage),attempt=attempts.get(id);if(!attempt||attempt.generation!==generation||attempt.workflowId!==workflowId)throw new RebaseRecoveryError("Saved recovery identity changed",409);
    // Controlled vocabulary prevents provider secrets or command output entering saved context.
    const allowed=["authority_changed","git_state_changed","funding_refused","transport_unconfirmed","cleanup_unconfirmed","execution_failed"];
    if(!allowed.includes(reason))throw new RebaseRecoveryError("Invalid recovery pause reason",409);
    attempts.update(id,generation,value=>{value.pauseReason=reason;});
  }
  async beginRebaseResumeCredential(id:string,generation:number,purpose:SavedRebaseResumeCredentialPurpose,expiresAt:number,scope:"read"|"write"):Promise<boolean>{
    const attempt=new RebaseResumeAttempts(this.ctx.storage).get(id);if(!attempt)throw new RebaseRecoveryError("Saved resume missing",409);
    const {application,validate}=await this.authorizeSavedResume(id,generation,attempt.workflowId);
    if(scope!==(purpose==="canonical"?"read":"write"))throw new RebaseRecoveryError("Credential scope does not match saved recovery",409);
    const accountKey=await accountKeyFor(attempt.actor.userId);validate();await this.ensureRecoveryAlarm();validate();
    return new SavedRebaseResumeCredentials(this.ctx.storage).begin({attemptId:id,applicationId:attempt.applicationId,projectId:attempt.scope.projectId,incarnation:attempt.scope.incarnation!,accountKey,canonicalRepoName:application.input.canonicalRepoName,workspaceRepoName:application.input.workspaceRepoName,actorId:attempt.actor.userId},purpose,expiresAt,validate);
  }
  async recordRebaseResumeCredential(id:string,generation:number,purpose:SavedRebaseResumeCredentialPurpose,repoName:string,token:string,expiresAt:number):Promise<void>{const attempt=new RebaseResumeAttempts(this.ctx.storage).get(id);if(!attempt||attempt.generation!==generation)throw new RebaseRecoveryError("Credential recovery identity changed",409);await new SavedRebaseResumeCredentials(this.ctx.storage).record(id,purpose,repoName,token,expiresAt);await this.ensureRecoveryAlarm();}
  async markRebaseResumeCredentialRevoked(id:string,purpose:SavedRebaseResumeCredentialPurpose,token:string):Promise<void>{await new SavedRebaseResumeCredentials(this.ctx.storage).markRevoked(id,purpose,token);}
  async revokeRebaseResumeCredential(id:string,generation:number,purpose:SavedRebaseResumeCredentialPurpose):Promise<boolean>{
    const attempt=new RebaseResumeAttempts(this.ctx.storage).get(id);if(!attempt||attempt.generation!==generation)throw new RebaseRecoveryError("Credential cleanup identity changed",409);
    const incidents=new SavedRebaseResumeCredentials(this.ctx.storage),summary=incidents.summary(id,purpose);if(!summary||summary.status==="revoked")return true;
    const pending=incidents.credentialForRevocation(id,purpose);if(!pending)return false;
    const admission=await globalOf(this.env).reserveCoreGitOperation(`resume-cleanup-${crypto.randomUUID()}`,pending.accountKey,this.currentGitBudget()).catch(()=>null);if(!admission?.allowed||!incidents.markAttempt(id,purpose))return false;
    try{using repo=await this.env.ARTIFACTS.get(pending.repoName);if(!await repo.revokeToken(pending.token))return false;await incidents.markRevoked(id,purpose,pending.token);return true;}catch{return false;}
  }
  private async retryRebaseResumeCredentials(){const incidents=new SavedRebaseResumeCredentials(this.ctx.storage);for(const incident of incidents.pendingBatch()){if(!incidents.markAutomaticSweep(incident.attemptId,incident.purpose))continue;const attempt=new RebaseResumeAttempts(this.ctx.storage).get(incident.attemptId);if(attempt)await this.revokeRebaseResumeCredential(incident.attemptId,attempt.generation,incident.purpose);}const wake=incidents.nextWake();if(wake!==null)await this.ensureRecoveryAlarm(Math.max(1,wake-Date.now()));}
  async stopRebaseResumeForDeletion():Promise<boolean>{
    if(!this.repositoryDeleting())throw new RebaseRecoveryError("Recovery cleanup requires repository deletion fence",409);
    const attempts=new RebaseResumeAttempts(this.ctx.storage),rows=this.ctx.storage.sql.exec<{doc:string}>("SELECT doc FROM rebase_resume_attempts a WHERE rowid=(SELECT MAX(rowid) FROM rebase_resume_attempts b WHERE b.application_id=a.application_id) AND (json_extract(doc,'$.nativeState')!='stopped' OR json_extract(doc,'$.terminal') IS NULL OR json_extract(doc,'$.dispatch')='unknown') ORDER BY rowid LIMIT 21").toArray();
    for(const row of rows.slice(0,20)){const attempt=JSON.parse(row.doc) as RebaseResumeAttempt;if(attempts.latest(attempt.applicationId)?.id!==attempt.id)continue;
      try{
        if(attempt.dispatch!=="saved"&&!attempt.terminal){
          if(!this.env.REBASE_RESUME_WORKFLOW)return false;
          const handle=await this.env.REBASE_RESUME_WORKFLOW.get(attempt.workflowId);let status=await handle.status();
          if(!["complete","errored","terminated"].includes(status.status)){await handle.terminate();status=await handle.status();if(!["complete","errored","terminated"].includes(status.status))return false;}
          attempts.dispatch(attempt.id,attempt.generation,"observed");attempts.terminal(attempt.id,attempt.generation,status.status==="complete"?"completed":"failed");
        }else if(attempt.dispatch==="saved"){if(attempt.nativeState!=="unallocated"&&attempt.nativeState!=="stopped")return false;attempts.terminal(attempt.id,attempt.generation,"failed");}
        await this.rebaseResumeNativeStopped(attempt.id,attempt.generation,attempt.nativeRunId);
      }catch{return false;}
    }
    if(rows.length>20)return false;
    const incidents=new SavedRebaseResumeCredentials(this.ctx.storage);for(const pending of incidents.pendingBatch()){const attempt=attempts.get(pending.attemptId);if(!attempt||!await this.revokeRebaseResumeCredential(attempt.id,attempt.generation,pending.purpose))return false;}
    return !incidents.hasPending();
  }
  async ownerRebaseResumeStatus(applicationId:string,actor:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number){
    const assert=await this.authorizeRebaseRecovery(actor,credentialHash,sessionExpiresAt);assert();const app=new RetainedInputs(this.ctx.storage).application(applicationId);if(!app)throw new RebaseRecoveryError("Saved rebase not found",409);new RebaseRecoveryLedger(this.ctx.storage).observe(app,this.ownerRebaseSnapshot(app));const attempt=new RebaseResumeAttempts(this.ctx.storage).latest(applicationId);if(!attempt)return null;
    const scope={projectId:app.input.projectId,incarnation:app.input.incarnation,canonicalRepoName:app.input.canonicalRepoName};
    const validate=()=>{assert();const live=new RetainedInputs(this.ctx.storage).application(applicationId),current=this.load(),latest=new RebaseResumeAttempts(this.ctx.storage).latest(applicationId);if(!live||JSON.stringify(live.input)!==JSON.stringify(app.input)||live.commit!==app.commit||live.base!==app.base||current.projectId!==scope.projectId||current.canonicalRepoName!==scope.canonicalRepoName||this.readRepositoryIncarnation()!==scope.incarnation||latest?.id!==attempt.id||latest.generation!==attempt.generation)throw new RebaseRecoveryError("Saved recovery status scope changed",409);};
    let result:RebaseResumeAttempt|null;try{result=await this.observeRebaseResume(attempt.id,attempt.generation,actor,credentialHash,sessionExpiresAt);}catch{validate();result=new RebaseResumeAttempts(this.ctx.storage).get(attempt.id);}validate();return result;
  }
  async rebaseResumeCurrent(id:string){return new RebaseResumeAttempts(this.ctx.storage).get(id);}
  async assertRebaseResume(id:string,generation:number,workflowId:string){const {attempt,application,validate,receipt}=await this.authorizeSavedResume(id,generation,workflowId);const accountKey=await accountKeyFor(attempt.actor.userId);validate();return {application,snapshot:attempt.snapshot,actor:attempt.actor,accountKey,nativeRunId:attempt.nativeRunId,workflowId:attempt.workflowId,...(receipt?{receipt}:{})};}
  async markRebaseResumeDispatch(id:string,generation:number,state:RebaseResumeAttempt["dispatch"]){const attempt=new RebaseResumeAttempts(this.ctx.storage).get(id);if(!attempt)throw new RebaseRecoveryError("Saved resume missing",409);const {validate}=await this.authorizeSavedResume(id,generation,attempt.workflowId);validate();return new RebaseResumeAttempts(this.ctx.storage).dispatch(id,generation,state);}
  async rebaseResumeNativeIntent(id:string,generation:number,workflowId:string){const {validate}=await this.authorizeSavedResume(id,generation,workflowId);validate();return new RebaseResumeAttempts(this.ctx.storage).nativeIntent(id,generation);}
  async rebaseResumeNativeStopped(id:string,generation:number,nativeRunId:string){
    const attempts=new RebaseResumeAttempts(this.ctx.storage),attempt=attempts.get(id);if(!attempt||attempt.generation!==generation||attempt.nativeRunId!==nativeRunId)throw new RebaseRecoveryError("Native recovery identity changed",409);
    if(attempt.nativeState==="possible"){const sandbox=this.env.INTEGRATOR.getByName(nativeRunId);await sandbox.destroy();if((await sandbox.lifetimeStatus())?.state!=="stopped")throw new RebaseRecoveryError("Native recovery stop is unconfirmed",503);}
    return attempts.nativeStopped(id,generation,nativeRunId);
  }
  async observeRebaseResume(id:string,generation:number,actor?:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number){
    const attempts=new RebaseResumeAttempts(this.ctx.storage),attempt=attempts.get(id);if(!attempt||attempt.generation!==generation)throw new RebaseRecoveryError("Saved recovery generation changed",409);
    const authority=await this.authorizeRebaseRecovery(actor??attempt.actor,actor?credentialHash:attempt.credentialHash,actor?sessionExpiresAt:attempt.sessionExpiresAt);authority();const current=this.load();if(current.projectId!==attempt.scope.projectId||current.canonicalRepoName!==attempt.scope.canonicalRepoName||this.readRepositoryIncarnation()!==attempt.scope.incarnation)throw new RebaseRecoveryError("Saved recovery scope changed",409);
    if(!this.env.REBASE_RESUME_WORKFLOW)throw new RebaseRecoveryError("Saved recovery execution is unavailable",503);
    const instance=await this.env.REBASE_RESUME_WORKFLOW.get(attempt.workflowId),status=await instance.status();
    authority();const fresh=this.load(),latest=attempts.latest(attempt.applicationId);if(fresh.projectId!==attempt.scope.projectId||fresh.canonicalRepoName!==attempt.scope.canonicalRepoName||this.readRepositoryIncarnation()!==attempt.scope.incarnation||latest?.id!==id||latest.generation!==generation)throw new RebaseRecoveryError("Saved recovery observation scope changed",409);attempts.dispatch(id,generation,"observed");
    if(status.status==="complete"||status.status==="errored"||status.status==="terminated"){attempts.terminal(id,generation,status.status==="complete"?"completed":"failed");await this.rebaseResumeNativeStopped(id,generation,attempt.nativeRunId).catch(()=>undefined);return attempts.get(id)!;}
    return attempts.get(id)!;
  }
  async finishRebaseResume(id:string,generation:number,workflowId:string,proof:RebaseRecoveryProof):Promise<RebaseRecoveryReceipt>{
    const {attempt,application,validate,receipt}=await this.authorizeSavedResume(id,generation,workflowId);if(receipt)return receipt;
    // Caller proof is never sufficient: independently read all pinned objects and the branch.
    const accountKey=await accountKeyFor(attempt.actor.userId);
    const verified=await verifyRebaseRecovery(this.env.ARTIFACTS,application,{authorize:async()=>{await this.authorizeSavedResume(id,generation,workflowId);validate();},reserveGroup:operationId=>globalOf(this.env).reserveCoreGitOperation(operationId,accountKey,this.currentGitBudget())});
    if(JSON.stringify(verified)!==JSON.stringify(proof))throw new RebaseRecoveryError("Saved Git proof changed before recovery",409);
    validate();const applications=new RetainedInputs(this.ctx.storage),ledger=new RebaseRecoveryLedger(this.ctx.storage);
    try{return ledger.reconcile({application,snapshot:attempt.snapshot,proof:verified,actor:attempt.actor,expectedVersion:attempt.expectedVersion,idempotencyKey:attempt.requestId},plan=>{validate();const task=this.load().tasks[application.input.taskId]!;applications.remoteVerified(application.input.id,application.commit);applications.applyApplication(application.input.id,()=>{task.currentCommit=plan.commit;task.baseCommit=plan.base;if(plan.dependsOn===undefined)delete task.dependsOn;else task.dependsOn=plan.dependsOn;task.updatedAt=new Date().toISOString();this.save();});},validate);}catch(error){this.state=null;throw error;}
  }
  async prepareRebaseApplication(input:RetainedInput,commit:string,base:string,parentAccepted:boolean):Promise<RebaseApplication>{await this.authorizeRetainedInput(input);return this.ctx.storage.transactionSync(()=>{this.assertRetainedLocal(input);return new RetainedInputs(this.ctx.storage).prepareApplication(input,commit,base,parentAccepted);});}
  async recordRebaseRemoteOutcome(id:string,observedCommit:string):Promise<RebaseApplication>{const value=new RetainedInputs(this.ctx.storage).application(id);if(!value)throw new Error("Saved rebase application unavailable");await this.authorizeRetainedInput(value.input,false);return this.ctx.storage.transactionSync(()=>{this.assertRetainedLocal(value.input,false);return new RetainedInputs(this.ctx.storage).remoteVerified(id,observedCommit);});}
  async rebaseApplication(taskId:string,workflowId:string,candidateId:string,targetBase:string):Promise<RebaseApplication|null>{
    const ledger=new RetainedInputs(this.ctx.storage);const rows=this.ctx.storage.sql.exec<{doc:string}>("SELECT doc FROM rebase_applications WHERE json_extract(doc,'$.input.taskId')=? AND json_extract(doc,'$.input.workflowId')=? AND json_extract(doc,'$.input.candidateId')=? AND json_extract(doc,'$.base')=? ORDER BY rowid DESC LIMIT 1",taskId,workflowId,candidateId,targetBase).toArray();const value=rows[0]?JSON.parse(rows[0].doc) as RebaseApplication:null;if(!value)return null;await this.authorizeRetainedInput(value.input,false);this.assertRetainedLocal(value.input,false);return ledger.application(value.input.id);
  }
  /** Remote preservation must precede rewriting a contribution; never overwrite a newer checkpoint. */
  async applyRebase(taskId:string,r:{commit?:string;base?:string;parentAccepted?:boolean;failed?:string;expected?:RetainedInput;receiptId?:string;applicationId?:string}):Promise<void>{
    if(!r.expected||r.expected.followup||r.expected.taskId!==taskId)throw new Error("Frozen rebase input required");
    const expected=retainedInputSchema.parse(r.expected);
    const application=r.applicationId?new RetainedInputs(this.ctx.storage).application(r.applicationId):null;
    if(application&&(JSON.stringify(application.input)!==JSON.stringify(expected)||application.commit!==r.commit||application.base!==r.base||application.parentAccepted!==Boolean(r.parentAccepted)))throw new Error("Rebase application outcome changed");
    await this.authorizeRetainedInput(expected,application?.status!=="applied");
    if(application?.status==="applied")return;
    try{this.ctx.storage.transactionSync(()=>{
      this.assertRetainedLocal(expected);const task=this.load().tasks[taskId]!;
      if(r.failed){task.status="blocked";task.blockedReason=r.failed;}
      else if(r.commit&&r.base){
        if(!/^[a-f0-9]{40}$/.test(r.commit)||!/^[a-f0-9]{40}$/.test(r.base))throw new Error("Invalid rebased Git checkpoint");
        const receipt=r.receiptId?new RetainedInputs(this.ctx.storage).get(r.receiptId):null;
        if(!receipt||JSON.stringify(retainedInputSchema.parse((({verifiedAt:_verifiedAt,...value})=>value)(receipt)))!==JSON.stringify(expected))throw new Error("Confirmed retained input receipt required");
        if(!r.applicationId)throw new Error("Saved rebase application required");
        new RetainedInputs(this.ctx.storage).applyApplication(r.applicationId,()=>{task.currentCommit=r.commit!;task.baseCommit=r.base!;if(r.parentAccepted)delete task.dependsOn;if(task.status==="blocked"){task.status="working";delete task.blockedReason;}});
      }else throw new Error("Rebase outcome required");
      task.updatedAt=new Date().toISOString();this.save();
    });}catch(error){this.state=null;throw error;}
    await this.logActivity("FlareGit",r.failed?"stack.rebase_blocked":"stack.rebased",r.failed?`${taskId}: ${r.failed}`:`${taskId} was rebased onto its updated parent (${r.commit?.slice(0,7)})`);
  }
  /** True while an earlier event for the same webhook is still pending, so receivers see events in order. */
  async isBlocked(id: string): Promise<boolean> {
    const d = this.ctx.storage.sql.exec<{ webhook_id: string; seq: number }>("SELECT webhook_id, seq FROM deliveries WHERE id = ?", id).toArray()[0];
    if (!d || d.seq === 0) return false;
    return this.ctx.storage.sql.exec("SELECT 1 FROM deliveries WHERE webhook_id = ? AND seq < ? AND status = 'pending' LIMIT 1", d.webhook_id, d.seq).toArray().length > 0;
  }
  async redeliver(id: string): Promise<boolean> {
    const d = this.ctx.storage.sql.exec<{ id: string }>("SELECT id FROM deliveries WHERE id = ?", id).toArray()[0];
    if (!d) return false;
    this.ctx.storage.sql.exec("UPDATE deliveries SET status = 'pending', attempts = 0, last_error = NULL, updated_at = ? WHERE id = ?", new Date().toISOString(), id);
    await this.env.INTEGRATION_QUEUE.send({ type: "webhook.deliver", projectId: this.load().projectId, deliveryId: id });
    return true;
  }
  private stageEvent(type: (typeof WEBHOOK_EVENTS)[number], data: Record<string, unknown>, identity?:{id:string;createdAt:string}): string[] {
    const hooks = this.ctx.storage.sql.exec("SELECT id, events FROM webhooks WHERE active = 1").toArray() as unknown as Array<{ id: string; events: string }>;
    const s = this.load();
    const eventId = identity?.id ?? `evt_${crypto.randomUUID()}`;
    const payload = JSON.stringify({ id: eventId, type, createdAt: identity?.createdAt ?? new Date().toISOString(), project: { id: s.projectId, name: s.projectName }, data });
    const ids: string[] = [];
    for (const h of hooks) {
      if (!h.events.split(",").includes(type)) continue;
      const deliveryId = `dlv_${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const seq = this.ctx.storage.sql.exec<{ n: number }>("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM deliveries WHERE webhook_id = ?", h.id).toArray()[0]?.n ?? 1;
      this.ctx.storage.sql.exec("INSERT INTO deliveries (id, seq, webhook_id, event, status, attempts, payload, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)", deliveryId, seq, h.id, type, payload, now, now);
      ids.push(deliveryId);
    }
    // Retention never touches undelivered events: only finished rows beyond the newest 500 are pruned.
    this.ctx.storage.sql.exec("DELETE FROM deliveries WHERE status != 'pending' AND id IN (SELECT id FROM deliveries WHERE status != 'pending' ORDER BY created_at DESC LIMIT -1 OFFSET 500)");
    return ids;
  }

  /** Recovery sweep: re-send deliveries whose queue message was never sent or was lost, until none are pending. */
  override async alarm(): Promise<void> {
    await this.reconcileLegacyPublicationReadbacks();
    await this.retryRetainedCredentialIncidents();
    await this.retryRebaseResumeCredentials();
    await this.retryPreviewCredentialIncidents();
    await this.reconcileDirectoryRegistration();
    await this.reconcileContributorRegistrations();
    const now = Date.now();
    const stuck = this.ctx.storage.sql
      .exec<{ id: string; attempts: number; updated_at: string; created_at: string }>("SELECT id, attempts, updated_at, created_at FROM deliveries WHERE status = 'pending' ORDER BY seq")
      .toArray()
      .filter((d) => (d.attempts === 0 ? now - Date.parse(d.created_at) > 2 * 60_000 : now - Date.parse(d.updated_at) > 70 * 60_000));
    if (stuck.length > 0) {
      const projectId = this.load().projectId;
      for (const d of stuck) {
        this.ctx.storage.sql.exec("UPDATE deliveries SET updated_at = ? WHERE id = ?", new Date().toISOString(), d.id);
        await this.env.INTEGRATION_QUEUE.send({ type: "webhook.deliver", projectId, deliveryId: d.id }).catch(() => undefined);
      }
    }
    const pending = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM deliveries WHERE status = 'pending'").toArray()[0]?.n ?? 0;
    if (pending > 0) await this.ensureRecoveryAlarm(5 * 60_000);
  }


  async beginArtifactAllocation(input:Omit<PendingArtifactAllocation,"phase">,scope:"account"|"project"):Promise<void>{new ArtifactAllocationFence(this.ctx.storage).begin(input,()=>scope==="account"?this.accountLifecycleState()==="active":!this.repositoryDeleting());}
  async activateArtifactAllocation(name:string,operationId:string,scope:"account"|"project"):Promise<void>{new ArtifactAllocationFence(this.ctx.storage).activate(name,operationId,()=>scope==="account"?this.accountLifecycleState()==="active":!this.repositoryDeleting());}
  async settleArtifactAllocation(name:string,operationId:string):Promise<void>{new ArtifactAllocationFence(this.ctx.storage).settle(name,operationId);}
  async pendingArtifactAllocations():Promise<PendingArtifactAllocation[]>{return new ArtifactAllocationFence(this.ctx.storage).pending();}
  async reconcileArtifactInventory(namespace:string,names:string[]):Promise<void>{new ArtifactStorageAdmission(this.ctx.storage).reconcileCompleteInventory(namespace,names);}
  async claimArtifactExisting(name:string,userId:string,kind:ArtifactKind,projectId:string):Promise<void>{
    const project=projectOf(this.env,projectId),accountKey=await accountKeyFor(userId);let verified=false;
    if(await project.roleOf(userId).catch(()=>null)==="owner") {const state=await project.getState().catch(()=>null);verified=!!state&&(kind==="canonical"?state.canonicalRepoName===name:kind==="workspace"&&Object.values(state.tasks).some(task=>task.workspace.repoName===name));}
    if(!verified&&kind==="workspace"){const state=await project.getState().catch(()=>null);const task=state&&Object.values(state.tasks).find(task=>task.workspace.repoName===name);verified=!!task&&await project.canGitAccess(userId,task.id,true);}
    if(!verified&&kind==="import"){const job=await accountOf(this.env,accountKey).getImportJob(projectId);verified=!!job&&job.ownerId===userId&&job.canonicalRepoName===name;}
    if(!verified)throw new Error("Existing storage ownership is unverified");
    const ledger=new ArtifactStorageAdmission(this.ctx.storage);ledger.claimVerifiedExisting(name,accountKey,kind,true);ledger.associateProject(name,projectId);
  }
  async reserveArtifactStorage(name:string,owner:string,kind:ArtifactKind,projectId:string,policy:StorageAdmissionPolicy):Promise<StorageReservation>{
    const ledger=new ArtifactStorageAdmission(this.ctx.storage);
    return this.ctx.storage.transactionSync(()=>{const result=ledger.reserve(name,owner,kind,policy);if(result.allowed)ledger.associateProject(name,projectId);return result;});
  }
  async recordArtifactDeletion(name:string,confirmed:boolean):Promise<void>{new ArtifactStorageAdmission(this.ctx.storage).recordConfirmedDeletion(name,confirmed);}
  async artifactProjectManifest(projectId:string):Promise<Array<{name:string;state:string}>>{return new ArtifactStorageAdmission(this.ctx.storage).projectManifest(projectId);}
  async artifactOwnerManifest(owner:string):Promise<Array<{name:string;state:string;projectId:string|null}>>{return new ArtifactStorageAdmission(this.ctx.storage).ownerManifest(owner);}
  async artifactStorageSnapshot():Promise<ReturnType<ArtifactStorageAdmission["snapshot"]>>{return new ArtifactStorageAdmission(this.ctx.storage).snapshot();}

  private gitTables(): void {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS git_task_writers(task_id TEXT PRIMARY KEY,user_id TEXT NOT NULL)");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS git_capabilities(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,task_id TEXT,write_access INTEGER NOT NULL,expires_at INTEGER NOT NULL,parent_token_hash TEXT)");
  }
  async canGitAccess(userId: string, taskId: string | null, write: boolean): Promise<boolean> {
    if (this.repositoryDeleting()) return false;
    const role=await this.roleOf(userId); if(!role)return false;
    if(taskId===null)return !write;
    const task=this.load().tasks[taskId];if(!task)return false;
    if(!write)return true;
    if(task.status==="accepted"||task.status==="cancelled")return false;
    this.gitTables();
    return role==="owner"||this.ctx.storage.sql.exec<{user_id:string}>("SELECT user_id FROM git_task_writers WHERE task_id=?",taskId).toArray()[0]?.user_id===userId;
  }
  async mintGitCapability(userId: string, taskId: string | null, write: boolean, parentTokenHash?: string): Promise<{token:string;expiresInSeconds:number}> {
    if(!(await this.canGitAccess(userId,taskId,write)))throw new Error("Git access denied");
    this.gitTables();this.ctx.storage.sql.exec("DELETE FROM git_capabilities WHERE expires_at<=?",Date.now());
    if((this.ctx.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM git_capabilities").toArray()[0]?.n??0)>=1000)throw new Error("Git capability limit reached");
    if((this.ctx.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM git_capabilities WHERE user_id=?",userId).toArray()[0]?.n??0)>=50)throw new Error("Active Git capability limit reached; existing credentials remain usable until expiry");
    const token=`fgg_${this.load().projectId}_${crypto.randomUUID().replaceAll("-","")}${crypto.randomUUID().replaceAll("-","")}`;
    const hash=await this.sha256(token);if(!(await this.canGitAccess(userId,taskId,write)))throw new Error("Git access changed");
    this.ctx.storage.sql.exec("INSERT INTO git_capabilities VALUES(?,?,?,?,?,?)",hash,userId,taskId,write?1:0,Date.now()+3600_000,parentTokenHash??null);
    return {token,expiresInSeconds:3600};
  }
  async verifyGitCapability(secret:string,taskId:string|null,write:boolean):Promise<{userId:string;parentTokenHash:string|null}|null>{
    this.gitTables(); const hash=await this.sha256(secret);
    const row=this.ctx.storage.sql.exec<{user_id:string;task_id:string|null;write_access:number;expires_at:number;parent_token_hash:string|null}>("SELECT * FROM git_capabilities WHERE hash=?",hash).toArray()[0];
    if(!row||row.expires_at<=Date.now()||row.task_id!==taskId||(write&&!row.write_access)||!(await this.canGitAccess(row.user_id,taskId,write)))return null;
    return {userId:row.user_id,parentTokenHash:row.parent_token_hash};
  }
  async revokeGitCapabilities(userId:string):Promise<void>{
    this.gitTables();this.ctx.storage.sql.exec("DELETE FROM git_capabilities WHERE user_id=?",userId);
  }
  async apiTokenHashActive(hash:string):Promise<boolean>{
    if(!/^[a-f0-9]{64}$/.test(hash))return false;
    return this.ctx.storage.sql.exec("SELECT id FROM api_tokens WHERE hash=? AND (expires_at IS NULL OR expires_at>?)",hash,Date.now()).toArray().length===1;
  }

  async apiTokenHashCanRead(hash:string,userId:string,projectId:string,write=false):Promise<boolean>{
    if(!/^[a-f0-9]{64}$/.test(hash)||this.accountLifecycleState()!=="active")return false;
    return this.ctx.storage.sql.exec("SELECT id FROM api_tokens WHERE hash=? AND user_id=? AND scope IN ("+(write?"'write','full'":"'read','write','full'")+") AND (repo IS NULL OR repo=?) AND (expires_at IS NULL OR expires_at>?)",hash,userId,projectId,Date.now()).toArray().length===1;
  }
  async apiTokenHashCanAdminister(hash: string, userId: string, projectId: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(hash) || this.accountLifecycleState() !== "active") return false;
    return this.ctx.storage.sql.exec("SELECT id FROM api_tokens WHERE hash=? AND user_id=? AND scope='full' AND (repo IS NULL OR repo=?) AND (expires_at IS NULL OR expires_at>?)",hash,userId,projectId,Date.now()).toArray().length === 1;
  }

  // ---- personal API tokens (stored as SHA-256 hashes; the secret is shown once) ----
  private async sha256(value: string): Promise<string> {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async createApiToken(userId: string, label: string, secret: string, opts: TokenScope = { scope: "full" }): Promise<{ id: string }> {
    this.ctx.storage.sql.exec("DELETE FROM api_tokens WHERE expires_at IS NOT NULL AND expires_at < ?", Date.now());
    const count = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM api_tokens").toArray()[0]?.n ?? 0;
    if (count >= 50) throw new Error("Token limit reached (50). Revoke one first.");
    const id = `tok_${crypto.randomUUID().slice(0, 8)}`;
    this.ctx.storage.sql.exec(
      "INSERT INTO api_tokens (id, hash, user_id, label, created_at, scope, repo, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      id, await this.sha256(secret), userId, label.slice(0, 60), new Date().toISOString(), opts.scope, opts.repo ?? null, opts.expiresAt ?? null
    );
    return { id };
  }
  async listApiTokens(): Promise<ApiTokenRow[]> {
    return this.ctx.storage.sql
      .exec("SELECT id, label, created_at, last_used, scope, repo, expires_at FROM api_tokens WHERE expires_at IS NULL OR expires_at > ? ORDER BY created_at DESC", Date.now())
      .toArray() as unknown as ApiTokenRow[];
  }
  async revokeApiToken(id: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM api_tokens WHERE id = ?", id);
  }
  async verifyApiToken(secret: string): Promise<{ userId: string; scope: TokenScope["scope"]; repo: string | null } | null> {
    const row = this.ctx.storage.sql
      .exec<{ id: string; user_id: string; scope: TokenScope["scope"]; repo: string | null; expires_at: number | null }>("SELECT id, user_id, scope, repo, expires_at FROM api_tokens WHERE hash = ?", await this.sha256(secret))
      .toArray()[0];
    if (!row || (row.expires_at !== null && row.expires_at < Date.now())) return null;
    this.ctx.storage.sql.exec("UPDATE api_tokens SET last_used = ? WHERE id = ?", new Date().toISOString(), row.id);
    return { userId: row.user_id, scope: row.scope, repo: row.repo };
  }

  // ---- platform health (used on the global instance) ----
  async recordProbe(component: string, ok: boolean, latencyMs?: number, detail?: string): Promise<void> {
    this.ctx.storage.sql.exec("INSERT INTO probes (component, at, ok, latency_ms, detail) VALUES (?, ?, ?, ?, ?)", component, Date.now(), ok ? 1 : 0, latencyMs ?? null, detail ? detail.slice(0, 200) : null);
    this.ctx.storage.sql.exec("DELETE FROM probes WHERE at < ?", Date.now() - 7 * 86_400_000);
  }
  /** One lifecycle row per workflow instance; replayed starts cannot erase terminal evidence. */
  async recordWorkflowOutcome(kind: WorkflowKind, instanceId: string, status: WorkflowOutcome): Promise<void> {
    if (!["agent", "integration"].includes(kind) || !instanceId || instanceId.length > 256 || !["started", "awaiting_review", "completed", "skipped", "accepted", "needs_decision", "not_started", "blocked", "stale", "rejected", "failed"].includes(status)) throw new Error("Invalid workflow outcome");
    const now = Date.now();
    this.ctx.storage.sql.exec("INSERT INTO workflow_runs (kind, instance_id, status, started_at, finished_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind, instance_id) DO UPDATE SET status = excluded.status, finished_at = excluded.finished_at WHERE workflow_runs.finished_at IS NULL AND (excluded.status != 'started' OR workflow_runs.status = 'started')", kind, instanceId, status, now, status === "started" || status === "awaiting_review" ? null : now);
    // Keep outstanding starts: an interrupted run remains visible rather than aging into success.
    this.ctx.storage.sql.exec("DELETE FROM workflow_runs WHERE finished_at < ?", now - 7 * 86_400_000);
  }
  async workflowCounts(sinceMs: number): Promise<WorkflowCount[]> {
    return this.ctx.storage.sql.exec("SELECT kind, status, COUNT(*) AS count FROM workflow_runs WHERE finished_at >= ? OR finished_at IS NULL GROUP BY kind, status", sinceMs).toArray() as unknown as WorkflowCount[];
  }
  /** Repository ownership of run IDs is durable and independent of global health telemetry. */
  async listRepositoryWorkflows(): Promise<Array<{ instanceId: string; kind: "agent" | "integration" | "scenario" }>> {
    const state = this.load(true);
    const rows = this.ctx.storage.sql.exec<{ instanceId: string; kind: "agent" | "integration" | "scenario" }>("SELECT instance_id AS instanceId, kind FROM project_workflows").toArray();
    const byId = new Map(rows.map((row) => [row.instanceId, row]));
    for (const candidate of Object.values(state.candidates)) if (candidate.workflowInstanceId) byId.set(candidate.workflowInstanceId, { instanceId: candidate.workflowInstanceId, kind: "integration" });
    for (const task of Object.values(state.tasks)) if (task.agentWorkflowInstanceId) byId.set(task.agentWorkflowInstanceId, { instanceId: task.agentWorkflowInstanceId, kind: "agent" });
    return [...byId.values()];
  }
  async registerWorkflow(instanceId: string, kind: "agent" | "integration" | "scenario", taskId?: string, actorId?: string, nativeRuntimeProtocolVersion?:1): Promise<void> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(instanceId) || !["agent", "integration", "scenario"].includes(kind)) throw new Error("Invalid workflow registration");
    const state = this.load();
    if (taskId && (kind !== "agent" || !state.tasks[taskId])) throw new Error("Unknown agent change");
    const old = await this.getWorkflowRun(instanceId);
    if (old && old.kind !== kind) throw new Error("Workflow kind differs from its saved registration");
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO project_workflows (instance_id, kind, actor_id,native_protocol) VALUES (?, ?, ?,?)", instanceId, kind, actorId ?? null,kind==="integration"&&nativeRuntimeProtocolVersion===1?1:null);
    if (taskId) {
      state.tasks[taskId]!.agentWorkflowInstanceId = instanceId;
      this.save();
    }
  }
  private integrationDispatchTable(): void {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS integration_dispatch_receipts(event_id TEXT PRIMARY KEY,payload TEXT NOT NULL,actor_id TEXT,outcome TEXT,terminal INTEGER NOT NULL DEFAULT 0)");
  }
  async admitIntegrationDispatch(eventId: string, taskIds: string[]): Promise<{terminal:boolean;actorId:string|null}> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(eventId) || !Array.isArray(taskIds) || taskIds.length < 1 || taskIds.length > 8 || new Set(taskIds).size !== taskIds.length || !taskIds.every(id => typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,100}$/.test(id))) throw new Error("Invalid integration dispatch identity");
    this.integrationDispatchTable();
    const payload = JSON.stringify(taskIds);
    const admission = this.ctx.storage.transactionSync(() => {
      const old = this.ctx.storage.sql.exec<{payload:string;actor_id:string|null;terminal:number}>("SELECT payload,actor_id,terminal FROM integration_dispatch_receipts WHERE event_id=?",eventId).toArray()[0];
      if (old) {
        if (old.payload !== payload) throw new Error("Integration event was already bound to different changes");
        if (!old.terminal && this.repositoryDeleting()) throw new Error("Integration dispatch is blocked by repository deletion");
        return { terminal: old.terminal === 1, actorId: old.actor_id };
      }
      const run = this.ctx.storage.sql.exec<{kind:string;actor_id:string|null}>("SELECT kind,actor_id FROM project_workflows WHERE instance_id=?",eventId).toArray()[0];
      if (!run || run.kind !== "integration" || this.repositoryDeleting()) throw new Error("Integration dispatch registration is unavailable");
      const state = this.load();
      if (!taskIds.every(id => !!state.tasks[id])) throw new Error("Integration changes are unavailable");
      this.ctx.storage.sql.exec("INSERT INTO integration_dispatch_receipts(event_id,payload,actor_id) VALUES(?,?,?)",eventId,payload,run.actor_id);
      return { terminal: false, actorId: run.actor_id };
    });
    if (admission.terminal) return admission;
    if (!admission.actorId) throw new Error("Integration dispatch has no accountable requesting contributor");
    const accountKey = await accountKeyFor(admission.actorId);
    const active = await accountOf(this.env,accountKey).accountLifecycle() === "active";
    const latest = this.ctx.storage.sql.exec<{actor_id:string|null;terminal:number}>("SELECT actor_id,terminal FROM integration_dispatch_receipts WHERE event_id=?",eventId).one();
    if (latest.terminal) return { terminal: true, actorId: latest.actor_id };
    if (!active) throw new Error("Integration requesting account is unavailable");
    const role = this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",admission.actorId).toArray()[0]?.role;
    if (this.repositoryDeleting() || (role !== "owner" && role !== "member")) throw new Error("Integration requesting contributor no longer has repository access");
    return admission;
  }
  async recordIntegrationDispatchOutcome(eventId: string, status: WorkflowOutcome): Promise<void> {
    const known: WorkflowOutcome[] = ["started","awaiting_review","completed","skipped","accepted","needs_decision","not_started","blocked","stale","rejected","failed"];
    if (!known.includes(status)) throw new Error("Invalid integration outcome");
    this.integrationDispatchTable();
    const uncertain=Object.values(this.load().candidates).some(candidate=>candidate.workflowInstanceId===eventId&&this.legacyPreparedPublication(candidate.id));
    if(uncertain){await this.ensureRecoveryAlarm();return;}
    this.ctx.storage.transactionSync(() => {
      const old = this.ctx.storage.sql.exec<{outcome:WorkflowOutcome|null;terminal:number}>("SELECT outcome,terminal FROM integration_dispatch_receipts WHERE event_id=?",eventId).toArray()[0];
      if (!old) throw new Error("Integration dispatch identity was not admitted");
      const terminal = status !== "started" && status !== "awaiting_review";
      if (old.terminal) {
        if (terminal && old.outcome !== status) throw new Error("A terminal integration outcome cannot be replaced");
        return;
      }
      if (old.outcome === "awaiting_review" && status === "started") return;
      this.ctx.storage.sql.exec("UPDATE integration_dispatch_receipts SET outcome=?,terminal=? WHERE event_id=?",status,terminal?1:0,eventId);
    });
  }
  async assertWorkflowControlAuthority(context:RepositoryReadContext,userId:string,run:OwnedWorkflow,mutation:boolean,viaToken:boolean,credentialHash?:string,sessionExpiresAt?:number):Promise<boolean>{
    try{
      if(viaToken&&!credentialHash)return false;
      if(!await this.assertRepositoryReadContext(context,userId,null,credentialHash))return false;
      let fullAuthority=!viaToken;
      if(viaToken&&mutation){const account=accountOf(this.env,await accountKeyFor(userId));if(!await account.apiTokenHashCanRead(credentialHash!,userId,context.projectId,true))return false;fullAuthority=await account.apiTokenHashCanAdminister(credentialHash!,userId,context.projectId);}
      this.assertReadLocal(context,userId,null);
      const role=this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",userId).toArray()[0]?.role;
      const row=this.ctx.storage.sql.exec<{instance_id:string;kind:string;actor_id:string|null}>("SELECT instance_id,kind,actor_id FROM project_workflows WHERE instance_id=?",run.instanceId).toArray()[0];
      const fallback=!row?Object.values(this.load().candidates).find(candidate=>candidate.workflowInstanceId===run.instanceId):undefined;
      const current=row?{instanceId:row.instance_id,kind:row.kind,actorId:row.actor_id}:fallback?{instanceId:run.instanceId,kind:"integration",actorId:null}:null;
      if(!role||!current||current.instanceId!==run.instanceId||current.kind!==run.kind||current.actorId!==run.actorId)return false;
      if(!viaToken&&(!Number.isFinite(sessionExpiresAt)||Date.now()>=sessionExpiresAt!))return false;
      return !mutation||(role==="owner"&&fullAuthority)||(run.kind==="agent"&&run.actorId===userId);
    }catch{return false;}
  }
  async getWorkflowRun(instanceId: string): Promise<{ instanceId: string; kind: "agent" | "integration" | "scenario"; actorId: string | null } | null> {
    const registered = this.ctx.storage.sql.exec<{ instanceId: string; kind: "agent" | "integration" | "scenario"; actorId: string | null }>("SELECT instance_id AS instanceId, kind, actor_id AS actorId FROM project_workflows WHERE instance_id = ?", instanceId).toArray()[0];
    if (registered) return registered;
    // Older review candidates already persist their exact instance ownership.
    const candidate = Object.values(this.load().candidates).find((value) => value.workflowInstanceId === instanceId);
    return candidate ? { instanceId, kind: "integration", actorId: null } : null;
  }
  async beginAgentTask(taskId: string, runId?: string): Promise<boolean> {
    const state = this.load();
    const task = state.tasks[taskId];
    if (!task || ["accepted", "cancelled", "integrating", "verifying"].includes(task.status)) return false;
    if (task.status === "working" && task.agentWorkflowInstanceId && task.agentWorkflowInstanceId !== runId) return false;
    const active = task.agentRunId ? this.agentRuns().get(task.agentRunId) : null;
    if (active && !["checkpointed", "failed"].includes(active.phase) && active.runId !== runId) return false;
    if (runId) task.agentWorkflowInstanceId = runId;
    task.initiatedBy ??= task.contributor;
    task.contributor = { id: `agent-${taskId}`, name: "FlareGit agent", type: "agent" };
    task.status = "working";
    delete task.blockedReason;
    task.updatedAt = new Date().toISOString();
    this.save();
    return true;
  }
  /** Raw facts per component: was it degraded, how many checks failed, for how long. No averaged uptime percentage. */
  /** Raw probe rows (newest last) so incidents can be derived from evidence rather than written by hand. */
  async listProbes(sinceMs: number): Promise<Array<{ component: string; at: number; ok: number; latency_ms: number | null; detail: string | null }>> {
    return this.ctx.storage.sql.exec("SELECT component, at, ok, latency_ms, detail FROM probes WHERE at >= ? ORDER BY at", sinceMs).toArray() as unknown as Array<{ component: string; at: number; ok: number; latency_ms: number | null; detail: string | null }>;
  }
  async statusSummary(): Promise<ComponentStatus[]> {
    const since = Date.now() - 86_400_000;
    const rows = this.ctx.storage.sql.exec("SELECT component, at, ok, detail FROM probes WHERE at >= ? ORDER BY at", since).toArray() as unknown as Array<{ component: string; at: number; ok: number; detail: string | null }>;
    const by = new Map<string, typeof rows>();
    for (const r of rows) by.set(r.component, [...(by.get(r.component) ?? []), r]);
    return [...by.entries()].map(([component, list]) => {
      const failures = list.filter((r) => !r.ok);
      let degradedMs = 0;
      for (let i = 0; i < list.length; i++) {
        if (!list[i]!.ok) degradedMs += (list[i + 1]?.at ?? Date.now()) - list[i]!.at;
      }
      const last = list[list.length - 1];
      return {
        component,
        degradedNow: last ? !last.ok : false,
        lastCheckAt: last?.at ?? null,
        checks24h: list.length,
        failed24h: failures.length,
        lastFailureAt: failures[failures.length - 1]?.at ?? null,
        lastFailureDetail: failures[failures.length - 1]?.detail ?? null,
        degradedMinutes24h: Math.round(degradedMs / 60_000),
      };
    });
  }

  // ---- activity feed ----
  async logActivity(actor: string, type: string, summary: string, opts?: { exceptUser?: string }): Promise<void> {
    this.ctx.storage.sql.exec("INSERT INTO activity (at, actor, type, summary) VALUES (?, ?, ?, ?)", new Date().toISOString(), actor, type, summary.slice(0, 300));
    this.ctx.storage.sql.exec("DELETE FROM activity WHERE id <= (SELECT MAX(id) FROM activity) - 500");
    await this.notifyMembers(type, summary, opts?.exceptUser);
  }

  /**
   * Fans an activity out to every member's inbox. Things that need a person (a change to review, a decision,
   * a blocked landing or stack) are "direct"; everything else is repository chatter kept apart from them.
   */
  private async notifyMembers(type: string, summary: string, exceptUser?: string): Promise<void> {
    const DIRECT = new Set(["integration.not_started", "mirror.failed", "review.requested", "task.ready", "decision.needed", "integration.blocked", "integration.stale", "stack.rebase_blocked"]);
    const CHATTER = new Set(["issue.opened", "issue.closed", "comment.added", "review.approved", "review.rejected", "integration.accepted", "stack.rebased", "member.joined", "task.created"]);
    if (!DIRECT.has(type) && !CHATTER.has(type)) return;
    const s = this.state ?? (() => { try { return this.load(); } catch { return null; } })();
    if (!s) return;
    const members = this.ctx.storage.sql.exec<{ user_id: string }>("SELECT user_id FROM members").toArray();
    await Promise.all(
      members
        .filter((m) => !exceptUser || !m.user_id.endsWith(exceptUser))
        .map(async (m) => {
          const account = accountOf(this.env, await accountKeyFor(m.user_id));
          await account.addInbox({ projectId: s.projectId, projectName: s.projectName, kind: DIRECT.has(type) ? "direct" : "activity", type, title: summary.slice(0, 200) }).catch(() => undefined);
        })
    );
  }

  // ---- issues and conversations (per project) ----
  private issueRow(n: number): IssueRow | null {
    const row = this.ctx.storage.sql
      .exec("SELECT i.*, (SELECT COUNT(*) FROM comments c WHERE c.subject = 'issue:' || i.number) AS comments FROM issues i WHERE number = ?", n)
      .toArray()[0];
    return (row as unknown as IssueRow) ?? null;
  }
  async listIssues(state: "open" | "closed"): Promise<IssueRow[]> {
    return this.ctx.storage.sql
      .exec("SELECT i.*, (SELECT COUNT(*) FROM comments c WHERE c.subject = 'issue:' || i.number) AS comments FROM issues i WHERE state = ? ORDER BY number DESC LIMIT 200", state)
      .toArray() as unknown as IssueRow[];
  }
  async getIssue(n: number): Promise<IssueRow | null> {
    return this.issueRow(n);
  }
  async createMemberIssue(userId:string,input:MemberIssueInput):Promise<IssueRow>{
    if(typeof input.title!=="string"||typeof input.body!=="string"||typeof input.author!=="string"||!input.title.trim()||input.title.trim().length>200||input.body.trim().length>20_000||!input.author.trim()||input.author.trim().length>120)throw new Error("Invalid issue creation content");
    const normalized={...input,title:input.title.trim(),body:input.body.trim(),author:input.author.trim()};
    let opened=false;
    const issue=this.ctx.storage.transactionSync(()=>{
      if(this.repositoryDeleting()||!this.ctx.storage.sql.exec("SELECT 1 FROM members WHERE user_id=?",userId).toArray().length)throw new Error("Issue creation access was revoked");
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(normalized.idempotencyKey))throw new Error("Invalid issue creation request key");
      const payload=JSON.stringify([normalized.title,normalized.body]);
      const receipt=this.ctx.storage.sql.exec<{payload:string;issue_number:number}>("SELECT payload,issue_number FROM member_issue_receipts WHERE actor_id=? AND event_key=?",userId,normalized.idempotencyKey).toArray()[0];
      if(receipt){if(receipt.payload!==payload)throw new Error("Issue creation request key was used for different content");const existing=this.issueRow(receipt.issue_number);if(!existing)throw new Error("The recorded issue is unavailable; it cannot be recreated with this request key");return existing;}
      const at=new Date().toISOString();
      const number=this.ctx.storage.sql.exec<{number:number}>("INSERT INTO issues(title,body,author,created_at,updated_at) VALUES(?,?,?,?,?) RETURNING number",normalized.title,normalized.body,normalized.author,at,at).one().number;
      this.ctx.storage.sql.exec("INSERT INTO member_issue_receipts VALUES(?,?,?,?)",userId,normalized.idempotencyKey,payload,number);
      this.ctx.storage.sql.exec("INSERT INTO activity(at,actor,type,summary) VALUES(?,?,?,?)",at,normalized.author,"issue.opened",`#${number} opened: ${normalized.title}`.slice(0,300));opened=true;
      return this.issueRow(number)!;
    });
    if(opened)await this.notifyMembers("issue.opened",`#${issue.number} opened: ${issue.title}`).catch(()=>undefined);
    return issue;
  }
  async createIssue(i: { title: string; body: string; author: string }): Promise<IssueRow> {
    const now = new Date().toISOString();
    const n = this.ctx.storage.sql.exec<{ number: number }>("INSERT INTO issues (title, body, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING number", i.title, i.body, i.author, now, now).toArray()[0]!.number;
    await this.logActivity(i.author, "issue.opened", `#${n} opened: ${i.title}`);
    return this.issueRow(n)!;
  }
  async setIssueState(n: number, state: "open" | "closed", by: string): Promise<IssueRow | null> {
    if (!this.issueRow(n)) return null;
    this.ctx.storage.sql.exec("UPDATE issues SET state = ?, updated_at = ?, closed_by = ? WHERE number = ?", state, new Date().toISOString(), state === "closed" ? by : null, n);
    await this.logActivity(by, state === "closed" ? "issue.closed" : "issue.reopened", `#${n} ${state === "closed" ? "closed" : "reopened"} by ${by}`);
    return this.issueRow(n);
  }
  async listComments(subject: string): Promise<CommentRow[]> {
    return this.ctx.storage.sql.exec('SELECT id, subject, author, body, path, line, "commit", created_at FROM comments WHERE subject = ? ORDER BY id LIMIT 500', subject).toArray() as unknown as CommentRow[];
  }
  async listMemberCommentsPage(userId: string, subject: string, cursor?: string): Promise<CommentPage> {
    if (this.repositoryDeleting() || !this.ctx.storage.sql.exec("SELECT 1 FROM members WHERE user_id=?", userId).toArray().length) throw new Error("Comment access was revoked");
    let before = Number.MAX_SAFE_INTEGER;
    if (cursor !== undefined) {
      try {
        if (!/^[A-Za-z0-9_-]{1,600}$/.test(cursor)) throw new Error();
        const parsed = JSON.parse(atob(cursor.replaceAll("-", "+").replaceAll("_", "/"))) as unknown;
        if (!Array.isArray(parsed) || parsed.length !== 2 || parsed[0] !== subject || !Number.isSafeInteger(parsed[1]) || parsed[1] <= 0 || btoa(JSON.stringify(parsed)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") !== cursor) throw new Error();
        before = parsed[1];
      } catch { throw new Error("Invalid comment cursor"); }
    }
    const rows = this.ctx.storage.sql.exec('SELECT id,subject,author,body,path,line,"commit",created_at FROM comments WHERE subject=? AND id<? ORDER BY id DESC LIMIT 101', subject, before).toArray() as unknown as CommentRow[];
    const page = rows.slice(0,100);
    const nextCursor = rows.length > 100 ? btoa(JSON.stringify([subject,page.at(-1)!.id])).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") : null;
    return { comments: page.reverse(), nextCursor, hasMore: nextCursor !== null };
  }
  async addMemberComment(userId: string, input: MemberCommentInput): Promise<CommentRow> {
    return this.ctx.storage.transactionSync(() => {
      if (this.repositoryDeleting() || !this.ctx.storage.sql.exec("SELECT 1 FROM members WHERE user_id=?",userId).toArray().length) throw new Error("Comment access was revoked");
      const payload = JSON.stringify([input.subject,input.body,input.path ?? null,input.line ?? null,input.commit ?? null]);
      if (input.idempotencyKey) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.idempotencyKey)) throw new Error("Invalid comment request key");
        const receipt=this.ctx.storage.sql.exec<{payload:string;comment_id:number}>("SELECT payload,comment_id FROM member_comment_receipts WHERE actor_id=? AND event_key=?",userId,input.idempotencyKey).toArray()[0];
        if(receipt){
          if(receipt.payload!==payload)throw new Error("Comment request key was used for different content");
          const existing=this.ctx.storage.sql.exec('SELECT id,subject,author,body,path,line,"commit",created_at FROM comments WHERE id=?',receipt.comment_id).toArray()[0] as unknown as CommentRow | undefined;
          if(!existing)throw new Error("The recorded comment is unavailable; it cannot be recreated with this request key");
          return existing;
        }
      }
      const document=this.ctx.storage.sql.exec<{doc:string}>("SELECT doc FROM project WHERE id=1").toArray()[0];
      if(!document)throw new Error("Unknown comment subject");
      const current=JSON.parse(document.doc) as FlareGitProjectState;
      const [kind,target]=input.subject.split(":");
      const task=kind==="change" && target ? current.tasks[target] : undefined;
      const candidate=kind==="candidate" && target ? current.candidates[target] : undefined;
      const knownSubject=kind==="issue" ? !!this.ctx.storage.sql.exec("SELECT 1 FROM issues WHERE number=?",Number(target)).toArray().length : Boolean(task || candidate);
      if(!knownSubject)throw new Error("Unknown comment subject");
      if(input.commit){const known=task ? [task.baseCommit,task.currentCommit,...task.checkpoints.map(checkpoint=>checkpoint.commitHash)].includes(input.commit) : candidate ? candidate.candidateCommit===input.commit : current.acceptedState.currentCommit===input.commit || current.acceptedState.history.some(record=>record.commit===input.commit);if(!known)throw new Error("Comment revision is no longer recorded for this subject");}
      const at=new Date().toISOString();
      const id=this.ctx.storage.sql.exec<{id:number}>('INSERT INTO comments(subject,author,body,path,line,"commit",created_at) VALUES(?,?,?,?,?,?,?) RETURNING id',input.subject,input.author,input.body,input.path ?? null,input.line ?? null,input.commit ?? null,at).one().id;
      if(input.idempotencyKey)this.ctx.storage.sql.exec("INSERT INTO member_comment_receipts VALUES(?,?,?,?)",userId,input.idempotencyKey,payload,id);
      if(input.subject.startsWith("issue:"))this.ctx.storage.sql.exec("UPDATE issues SET updated_at=? WHERE number=?",at,Number(input.subject.slice(6)));
      this.ctx.storage.sql.exec("INSERT INTO activity(at,actor,type,summary) VALUES(?,?,?,?)",at,input.author,"comment.added",input.author+" commented on "+input.subject.replace(":"," "));
      return this.ctx.storage.sql.exec('SELECT id,subject,author,body,path,line,"commit",created_at FROM comments WHERE id=?',id).one() as unknown as CommentRow;
    });
  }
  async addComment(c: { subject: string; author: string; body: string; path?: string; line?: number; commit?: string }): Promise<CommentRow> {
    const id = this.ctx.storage.sql
      .exec<{ id: number }>('INSERT INTO comments (subject, author, body, path, line, "commit", created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id', c.subject, c.author, c.body, c.path ?? null, c.line ?? null, c.commit ?? null, new Date().toISOString())
      .toArray()[0]!.id;
    if (c.subject.startsWith("issue:")) this.ctx.storage.sql.exec("UPDATE issues SET updated_at = ? WHERE number = ?", new Date().toISOString(), Number(c.subject.slice(6)));
    await this.logActivity(c.author, "comment.added", `${c.author} commented on ${c.subject.replace(":", " ")}${c.path ? ` (${c.path}${c.line ? `:${c.line}` : ""})` : ""}`);
    return this.ctx.storage.sql.exec('SELECT id, subject, author, body, path, line, "commit", created_at FROM comments WHERE id = ?', id).toArray()[0] as unknown as CommentRow;
  }

  // ---- abuse and impersonation reports (global instance): a human queue whose backlog is published ----
  async forumList(input:{category?:string;q?:string;sort?:string}) {return new PlatformCommunity(this.ctx.storage).list(input);}
  async forumTopic(id:string) {return new PlatformCommunity(this.ctx.storage).topic(id);}
  async forumCreate(actor:PublicCommunityActor,input:unknown,topicId?:string) {return new PlatformCommunity(this.ctx.storage).create(actor,input,topicId);}
  async forumEdit(actor:PublicCommunityActor,id:string,input:unknown) {return new PlatformCommunity(this.ctx.storage).edit(actor,id,input);}
  async forumPermissions(actor:PublicCommunityActor,topicId:string,moderator:boolean) {return new PlatformCommunity(this.ctx.storage).permissions(actor,topicId,moderator);}
  async forumRemove(actor:PublicCommunityActor,id:string,input:unknown,moderator:boolean) {return new PlatformCommunity(this.ctx.storage).remove(actor,id,input,moderator);}
  async fileReport(r: { reporter: string; kind: string; target: string; details: string; publicationTarget?: ReportPublicationTarget }): Promise<ReportRow> {
    this.reportPublicationTable();
    const id = `rpt_${crypto.randomUUID().slice(0, 10)}`;
    this.ctx.storage.sql.exec("INSERT INTO reports (id, at, reporter, kind, target, details, publication_target) VALUES (?, ?, ?, ?, ?, ?, ?)", id, new Date().toISOString(), r.reporter, r.kind, r.target, r.details, r.publicationTarget ? JSON.stringify(r.publicationTarget) : null);
    return this.ctx.storage.sql.exec("SELECT * FROM reports WHERE id = ?", id).toArray()[0] as unknown as ReportRow;
  }
  private reportPublicationTable(): void {
    if (!this.ctx.storage.sql.exec<{name:string}>("PRAGMA table_info(reports)").toArray().some(row=>row.name==="publication_target")) this.ctx.storage.sql.exec("ALTER TABLE reports ADD COLUMN publication_target TEXT");
  }
  async getReport(id: string): Promise<ReportRow | null> { this.reportPublicationTable(); return this.ctx.storage.sql.exec("SELECT * FROM reports WHERE id=?",id).toArray()[0] as unknown as ReportRow ?? null; }
  async listReports(filter: { status?: "open" | "resolved"; reporter?: string }): Promise<ReportRow[]> {
    const where: string[] = [];
    const args: string[] = [];
    if (filter.status) { where.push("status = ?"); args.push(filter.status); }
    if (filter.reporter) { where.push("reporter = ?"); args.push(filter.reporter); }
    const direction = filter.status === "open" && !filter.reporter ? "ASC" : "DESC";
    return this.ctx.storage.sql.exec(`SELECT * FROM reports ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY at ${direction}, id ${direction} LIMIT 200`, ...args).toArray() as unknown as ReportRow[];
  }
  async listReportsPage(filter: { status?: "open" | "resolved"; reporter?: string; cursor?: string | null }): Promise<{ reports: ReportRow[]; nextCursor: string | null }> {
    const where: string[] = [];
    const args: string[] = [];
    if (filter.status) { where.push("status = ?"); args.push(filter.status); }
    if (filter.reporter) { where.push("reporter = ?"); args.push(filter.reporter); }
    const ascending = filter.status === "open" && !filter.reporter;
    if (filter.cursor) {
      if (filter.cursor.length > 1000) throw new Error("Invalid report cursor");
      let cursor: unknown;
      try { cursor = JSON.parse(atob(filter.cursor)); } catch { throw new Error("Invalid report cursor"); }
      if (!Array.isArray(cursor) || cursor.length !== 4 || typeof cursor[0] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cursor[0]) || !Number.isFinite(Date.parse(cursor[0])) || typeof cursor[1] !== "string" || !/^rpt_[a-zA-Z0-9-]{1,64}$/.test(cursor[1]) || cursor[2] !== (filter.status ?? "") || cursor[3] !== (filter.reporter ?? "")) throw new Error("Invalid report cursor");
      const comparison = ascending ? ">" : "<";
      where.push(`(at ${comparison} ? OR (at = ? AND id ${comparison} ?))`);
      args.push(cursor[0], cursor[0], cursor[1]);
    }
    const direction = ascending ? "ASC" : "DESC";
    const rows = this.ctx.storage.sql.exec(`SELECT * FROM reports ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY at ${direction}, id ${direction} LIMIT 101`, ...args).toArray() as unknown as ReportRow[];
    const reports = rows.slice(0, 100);
    const last = reports.at(-1);
    return { reports: filter.reporter ? reports.map(row => ({ id: row.id, at: row.at, reporter: row.reporter, kind: row.kind, target: row.target, details: row.details, status: row.status, resolution: row.resolution, resolved_by: row.resolved_by, resolved_at: row.resolved_at })) : reports, nextCursor: rows.length > 100 && last ? btoa(JSON.stringify([last.at, last.id, filter.status ?? "", filter.reporter ?? ""])) : null };
  }
  async resolveReport(id: string, resolution: string, by: string): Promise<ReportRow | null> {
    if (!resolution.trim() || !by) throw new Error("Report resolution and operator identity required");
    return this.ctx.storage.transactionSync(() => {
      const current = this.ctx.storage.sql.exec("SELECT * FROM reports WHERE id = ?", id).toArray()[0] as unknown as ReportRow | undefined;
      if (!current) return null;
      if (current.status === "resolved") {
        if (current.resolution === resolution && current.resolved_by === by) return current;
        throw new Error("Report was already resolved");
      }
      this.ctx.storage.sql.exec("UPDATE reports SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'open'", resolution, by, new Date().toISOString(), id);
      return this.ctx.storage.sql.exec("SELECT * FROM reports WHERE id = ?", id).toArray()[0] as unknown as ReportRow;
    });
  }
  async reportBacklog(): Promise<{ open: number; oldestOpenHours: number | null }> {
    const row = this.ctx.storage.sql.exec<{ n: number; oldest: string | null }>("SELECT COUNT(*) AS n, MIN(at) AS oldest FROM reports WHERE status = 'open'").toArray()[0];
    return { open: row?.n ?? 0, oldestOpenHours: row?.oldest ? Math.floor((Date.now() - Date.parse(row.oldest)) / 3_600_000) : null };
  }

  // ---- GitHub mirror (per project) ----
  async getMirror() {
    const row = this.ctx.storage.sql.exec<{ target: string; enabled: number }>("SELECT target, enabled FROM mirror WHERE id = 1").toArray()[0];
    const runs = this.ctx.storage.sql
      .exec<{ id: string; commit_sha: string; status: string; detail: string; at: string }>("SELECT * FROM mirror_runs ORDER BY at DESC LIMIT 50")
      .toArray()
      .map((r) => ({ id: r.id, commit: r.commit_sha, status: r.status, detail: r.detail, at: r.at }));
    return { target: row?.target ?? null, enabled: Boolean(row?.enabled), hasToken: Boolean(row), runs };
  }
  async mirrorSecret(): Promise<{ target: string; token: string } | null> {
    const row = this.ctx.storage.sql.exec<{ target: string; token: string; enabled: number }>("SELECT target, token, enabled FROM mirror WHERE id = 1").toArray()[0];
    return row && row.enabled ? { target: row.target, token: row.token } : null;
  }
  async setMirror(p: { target?: string; token?: string; enabled?: boolean }): Promise<void> {
    const cur = this.ctx.storage.sql.exec<{ target: string; token: string; enabled: number }>("SELECT target, token, enabled FROM mirror WHERE id = 1").toArray()[0];
    const target = p.target ?? cur?.target;
    const token = p.token ?? cur?.token;
    if (!target || !token) throw new Error("Target and token are required");
    const enabled = p.enabled ?? (cur ? Boolean(cur.enabled) : true);
    this.ctx.storage.sql.exec("INSERT OR REPLACE INTO mirror (id, target, token, enabled, created_at) VALUES (1, ?, ?, ?, ?)", target, token, enabled ? 1 : 0, new Date().toISOString());
  }
  async deleteMirror(): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM mirror");
  }
  async recordMirrorRun(commit: string, status: string, detail: string): Promise<void> {
    this.ctx.storage.sql.exec("INSERT INTO mirror_runs (id, commit_sha, status, detail, at) VALUES (?, ?, ?, ?, ?)", crypto.randomUUID(), commit, status, detail.slice(0, 500), new Date().toISOString());
    this.ctx.storage.sql.exec("DELETE FROM mirror_runs WHERE id NOT IN (SELECT id FROM mirror_runs ORDER BY at DESC LIMIT 50)");
    if (status !== "ok") await this.logActivity("FlareGit", "mirror.failed", `GitHub mirror ${status} for ${commit.slice(0, 7)}: ${detail.slice(0, 160)}`);
  }

  // ---- identity (profile on the account instance; handle registry on the global instance) ----
  async getProfile(): Promise<Profile> {
    const row = this.ctx.storage.sql.exec<{ doc: string }>("SELECT doc FROM profile WHERE id = 1").toArray()[0];
    return row ? (JSON.parse(row.doc) as Profile) : { handle: "", displayName: "", bio: "", joinedAt: new Date().toISOString() };
  }
  async repositoryModerationState(): Promise<PublicationModerationState> { return new PublicationModeration(this.ctx.storage).state("repository",this.load().projectId); }
  async profileModerationState(ownerId: string): Promise<PublicationModerationState> { return new PublicationModeration(this.ctx.storage).state("profile",ownerId); }
  async moderationHistory(kind: PublicationModerationKind, targetId: string): Promise<PublicationModerationDecision[]> { return new PublicationModeration(this.ctx.storage).history(kind,targetId); }
  async moderateRepository(input: unknown, operatorAccountKey: string): Promise<PublicationModerationDecision> {
    if (this.repositoryDeleting()) throw new Error("Repository deletion is in progress");
    this.visibilityTable();
    return new PublicationModeration(this.ctx.storage).moderate("repository",this.load().projectId,input,operatorAccountKey,()=>{this.ctx.storage.sql.exec("INSERT INTO repository_visibility VALUES(1,'private',1,'') ON CONFLICT(id) DO UPDATE SET version=version+1");});
  }
  async moderateProfile(ownerId: string, input: unknown, operatorAccountKey: string): Promise<PublicationModerationDecision> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS profile_publication(id INTEGER PRIMARY KEY CHECK(id=1),visibility TEXT,version INTEGER,owner_id TEXT)");
    return new PublicationModeration(this.ctx.storage).moderate("profile",ownerId,input,operatorAccountKey,()=>{this.ctx.storage.sql.exec("INSERT INTO profile_publication VALUES(1,'private',1,?) ON CONFLICT(id) DO UPDATE SET version=version+1",ownerId);});
  }
  private profileSnapshot():PublicProfileState {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS profile_publication(id INTEGER PRIMARY KEY CHECK(id=1),visibility TEXT,version INTEGER,owner_id TEXT)");
    const publication=this.ctx.storage.sql.exec<{visibility:"public"|"private";version:number;owner_id:string}>("SELECT visibility,version,owner_id FROM profile_publication WHERE id=1").toArray()[0];
    const row=this.ctx.storage.sql.exec<{doc:string}>("SELECT doc FROM profile WHERE id=1").toArray()[0];
    const profile:Profile=row?JSON.parse(row.doc) as Profile:{handle:"",displayName:"",bio:"",joinedAt:""};
    return {profile,visibility:publication?.visibility??"private",version:publication?.version??0,ownerId:publication?.owner_id??null,moderation:publication?.owner_id?new PublicationModeration(this.ctx.storage).state("profile",publication.owner_id):undefined};
  }
  async peopleSnapshot():Promise<PeopleSnapshot>{return {profile:this.profileSnapshot(),discovery:new CommunityPeople(this.ctx.storage).state(),active:this.accountLifecycleState()==="active"};}
  async configureDiscovery(input:unknown,userId:string){if(this.accountLifecycleState()!=="active")throw new Error("Account unavailable");const profile=this.profileSnapshot();if(profile.ownerId&&profile.ownerId!==userId)throw new Error("Profile owner changed");return new CommunityPeople(this.ctx.storage).configure(input,profile);}
  async registerPerson(value:PeopleRegistration){new CommunityPeople(this.ctx.storage).register(value);}
  async deliveredDiscovery(version:number){new CommunityPeople(this.ctx.storage).delivered(version);}
  async peoplePage(cursor?:string){return new CommunityPeople(this.ctx.storage).page(cursor);}
  async followingForHandle(handle:string){return new CommunityPeople(this.ctx.storage).followingForHandle(handle);}
  async replayFollowing(handle:string,input:unknown){return new CommunityPeople(this.ctx.storage).replayFollowing(handle,input);}
  async followingRecord(targetAccount:string){return new CommunityPeople(this.ctx.storage).followingRecord(targetAccount);}
  async followingPage(cursor?:string){return new CommunityPeople(this.ctx.storage).followingPage(cursor);}
  async setFollowing(target:{accountKey:string;ownerId:string;handle:string},input:unknown){if(this.accountLifecycleState()!=="active")throw new Error("Account unavailable");return new CommunityPeople(this.ctx.storage).setFollowing(target,input);}
  async publicActivityProjects(){return this.ctx.storage.sql.exec<{id:string}>("SELECT id FROM projects ORDER BY id LIMIT 3").toArray();}
  async publicAcceptedActivity(userId:string){
    const directory=new PublicDirectory(this.ctx.storage).state(),grant=this.publicGrantSnapshot();
    if(!directory.enabled||!grant||!userId||!this.ctx.storage.sql.exec("SELECT 1 FROM members WHERE user_id=?",userId).toArray().length)return {directory,grant,contributions:[]};
    this.gitTables();const state=this.load();const tasks=new Set(this.ctx.storage.sql.exec<{task_id:string}>("SELECT task_id FROM git_task_writers WHERE user_id=? ORDER BY task_id LIMIT 1000",userId).toArray().filter(row=>state.tasks[row.task_id]?.contributor.type==="human").map(row=>row.task_id));
    const contributions=state.acceptedState.history.slice(-100).filter(record=>/^[a-f0-9]{40}$/.test(record.commit)&&record.participatingTasks.some(task=>tasks.has(task))).slice(-3).map(record=>({commit:record.commit,acceptedAt:record.acceptedAt}));
    return {directory,grant,contributions};
  }
  async publicProfileState(): Promise<PublicProfileState> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS profile_publication(id INTEGER PRIMARY KEY CHECK(id=1),visibility TEXT,version INTEGER,owner_id TEXT)");
    const row = this.ctx.storage.sql.exec<{visibility:"public"|"private";version:number;owner_id:string}>("SELECT visibility,version,owner_id FROM profile_publication WHERE id=1").toArray()[0];
    return { profile: await this.getProfile(), visibility: row?.visibility ?? "private", version: row?.version ?? 0, ownerId: row?.owner_id ?? null, moderation: row?.owner_id ? new PublicationModeration(this.ctx.storage).state("profile",row.owner_id) : undefined };
  }
  async setPublicProfileVisibility(visibility: "public" | "private", confirmed: boolean, ownerId: string, expectedVersion?: number): Promise<void> {
    if (visibility === "public" && (await this.profileModerationState(ownerId)).suppressed) throw new Error("Public profile publication is suppressed; see your moderation notice");
    if (!["public","private"].includes(visibility) || !ownerId || (visibility === "public" && confirmed !== true)) throw new Error("Explicit profile publication confirmation required");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS profile_publication(id INTEGER PRIMARY KEY CHECK(id=1),visibility TEXT,version INTEGER,owner_id TEXT)");
    this.ctx.storage.transactionSync(() => {
      const version = this.ctx.storage.sql.exec<{version:number}>("SELECT version FROM profile_publication WHERE id=1").toArray()[0]?.version ?? 0;
      if (visibility === "public" && new PublicationModeration(this.ctx.storage).state("profile",ownerId).suppressed) throw new Error("Public profile publication is suppressed");
      if (visibility === "public" && (!Number.isSafeInteger(expectedVersion) || expectedVersion !== version)) throw new Error("Profile version changed; refresh before publishing");
      const row = this.ctx.storage.sql.exec<{doc:string}>("SELECT doc FROM profile WHERE id=1").toArray()[0];
      const profile = row ? JSON.parse(row.doc) as Profile : null;
      if (visibility === "public" && !profile?.handle) throw new Error("Save a profile handle first");
      if (visibility === "public" && profile) safeContent(profile.handle,profile.displayName,profile.bio);
      this.ctx.storage.sql.exec("INSERT INTO profile_publication VALUES(1,?,1,?) ON CONFLICT(id) DO UPDATE SET visibility=excluded.visibility,version=version+1,owner_id=excluded.owner_id", visibility, ownerId);
    });
  }
  async setProfile(p: Profile, expectedVersion?: number): Promise<void> {
    safeContent(p.handle,p.displayName,p.bio);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS profile_publication(id INTEGER PRIMARY KEY CHECK(id=1),visibility TEXT,version INTEGER,owner_id TEXT)");
    this.ctx.storage.transactionSync(() => {
      const version = this.ctx.storage.sql.exec<{version:number}>("SELECT version FROM profile_publication WHERE id=1").toArray()[0]?.version ?? 0;
      if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion !== version)) throw new Error("Profile version changed; refresh before saving");
      this.ctx.storage.sql.exec("INSERT INTO profile (id, doc) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc", JSON.stringify(p));
      this.ctx.storage.sql.exec("INSERT INTO profile_publication VALUES(1,'private',1,NULL) ON CONFLICT(id) DO UPDATE SET version=version+1");
    });
  }

  /** First come, first served, one handle per account; changing handles releases the old one. */
  async claimHandle(handle: string, accountKey: string): Promise<boolean> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS handle_reservations(handle TEXT PRIMARY KEY,account_key TEXT UNIQUE NOT NULL)");
    return this.ctx.storage.transactionSync(() => {
      const owner = this.ctx.storage.sql.exec<{account_key:string}>("SELECT account_key FROM handles WHERE handle=? UNION SELECT account_key FROM handle_reservations WHERE handle=?",handle,handle).toArray();
      if (owner.some((row) => row.account_key !== accountKey)) return false;
      this.ctx.storage.sql.exec("DELETE FROM handle_reservations WHERE account_key=?",accountKey);
      this.ctx.storage.sql.exec("INSERT INTO handle_reservations VALUES(?,?)",handle,accountKey);
      return true;
    });
  }
  async commitHandle(handle: string, accountKey: string): Promise<void> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS handle_reservations(handle TEXT PRIMARY KEY,account_key TEXT UNIQUE NOT NULL)");
    this.ctx.storage.transactionSync(() => {
      const reserved = this.ctx.storage.sql.exec<{account_key:string}>("SELECT account_key FROM handle_reservations WHERE handle=?",handle).toArray()[0];
      if (reserved?.account_key !== accountKey) throw new Error("Profile handle reservation changed; retry saving");
      this.ctx.storage.sql.exec("DELETE FROM handles WHERE account_key=?",accountKey);
      this.ctx.storage.sql.exec("INSERT INTO handles VALUES(?,?)",handle,accountKey);
      this.ctx.storage.sql.exec("DELETE FROM handle_reservations WHERE account_key=?",accountKey);
    });
  }
  async releaseHandle(handle: string, accountKey: string): Promise<void> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS handle_reservations(handle TEXT PRIMARY KEY,account_key TEXT UNIQUE NOT NULL)");
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM handles WHERE handle = ? AND account_key = ?", handle, accountKey);
      this.ctx.storage.sql.exec("DELETE FROM handle_reservations WHERE handle=? AND account_key=?",handle,accountKey);
    });
  }
  async accountForHandle(handle: string): Promise<string | null> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS handle_reservations(handle TEXT PRIMARY KEY,account_key TEXT UNIQUE NOT NULL)");
    return this.ctx.storage.sql.exec<{ account_key: string }>("SELECT account_key FROM handles WHERE handle=? UNION SELECT account_key FROM handle_reservations WHERE handle=?",handle,handle).toArray()[0]?.account_key ?? null;
  }

  // ---- domain ownership (used on the global instance) ----
  /** Anyone may claim a name; a claim confers nothing until DNS proves control. */
  async claimDomain(domain: string, projectId: string): Promise<DomainRow> {
    const existing = (this.ctx.storage.sql.exec("SELECT * FROM domains WHERE domain = ? AND project_id = ?", domain, projectId).toArray()[0] as unknown as DomainRow | undefined);
    if (existing) return existing;
    const token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    this.ctx.storage.sql.exec("INSERT INTO domains (domain, project_id, token, verified_at) VALUES (?, ?, ?, NULL)", domain, projectId, token);
    return { domain, project_id: projectId, token, verified_at: null };
  }
  async domainsFor(projectId: string): Promise<DomainRow[]> {
    return this.ctx.storage.sql.exec("SELECT * FROM domains WHERE project_id = ? ORDER BY domain", projectId).toArray() as unknown as DomainRow[];
  }
  /**
   * Called only after DNS proved control for this project. Control of the DNS zone is the authority, so any other
   * project holding the same verified name loses it at once (an impostor cannot keep a name its owner can reclaim).
   */
  async verifyDomain(domain: string, projectId: string): Promise<{ lostBy: string[] }> {
    const lost = this.ctx.storage.sql.exec<{ project_id: string }>("SELECT project_id FROM domains WHERE domain = ? AND project_id != ? AND verified_at IS NOT NULL", domain, projectId).toArray().map((r) => r.project_id);
    this.ctx.storage.sql.exec("UPDATE domains SET verified_at = NULL WHERE domain = ? AND project_id != ?", domain, projectId);
    this.ctx.storage.sql.exec("UPDATE domains SET verified_at = ? WHERE domain = ? AND project_id = ?", new Date().toISOString(), domain, projectId);
    return { lostBy: lost };
  }
  async releaseDomain(domain: string, projectId: string): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM domains WHERE domain = ? AND project_id = ?", domain, projectId);
  }

  // ---- notification inbox (used on the account instance) ----
  async addInbox(item: { projectId: string; projectName: string; kind: "direct" | "activity"; type: string; title: string }): Promise<void> {
    // "Snooze until the next push" ends as soon as anything new happens in that repository.
    this.ctx.storage.sql.exec("UPDATE inbox SET state = 'unread' WHERE project_id = ? AND state = 'snoozed'", item.projectId);
    this.ctx.storage.sql.exec("INSERT INTO inbox (project_id, project_name, kind, type, title, created_at) VALUES (?, ?, ?, ?, ?, ?)", item.projectId, item.projectName, item.kind, item.type, item.title, new Date().toISOString());
    this.ctx.storage.sql.exec("DELETE FROM inbox WHERE id <= (SELECT MAX(id) FROM inbox) - 300");
  }
  async listInbox(filter: "direct" | "activity" | "snoozed" | "archived"): Promise<InboxRow[]> {
    const byState = filter === "snoozed" || filter === "archived";
    return this.ctx.storage.sql
      .exec(`SELECT * FROM inbox WHERE ${byState ? "state = ?" : "state = 'unread' AND kind = ?"} ORDER BY id DESC LIMIT 100`, filter)
      .toArray() as unknown as InboxRow[];
  }
  async setInboxState(id: number, state: "unread" | "archived" | "snoozed"): Promise<void> {
    this.ctx.storage.sql.exec("UPDATE inbox SET state = ? WHERE id = ?", state, id);
  }
  async inboxUnread(): Promise<{ direct: number; activity: number }> {
    const rows = this.ctx.storage.sql.exec<{ kind: string; n: number }>("SELECT kind, COUNT(*) AS n FROM inbox WHERE state = 'unread' GROUP BY kind").toArray();
    return { direct: rows.find((r) => r.kind === "direct")?.n ?? 0, activity: rows.find((r) => r.kind === "activity")?.n ?? 0 };
  }
  async listActivity(limit: number): Promise<ActivityRow[]> {
    return this.ctx.storage.sql.exec("SELECT id, at, actor, type, summary FROM activity ORDER BY id DESC LIMIT ?", Math.min(limit, 200)).toArray() as unknown as ActivityRow[];
  }

  async setVerificationPolicy(policy: Record<string, unknown>): Promise<void> {
    const s = this.load();
    s.verificationPolicy = policy;
    s.policyVersion += 1;
    this.save();
    await this.logActivity("owner", "config.updated", "Verification settings changed");
  }

  private repositoryDeleting(): boolean {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS repository_deletion(id INTEGER PRIMARY KEY)");
    return this.ctx.storage.sql.exec("SELECT id FROM repository_deletion WHERE id=1").toArray().length > 0;
  }
  async repositoryDeletionPending(): Promise<boolean> { return this.repositoryDeleting(); }
  async beginRepositoryDeletion(): Promise<void> {
    this.repositoryDeleting();
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO repository_deletion VALUES(1)");
  }
  async repositoryArtifactDeleted(name: string): Promise<boolean> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS repository_artifact_deletions(name TEXT PRIMARY KEY)");
    return this.ctx.storage.sql.exec("SELECT name FROM repository_artifact_deletions WHERE name=?", name).toArray().length > 0;
  }
  async recordRepositoryArtifactDeleted(name: string): Promise<void> {
    if (!this.repositoryDeleting()) throw new Error("Repository deletion was not started");
    await this.repositoryArtifactDeleted(name);
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO repository_artifact_deletions VALUES(?)", name);
  }

  /** Delete everything this project stores (account deletion / repository deletion). */
  async destroy(): Promise<void> {
    this.repositoryDeleting();
    new RebaseResumeAttempts(this.ctx.storage);
    if(this.ctx.storage.sql.exec("SELECT 1 FROM rebase_resume_attempts a WHERE rowid=(SELECT MAX(rowid) FROM rebase_resume_attempts b WHERE b.application_id=a.application_id) AND (json_extract(doc,'$.nativeState')!='stopped' OR json_extract(doc,'$.terminal') IS NULL OR json_extract(doc,'$.dispatch')='unknown') LIMIT 1").toArray().length||new SavedRebaseResumeCredentials(this.ctx.storage).hasPending())throw new Error("Saved recovery cleanup is unconfirmed; durable attempts and credentials were preserved");
    const integrationNative=new IntegrationNativeRuntimeLedger(this.ctx.storage);if(integrationNative.hasUnconfirmed()||this.integrationNativeMissingCoverage().some(run=>run.native_protocol!==1||Object.values(this.load(true).candidates).some(candidate=>candidate.workflowInstanceId===run.instance_id)))throw new Error("Integration native shutdown remains unconfirmed; metadata was preserved");
    const tables = this.ctx.storage.sql.exec<{name:string}>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='repository_deletion'").toArray();
    this.ctx.storage.transactionSync(() => {
      for (const table of tables) this.ctx.storage.sql.exec(`DELETE FROM "${table.name.replaceAll('"','""')}"`);
      this.ctx.storage.sql.exec("INSERT OR IGNORE INTO repository_deletion VALUES(1)");
    });
    this.state = null;
  }

  async getBilling(): Promise<{ plan: "free" | "pro"; status: string; subscriptionId?: string; updatedAt: string }> {
    const row = this.ctx.storage.sql.exec<{ doc: string }>("SELECT doc FROM billing WHERE id = 1").toArray()[0];
    return row ? JSON.parse(row.doc) : { plan: "free", status: "none", updatedAt: new Date(0).toISOString() };
  }

  async setBilling(b: { plan: "free" | "pro"; status: string; subscriptionId?: string; updatedAt: string }): Promise<void> {
    this.ctx.storage.sql.exec("INSERT INTO billing (id, doc) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc", JSON.stringify(b));
  }

  async usageToday(): Promise<number> {
    const day = new Date().toISOString().slice(0, 10);
    return this.ctx.storage.sql.exec<{ n: number }>("SELECT n FROM runs WHERE day = ?", day).toArray()[0]?.n ?? 0;
  }

  /** Spend guard: atomically count a model-backed run against today's per-project allowance. */
  async existingDeploymentRequest(target: AcceptedDeploymentTarget, serviceId: string, environment: string, key: string, actorId: string): Promise<DeploymentRecord | null> {
    if(await this.roleOf(actorId)!=="owner")throw new Error("Owner required");
    const state=await this.getState();
    return new RepositoryDeployments(this.ctx.storage,state.projectId).existingRequest(target,serviceId,environment,key,actorId);
  }
  async reserveHealthProbe(): Promise<HealthProbeAdmission> {
    return new HealthProbeBudget(this.ctx.storage).reserve();
  }
  async previewStorageWriterState(key:string):Promise<{unfinished:boolean}>{
    if(!/^(?:builds\/[a-z0-9]{12,16}\/[a-f0-9]{40}|build-generations\/[a-z0-9]{12,16}\/[a-f0-9-]{36}\/[a-f0-9]{40}\/[a-f0-9-]{36})$/.test(key))throw new Error("Invalid preview scope");
    new PreviewStorageWriters(this.ctx.storage);
    const rows=this.ctx.storage.sql.exec<{closed:number;pending:string}>("SELECT closed,pending FROM preview_copy_writers WHERE physical_key=?",key).toArray();
    return{unfinished:rows.some(row=>!row.closed||(JSON.parse(row.pending) as unknown[]).length>0)};
  }
  async nativeComputeFailureReason(key:string):Promise<string|null>{
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS preview_failure_reasons(key TEXT PRIMARY KEY,reason TEXT NOT NULL)");
    return this.ctx.storage.sql.exec<{reason:string}>("SELECT reason FROM preview_failure_reasons WHERE key=?",key).toArray()[0]?.reason??null;
  }
  async setNativeComputeFailureReason(key:string,reason:"storage_capacity"|"storage_unconfigured"|"storage_retired"|"storage_reconciliation"|"build_failed"):Promise<void>{
    if(!["storage_capacity","storage_unconfigured","storage_retired","storage_reconciliation","build_failed"].includes(reason))throw new Error("Invalid preview failure reason");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS preview_failure_reasons(key TEXT PRIMARY KEY,reason TEXT NOT NULL)");
    this.ctx.storage.sql.exec("INSERT INTO preview_failure_reasons VALUES(?,?) ON CONFLICT(key) DO UPDATE SET reason=excluded.reason",key,reason);
    await this.setNativeComputeFailure(key,true);
  }
  async nativeComputeFailure(key: string): Promise<boolean> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS native_compute_failures(key TEXT PRIMARY KEY)");
    return this.ctx.storage.sql.exec("SELECT key FROM native_compute_failures WHERE key=?",key).toArray().length>0;
  }
  async setNativeComputeFailure(key: string, failed: boolean): Promise<void> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS native_compute_failures(key TEXT PRIMARY KEY)");
    if(failed)this.ctx.storage.sql.exec("INSERT OR IGNORE INTO native_compute_failures VALUES(?)",key);
    else {this.ctx.storage.sql.exec("DELETE FROM native_compute_failures WHERE key=?",key);this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS preview_failure_reasons(key TEXT PRIMARY KEY,reason TEXT NOT NULL)");this.ctx.storage.sql.exec("DELETE FROM preview_failure_reasons WHERE key=?",key);}
  }
  async nativeComputeStatus(key: string): Promise<{ active: boolean; sandboxName: string; token: string; deadline: number } | null> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS native_compute(key TEXT PRIMARY KEY, token TEXT NOT NULL, active INTEGER NOT NULL, started_at INTEGER)");
    try{this.ctx.storage.sql.exec("ALTER TABLE native_compute ADD COLUMN started_at INTEGER");}catch{/* Column already exists. */}
    this.ctx.storage.sql.exec("UPDATE native_compute SET started_at=? WHERE key=? AND started_at IS NULL",Date.now(),key);
    const row=this.ctx.storage.sql.exec<{token:string;active:number;started_at:number}>("SELECT token,active,started_at FROM native_compute WHERE key=?",key).toArray()[0];
    return row?{active:!!row.active,sandboxName:`native-${row.token}`,token:row.token,deadline:row.started_at+1200000}:null;
  }
  async claimNativeCompute(key: string): Promise<string | null> {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(key)) throw new Error("Invalid native operation");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS native_compute(key TEXT PRIMARY KEY, token TEXT NOT NULL, active INTEGER NOT NULL, started_at INTEGER)");
    try{this.ctx.storage.sql.exec("ALTER TABLE native_compute ADD COLUMN started_at INTEGER");}catch{/* Column already exists. */}
    return this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql.exec<{active:number}>("SELECT active FROM native_compute WHERE key=?",key).toArray()[0];
      if(existing?.active) return null;
      const token=crypto.randomUUID();
      this.ctx.storage.sql.exec("INSERT INTO native_compute VALUES(?,?,1,?) ON CONFLICT(key) DO UPDATE SET token=excluded.token,active=1,started_at=excluded.started_at",key,token,Date.now());
      return token;
    });
  }
  async finishNativeCompute(key: string, token: string): Promise<void> {
    this.ctx.storage.sql.exec("UPDATE native_compute SET active=0 WHERE key=? AND token=?",key,token);
  }
  async markManagedDispatchAttempted(runIds: string[], accountKey: string): Promise<void> {
    new ManagedSpendLedger(this.ctx.storage).markDispatchAttempted(runIds, accountKey);
  }
  async cancelUnstartedManagedSpend(runIds: string[], accountKey: string): Promise<void> {
    new ManagedSpendLedger(this.ctx.storage).cancelUnstarted(runIds, accountKey);
  }
  async managedReservationAttribution(input: {month:string;cursor?:string}) { return new ManagedSpendLedger(this.ctx.storage).attributionPage(input); }
  async managedSpendReserved(month: string, accountKey?: string): Promise<number> {
    if (!/^\d{4}-\d{2}$/.test(month) || (accountKey !== undefined && !/^[A-Za-z0-9_-]{1,200}$/.test(accountKey))) throw new Error("Invalid spending scope");
    return new ManagedSpendLedger(this.ctx.storage).used(month, accountKey);
  }
  async reserveCoreGitOperation(operationId: string, accountKey: string, budget: CoreGitBudget): Promise<CoreGitAdmission> {
    void budget;
    return new CoreGitOperationLedger(this.ctx.storage).reserve(operationId, accountKey, this.currentGitBudget());
  }
  private currentGitBudget(): CoreGitBudget {
    if(configuredGitCap(this.env.REPOSITORY_READ_ACCOUNT_MONTHLY_USD_MICROS)===null||configuredGitCap(this.env.REPOSITORY_READ_GLOBAL_MONTHLY_USD_MICROS)===null)return {accountUsdMicros:null,globalUsdMicros:null};
    return {accountUsdMicros:configuredGitCap(this.env.CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS),globalUsdMicros:configuredGitCap(this.env.CORE_GIT_GLOBAL_MONTHLY_USD_MICROS),readAccountUsdMicros:configuredGitCap(this.env.REPOSITORY_READ_ACCOUNT_MONTHLY_USD_MICROS),readGlobalUsdMicros:configuredGitCap(this.env.REPOSITORY_READ_GLOBAL_MONTHLY_USD_MICROS)};
  }
  async reserveRepositoryReadOperation(operationId:string,accountKey:string):Promise<CoreGitAdmission>{return new CoreGitOperationLedger(this.ctx.storage).reserve(operationId,accountKey,this.currentGitBudget(),new Date(),"read");}
  private readRepositoryIncarnation():string|null {return this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='private_recovery_incarnation'").toArray().length?this.ctx.storage.sql.exec<{value:string}>("SELECT value FROM private_recovery_incarnation WHERE id=1").toArray()[0]?.value??null:null;}
  async repositoryReadContext(userId:string|null,taskId:string|null=null,candidateId:string|null=null):Promise<RepositoryReadContext>{
    if(this.repositoryDeleting())throw new Error("Repository unavailable");
    const state=this.load(),incarnation=this.readRepositoryIncarnation();
    const ownerId=this.ctx.storage.sql.exec<{user_id:string}>("SELECT user_id FROM members WHERE role='owner' ORDER BY user_id LIMIT 1").toArray()[0]?.user_id;
    if(!ownerId)throw new Error("Repository owner unavailable");
    const grant=userId===null?await this.publicGrant():null;
    if(userId===null&&(!grant||taskId!==null||candidateId!==null))throw new Error("Repository is not public");
    if(userId!==null&& !await this.canGitAccess(userId,taskId,false))throw new Error("Repository access denied");
    const accountKey=await accountKeyFor(ownerId);
    if(await accountOf(this.env,accountKey).accountLifecycle()!=="active")throw new Error("Repository owner unavailable");
    if(userId!==null&&await accountOf(this.env,await accountKeyFor(userId)).accountLifecycle()!=="active")throw new Error("Account unavailable");
    const fresh=this.load();
    if(this.repositoryDeleting()||fresh.canonicalRepoName!==state.canonicalRepoName||fresh.projectId!==state.projectId||this.readRepositoryIncarnation()!==incarnation||this.ctx.storage.sql.exec<{user_id:string}>("SELECT user_id FROM members WHERE role='owner' ORDER BY user_id LIMIT 1").toArray()[0]?.user_id!==ownerId)throw new Error("Repository authority changed");
    if(userId!==null&&!await this.canGitAccess(userId,taskId,false))throw new Error("Repository access changed");
    if(userId===null&&JSON.stringify(await this.publicGrant())!==JSON.stringify(grant))throw new Error("Public repository changed");
    const latest=this.load();
    if(this.repositoryDeleting()||latest.canonicalRepoName!==state.canonicalRepoName||latest.projectId!==state.projectId||this.readRepositoryIncarnation()!==incarnation||this.ctx.storage.sql.exec<{user_id:string}>("SELECT user_id FROM members WHERE role='owner' ORDER BY user_id LIMIT 1").toArray()[0]?.user_id!==ownerId||(userId!==null&&!this.ctx.storage.sql.exec("SELECT role FROM members WHERE user_id=?",userId).toArray().length))throw new Error("Repository authority changed");
    let repoName=taskId?latest.tasks[taskId]?.workspace.repoName:latest.canonicalRepoName;if(!repoName)throw new Error("Workspace unavailable");
    const candidate=candidateId?latest.candidates[candidateId]:null;
    if(candidateId&&(!candidate||(!taskId&&!candidate.candidateCommit)))throw new Error("Candidate unavailable");
    const inputCommit=candidate&&taskId?candidate.participatingCommits[taskId]:undefined;
    if(candidate&&taskId&&(!candidate.participatingTaskIds.includes(taskId)||!inputCommit||!/^[a-f0-9]{40}$/.test(inputCommit)))throw new Error("Frozen candidate input unavailable");
    let inputBase=candidate&&taskId?candidate.frozenContributorProofs?.find(proof=>proof.id===taskId&&proof.commit===inputCommit)?.baseCommit:undefined;
    if(inputBase!==undefined&&!/^[a-f0-9]{40}$/.test(inputBase))throw new Error("Frozen input base unavailable");
    let retained:RetainedInputReceipt|null=null;
    if(taskId&&candidate&&inputCommit&&this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='retained_inputs'").toArray().length){
      retained=new RetainedInputs(this.ctx.storage).lookup(taskId,candidate.id,inputCommit);
      if(retained){if(retained.projectId!==latest.projectId||retained.incarnation!==incarnation||retained.canonicalRepoName!==latest.canonicalRepoName||retained.workflowId!==candidate.workflowInstanceId||(inputBase!==undefined&&retained.base!==inputBase))throw new Error("Retained input scope changed");inputBase=retained.base;repoName=latest.canonicalRepoName;}
    }
    return {projectId:fresh.projectId,incarnation,canonicalRepoName:fresh.canonicalRepoName,repoName,ownerId,accountKey,...(retained?{retainedInputReceiptId:retained.id}:{}),...(candidate?{candidateId:candidate.id,candidateCommit:candidate.candidateCommit,candidateBase:candidate.expectedAcceptedBase,...(taskId?{candidateInputCommit:inputCommit,candidateInputBase:inputBase}:{})}:{}),...(taskId&&!retained?{taskBase:latest.tasks[taskId]!.baseCommit,taskCommit:latest.tasks[taskId]!.currentCommit,taskBranch:latest.tasks[taskId]!.workspace.branch}:{}),...(grant?{publicationVersion:grant.version,acceptedCommit:grant.acceptedCommit}:{})};
  }
  private assertReadLocal(context:RepositoryReadContext,userId:string|null,taskId:string|null,write=false):void {
    const state=this.load(),task=taskId?state.tasks[taskId]:null;
    const role=userId?this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",userId).toArray()[0]?.role:null;
    if(this.repositoryDeleting()||state.projectId!==context.projectId||state.canonicalRepoName!==context.canonicalRepoName||this.readRepositoryIncarnation()!==context.incarnation||(userId&&!role)||this.ctx.storage.sql.exec<{user_id:string}>("SELECT user_id FROM members WHERE role='owner' ORDER BY user_id LIMIT 1").toArray()[0]?.user_id!==context.ownerId)throw new Error("Repository read authority changed");
    if(taskId&&(!task||(!context.retainedInputReceiptId&&(task.workspace.repoName!==context.repoName||task.baseCommit!==context.taskBase||task.currentCommit!==context.taskCommit||task.workspace.branch!==context.taskBranch))))throw new Error("Contribution checkpoint changed");
    if(context.candidateId){const candidate=state.candidates[context.candidateId];if(!candidate||candidate.candidateCommit!==context.candidateCommit||candidate.expectedAcceptedBase!==context.candidateBase)throw new Error("Candidate review changed");if(taskId&&( !candidate.participatingTaskIds.includes(taskId)||candidate.participatingCommits[taskId]!==context.candidateInputCommit||((candidate.frozenContributorProofs?.find(proof=>proof.id===taskId&&proof.commit===context.candidateInputCommit)?.baseCommit!==undefined||!context.retainedInputReceiptId)&&candidate.frozenContributorProofs?.find(proof=>proof.id===taskId&&proof.commit===context.candidateInputCommit)?.baseCommit!==context.candidateInputBase)))throw new Error("Frozen candidate input changed");}
    if(context.retainedInputReceiptId){const retained=new RetainedInputs(this.ctx.storage).get(context.retainedInputReceiptId);if(!retained||retained.projectId!==context.projectId||retained.incarnation!==context.incarnation||retained.canonicalRepoName!==context.repoName||retained.taskId!==taskId||retained.candidateId!==context.candidateId||retained.commit!==context.candidateInputCommit||retained.base!==context.candidateInputBase)throw new Error("Retained input read scope changed");}
    if(write){this.gitTables();if(!task||["accepted","cancelled"].includes(task.status)||(role!=="owner"&&!this.ctx.storage.sql.exec("SELECT task_id FROM git_task_writers WHERE task_id=? AND user_id=?",taskId!,userId!).toArray().length))throw new Error("Contribution writer authority changed");}
    if(userId===null){this.requirePublicRepository();const visibility=this.ctx.storage.sql.exec<{version:number}>("SELECT version FROM repository_visibility WHERE id=1").toArray()[0];if(visibility?.version!==context.publicationVersion||state.acceptedState.currentCommit!==context.acceptedCommit)throw new Error("Public read scope changed");}
  }
  async assertRepositoryReadContext(context:RepositoryReadContext,userId:string|null,taskId:string|null=null,credentialHash?:string,candidateId:string|null=null):Promise<boolean>{try{
    if(JSON.stringify(await this.repositoryReadContext(userId,taskId,candidateId))!==JSON.stringify(context))return false;
    if(credentialHash&&(!userId||!await accountOf(this.env,await accountKeyFor(userId)).apiTokenHashCanRead(credentialHash,userId,context.projectId)))return false;
    this.assertReadLocal(context,userId,taskId);return true;
  }catch{return false;}}
  async ingestMemberCheckpoint(ev:{eventId:string;taskId:string;commit:string;ready:boolean;filesChanged?:string[]},userId:string,context:RepositoryReadContext,credentialHash?:string,sessionExpiresAt?:number):Promise<{applied:boolean}>{
    await this.ensureRecoveryAlarm();
    if(!await this.assertRepositoryReadContext(context,userId,ev.taskId))throw new Error("Checkpoint authority changed");
    if(credentialHash&&!await accountOf(this.env,await accountKeyFor(userId)).apiTokenHashCanRead(credentialHash,userId,context.projectId,true))throw new Error("Checkpoint credential changed");
    return this.applyCheckpoint(ev,()=>{if(!credentialHash&&(!Number.isFinite(sessionExpiresAt)||Date.now()>=sessionExpiresAt!))throw new Error("Checkpoint session expired");this.assertReadLocal(context,userId,ev.taskId,true);});
  }
  async reserveManagedSpendBatch(inputs: ManagedEnvelope[], budget: ManagedBudget): Promise<ManagedAdmission[]> {
    return new ManagedSpendLedger(this.ctx.storage).reserveBatch(inputs, budget);
  }
  async reserveManagedSpend(input: ManagedEnvelope, budget: ManagedBudget): Promise<ManagedAdmission> {
    return new ManagedSpendLedger(this.ctx.storage).reserve(input, budget);
  }
  async consumeManagedSpend(runId: string, inputBytes: number, outputTokens: number, containerSeconds: number): Promise<ManagedReservation> {
    return new ManagedSpendLedger(this.ctx.storage).consume(runId, inputBytes, outputTokens, containerSeconds);
  }
  async consumeRun(limit: number, admissionKey?: string): Promise<{ allowed: boolean; used: number }> {
    if (admissionKey && !/^[A-Za-z0-9:_-]{1,200}$/.test(admissionKey)) throw new Error("Invalid admission key");
    const day = new Date().toISOString().slice(0, 10);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS run_admissions(key TEXT PRIMARY KEY,day TEXT)");
    return this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM run_admissions WHERE day < ?", new Date(Date.now() - 30 * 86400_000).toISOString().slice(0,10));
      const used = this.ctx.storage.sql.exec<{n:number}>("SELECT n FROM runs WHERE day=?", day).toArray()[0]?.n ?? 0;
      if (admissionKey && this.ctx.storage.sql.exec("SELECT key FROM run_admissions WHERE key=?", admissionKey).toArray().length) return { allowed: true, used };
      if (used >= limit) return { allowed: false, used };
      if (admissionKey && this.ctx.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM run_admissions").toArray()[0]!.n >= 10000) return { allowed: false, used };
      this.ctx.storage.sql.exec("INSERT INTO runs(day,n) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET n=n+1", day);
      if (admissionKey) this.ctx.storage.sql.exec("INSERT INTO run_admissions VALUES(?,?)", admissionKey, day);
      return { allowed: true, used: used + 1 };
    });
  }

  async cancelTask(taskId: string): Promise<void> {
    const task = this.load().tasks[taskId];
    if (!task || task.status === "accepted") throw new Error("Cannot cancel");
    task.status = "cancelled";
    this.save();
  }

  /** Model/container failures must not leave a change claiming an agent is still working. */
  async failAgentTask(taskId: string, runId?: string): Promise<void> {
    const task = this.load().tasks[taskId];
    if (runId && task?.agentWorkflowInstanceId !== runId && task?.agentRunId !== runId) return;
    if (!task || ["accepted", "cancelled", "integrating", "verifying", "ready"].includes(task.status)) return;
    task.status = "blocked";
    task.blockedReason = "Agent run failed. Pushed checkpoints are preserved; retry the agent or continue on the saved branch.";
    task.updatedAt = new Date().toISOString();
    this.save();
    await this.logActivity("FlareGit", "agent.failed", `Agent on ${task.id} stopped. Saved checkpoints are preserved.`);
  }

  /** Acquire the single landing lease and freeze a candidate against the current accepted head. */
  async claimLanding(req: { holder: string; taskIds: string[]; preservationProtocolVersion?: 1 }): Promise<ClaimResult> {
    if(req.preservationProtocolVersion!==1)return {reason:"This integration run needs the contribution preservation upgrade. Start a new integration; saved work and reviews remain available."};
    await this.ensureRecoveryAlarm();
    const s = this.load();
    const now = Date.now();
    const lease = this.ctx.storage.sql.exec<{ holder: string; expires_at: number }>("SELECT holder, expires_at FROM lease WHERE id = 1").toArray()[0];
    if (lease && lease.expires_at > now && lease.holder !== req.holder) return { reason: "Another landing holds the lease" };
    if (req.taskIds.length < 1 || req.taskIds.length > 8 || new Set(req.taskIds).size !== req.taskIds.length) return { reason: "Integrate one to eight different changes" };

    const reruns=new LegacyCandidateReruns(this.ctx.storage),rerun=reruns.forWorkflow(req.holder);
    if(reruns.reservedForTasks(req.taskIds).some(value=>(value.continuationWorkflowId??value.successorWorkflowId)!==req.holder))return {reason:"These contributions belong to a saved owner rerun"};
    if(rerun){await this.assertLegacyCandidateRerun(rerun.id,undefined,undefined,undefined,req.holder);if(req.holder!==(rerun.continuationWorkflowId??rerun.successorWorkflowId))return {reason:"This saved rerun continues on its decision workflow"};if(JSON.stringify(req.taskIds)!==JSON.stringify(rerun.taskIds))return {reason:"Saved rerun task set changed"};if(rerun.phase==="awaiting_decision"&&rerun.successorDecisionId){const decision=s.decisions[rerun.successorDecisionId];if(!decision||decision.legacyRerunId!==rerun.id)return {reason:"Saved product decision changed"};return {decision};}if(JSON.stringify(req.taskIds)!==JSON.stringify(rerun.taskIds))return {reason:"Saved rerun scope changed"};if(rerun.phase==="attached"&&rerun.successorCandidateId)return {candidate:s.candidates[rerun.successorCandidateId]!};if(rerun.phase!=="reassigned")return {reason:"Saved rerun scope changed"};}
    const found = req.taskIds.map((id) => s.tasks[id]);
    if (found.some((t) => !t)) return { reason: "Unknown task" };
    const tasks = found as Task[];
    for (const t of tasks) {
      if (t.status === "accepted" || t.status === "cancelled") return { reason: `Task ${t.id} is ${t.status}` };
      if (t.status === "working" || t.status === "checkpointed" || t.status === "needs_decision") return { reason: `Task ${t.id} is not ready` };
      const parent = t.dependsOn ? s.tasks[t.dependsOn] : undefined;
      if (parent && parent.status !== "accepted" && !req.taskIds.includes(parent.id)) return { reason: `Task ${t.id} is stacked on ${parent.id}, which is not accepted` };
    }
    // Contradictions are a product decision: check every pair, and every change against what is already accepted.
    const approved = (t: Task) => t.requirements.filter((r) => r.status === "approved");
    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        const a = tasks[i]!;
        const b = tasks[j]!;
        for (const ra of approved(a)) {
          for (const rb of approved(b)) {
            if (!detectContradiction(ra, rb)) continue;
            const decision = createProductDecision(ra, rb);
            let deliveries: string[] = [];
            try {
                this.ctx.storage.transactionSync(() => {
                    if(rerun){this.assertLegacyRerunScope(rerun);decision.legacyRerunId=rerun.id;for(const task of tasks)task.status="needs_decision";reruns.awaitDecision(rerun.id,decision.id);}else a.status = b.status = "needs_decision";
                    s.decisions[decision.id] = decision;
                    deliveries = this.stageEvent("decision.needed", { decision: decision.id, question: decision.question });
                    this.save();
                    });
            } catch (error) { this.state = null; throw error; }
            for (const deliveryId of deliveries) await this.env.INTEGRATION_QUEUE.send({ type: "webhook.deliver", projectId: s.projectId, deliveryId }).catch(() => undefined);
            return { decision };
          }
        }
      }
    }
    const candidate = freezeCandidateGeneration({
      tasks,
      acceptedBaseCommit: s.acceptedState.currentCommit,
      policyVersion: s.policyVersion,
      verificationPolicy: s.verificationPolicy,
      approvedRequirements: [...s.acceptedState.activeRequirements, ...tasks.flatMap((t) => t.requirements)].filter((r: Requirement) => r.status === "approved"),
    });
    try {
      this.ctx.storage.transactionSync(() => {
        if (Object.hasOwn(s.candidates, candidate.id)) throw new Error("Candidate identity already exists; retry the integration claim");
        if(rerun){this.assertLegacyRerunScope(rerun);candidate.predecessorCandidateId=rerun.predecessorCandidateId;candidate.legacyRerunId=rerun.id;rerun.successorCandidateId=candidate.id;rerun.phase="attached";reruns.save(rerun);}
        candidate.workflowInstanceId = req.holder;
        candidate.preservationProtocolVersion = 1;
        candidate.frozenExternalChecksPolicy = structuredClone(this.connections().policy());
        candidate.frozenContributorProofs = tasks.map((task) => ({ id: task.id, commit: task.currentCommit, baseCommit: task.baseCommit, ref: `refs/flaregit/tasks/${task.id}`, allowedScope: [...(task.allowedScope ?? settingsFor(s.verificationPolicy).allowedScope)] }));
        s.candidates[candidate.id] = candidate;
        for (const t of tasks) {
          t.status = "integrating";
          t.activeCandidateId = candidate.id;
        }
        this.ctx.storage.sql.exec("INSERT INTO lease (id, holder, expires_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at", req.holder, now + LEASE_MS);
        this.save();
      });
    } catch (error) { this.state = null; throw error; }
    return { candidate };
  }

  private legacyCandidateRerunFrozen(candidateId:string):boolean{return new LegacyCandidateReruns(this.ctx.storage).hasCandidate(candidateId);}
  private assertCandidateNotRerunFrozen(candidateId:string):void{if(this.legacyCandidateRerunFrozen(candidateId))throw new LegacyRerunError("This predecessor is preserved by an explicit owner rerun. Continue on its linked fresh candidate.");}

  async recordComposition(candidateId: string, attempts: RepairAttempt[]): Promise<void> {
    this.assertCandidateNotRerunFrozen(candidateId);
    const candidate = this.load().candidates[candidateId];
    if (!candidate) throw new Error("Unknown candidate");
    candidate.repairAttempts = attempts;
    candidate.compositionMethod = attempts.length ? "repaired_merge" : "clean_git_merge";
    this.save();
  }

  async recordVerification(candidateId: string, commit: string, evidence: VerificationEvidence): Promise<void> {
    this.assertCandidateNotRerunFrozen(candidateId);
    const s = this.load();
    const c = s.candidates[candidateId];
    if (!c) throw new Error("Unknown candidate");
    s.evidence[evidence.id] = evidence;
    c.candidateCommit = commit;
    c.evidenceId = evidence.id;
    c.status = evidence.status === "passed" && evidence.candidateCommit === commit ? "verified" : "verifying";
    this.save();
  }

  protected publicationRecoveryProvider():Pick<Env,"ARTIFACTS"> {return this.env;}
  private publicationReadbackScope(journal:PublicationJournalEntry):string {
    const state=this.load(),candidate=state.candidates[journal.candidateId];
    if(!candidate)throw new Error("Publication candidate unavailable");
    return JSON.stringify({projectId:state.projectId,incarnation:this.readRepositoryIncarnation(),canonicalRepoName:state.canonicalRepoName,journal:{id:journal.id,candidateId:journal.candidateId,candidateCommit:journal.candidateCommit,candidateTree:journal.candidateTree,expectedHead:journal.expectedHead,newHead:journal.newHead,outputDigest:journal.outputDigest,publicationAuthority:journal.publicationAuthority},candidateCommit:candidate.candidateCommit,evidenceId:candidate.evidenceId,policyVersion:candidate.frozenPolicyVersion,branch:state.defaultBranch??"main"});
  }
  async ownerPublicationReadbacks(actor:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number):Promise<PublicationReadbackReport[]> {
    const assert=await this.authorizeRebaseRecovery(actor,credentialHash,sessionExpiresAt);assert();const ledger=new PublicationReadbacks(this.ctx.storage);
    return this.load().journal.filter(journal=>journal.state==="PREPARED"&&this.legacyPreparedPublication(journal.candidateId)).slice(0,50).map(journal=>ledger.report(journal.id,this.publicationReadbackScope(journal))??{journalId:journal.id,reason:"awaiting_readback",checkedAt:journal.timestamp,automaticAttempts:0,canCheck:true});
  }
  async checkOwnerPublicationReadback(journalId:string,requestId:string,actor:HumanDecisionActor,credentialHash?:string,sessionExpiresAt?:number):Promise<PublicationReadbackReport>{
    const authorize=async()=>{const assert=await this.authorizeRebaseRecovery(actor,credentialHash,sessionExpiresAt);assert();};await authorize();return this.checkLegacyPublicationReadback(journalId,"manual",requestId,authorize);
  }
  private async checkLegacyPublicationReadback(journalId:string,mode:"automatic"|"manual",requestId?:string,ownerAuthorize?:()=>Promise<void>):Promise<PublicationReadbackReport>{
    const ledger=new PublicationReadbacks(this.ctx.storage),journal=this.load().journal.find(item=>item.id===journalId);
    if(!journal)throw new Error("Publication recovery scope unavailable");
    new PrivateRecoveryOperations(this.ctx.storage).incarnation();
    const scope=this.publicationReadbackScope(journal);
    if(mode==="manual"&&requestId){const replay=ledger.replay(journalId,requestId,scope);if(replay)return replay;}
    if(journal.state!=="PREPARED"||!this.legacyPreparedPublication(journal.candidateId))throw new Error("Pending legacy publication unavailable");
    if(!ledger.claim(journalId,scope,mode,requestId))return ledger.report(journalId,scope)!;
    let result:PublicationReadbackResult={reason:"provider_unavailable",checkedAt:new Date().toISOString()};
    try{
      const state=this.load(),candidate=state.candidates[journal.candidateId],evidence=candidate?.evidenceId?state.evidence[candidate.evidenceId]:null;
      if(!candidate||candidate.candidateCommit!==journal.newHead||journal.candidateCommit!==journal.newHead||candidate.expectedAcceptedBase!==journal.expectedHead||!evidence||evidence.candidateCommit!==journal.newHead||evidence.candidateTree!==journal.candidateTree)throw new Error("Publication journal proof scope differs");
      const ownerId=this.ctx.storage.sql.exec<{user_id:string}>("SELECT user_id FROM members WHERE role='owner' ORDER BY user_id LIMIT 1").toArray()[0]?.user_id;if(!ownerId)throw new RepositoryReadError(503,"authorization");
      const context=await this.repositoryReadContext(ownerId);if(!context.incarnation)throw new RepositoryReadError(503,"authorization");
      const authorize=async()=>{await ownerAuthorize?.();if(!await this.assertRepositoryReadContext(context,ownerId)||this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",ownerId).toArray()[0]?.role!=="owner"||this.publicationReadbackScope(journal)!==scope||this.load().journal.find(item=>item.id===journalId)?.state!=="PREPARED")throw new RepositoryReadError(503,"authorization");};
      using repository=await openRepositoryRead(this.publicationRecoveryProvider(),{repoName:context.canonicalRepoName,authorize,reserveGroup:id=>globalOf(this.env).reserveRepositoryReadOperation(id,context.accountKey),limits:{maxProviderCalls:16,deadlineMs:10000}});
      result=await inspectPublicationReadback(repository,this.load().defaultBranch??"main",journal.newHead,journal.candidateTree??"");await authorize();
      if(result.reason==="confirmed"){
        // No await between the final scope fence and entering completePublish.
        // completePublish reconciles existing history rather than dispatching a push.
        await this.completePublish(journalId,scope);
        const workflow=this.load().candidates[journal.candidateId]?.workflowInstanceId;
        if(workflow&&this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='integration_dispatch_receipts'").toArray().length&&this.ctx.storage.sql.exec("SELECT event_id FROM integration_dispatch_receipts WHERE event_id=?",workflow).toArray().length)await this.recordIntegrationDispatchOutcome(workflow,"accepted");
      }
    }catch(error){if(!(result.reason==="confirmed"&&this.load().journal.some(item=>item.id===journalId&&item.state==="ACCEPTED"&&item.newHead===journal.newHead))){result={reason:error instanceof RepositoryReadError?(error.reason==="authorization"?"scope_changed":error.reason==="account_budget"||error.reason==="global_budget"||error.reason==="unconfigured"?"capacity_unavailable":"provider_unavailable"):"provider_unavailable",checkedAt:new Date().toISOString()};}}
    ledger.save(journalId,scope,result);return ledger.report(journalId,scope)!;
  }
  private async reconcileLegacyPublicationReadbacks():Promise<void>{
    if(!this.ctx.storage.sql.exec("SELECT id FROM project WHERE id=1").toArray().length||this.repositoryDeleting())return;
    const ledger=new PublicationReadbacks(this.ctx.storage),pending=this.load().journal.filter(journal=>journal.state==="PREPARED"&&this.legacyPreparedPublication(journal.candidateId));
    const eligible=pending.find(journal=>(ledger.report(journal.id)?.automaticAttempts??0)<4);if(eligible){try{await this.checkLegacyPublicationReadback(eligible.id,"automatic");}catch{return;}}
    if(pending.some(journal=>(ledger.report(journal.id)?.automaticAttempts??0)<4))await this.ensureRecoveryAlarm();
  }

  private legacyPreparedPublication(candidateId:string): boolean {
    const state=this.load(),candidate=state.candidates[candidateId];
    return !!candidate&&candidate.status!=="accepted"&&!!this.candidatePreservationFailure(candidate)&&state.journal.some(journal=>journal.candidateId===candidateId&&journal.state==="PREPARED");
  }

  /** Applies only to NEW publication, never reconciliation of a confirmed Git update. */
  private candidatePreservationFailure(candidate: CandidateGeneration): string | null {
    const upgrade="This candidate needs the contribution preservation upgrade. Start a new integration from the saved changes; this review and candidate remain available.";
    if(candidate.preservationProtocolVersion!==1)return upgrade;
    const state=this.load(),incarnation=this.readRepositoryIncarnation();
    if(!incarnation||!candidate.workflowInstanceId||candidate.participatingTaskIds.length<1||candidate.participatingTaskIds.length>8||new Set(candidate.participatingTaskIds).size!==candidate.participatingTaskIds.length)return "Frozen contribution preservation scope is unavailable";
    const ledger=new RetainedInputs(this.ctx.storage);
    for(const taskId of candidate.participatingTaskIds){
      const commit=candidate.participatingCommits[taskId];
      const proof=candidate.frozenContributorProofs?.find(item=>item.id===taskId&&item.commit===commit);
      if(!commit||!proof)return "Frozen contribution preservation proof is unavailable";
      const receipt=ledger.lookup(taskId,candidate.id,commit,proof.baseCommit);
      if(!receipt||receipt.followup||receipt.projectId!==state.projectId||receipt.incarnation!==incarnation||receipt.canonicalRepoName!==state.canonicalRepoName||receipt.workflowId!==candidate.workflowInstanceId||receipt.protectedRef!==`refs/flaregit/inputs/${incarnation}/${taskId}/${commit}`||receipt.protectedBaseRef!==`refs/flaregit/inputs/${incarnation}/${taskId}/${proof.baseCommit}`)return "Original contribution and base were not confirmed in protected Git refs. Publication is waiting for preservation.";
    }
    return null;
  }

  /** Ledger step 1: validate every invariant, then journal PREPARED. The workflow then pushes with a lease. */
  async preparePublish(candidateId: string): Promise<PrepareResult> {
    if(this.legacyCandidateRerunFrozen(candidateId))return {ok:false,error:"This preserved predecessor has a saved owner rerun. Review the linked fresh candidate before publication."};
    if(this.legacyPreparedPublication(candidateId)){await this.ensureRecoveryAlarm();return {ok:false,recoveryRequired:true,error:"A previously prepared publication needs Git readback before recovery. Its journal, review and saved changes remain pending."};}
    const recorded = this.load().candidates[candidateId]?.review;
    if (!recorded?.actor) return { ok: false, error: "The previous approval has no verified owner identity. Run a new candidate and review it before publishing." };
    let assertCurrent: () => void;
    try { assertCurrent = await this.authorizeHumanDecision(recorded.actor); assertCurrent(); }
    catch { return { ok: false, error: "The approving owner no longer has publication authority" }; }
    const s = this.load();
    const c = s.candidates[candidateId];
    const ev = c?.evidenceId ? s.evidence[c.evidenceId] : undefined;
    if (!c || !ev || !c.candidateCommit) return { ok: false, error: "No verified candidate" };
    if(this.legacyCandidateRerunFrozen(candidateId))return {ok:false,error:"This predecessor is preserved by an owner rerun."};
    const preservationFailure=this.candidatePreservationFailure(c);
    if(preservationFailure)return {ok:false,error:preservationFailure};
    // Nothing becomes accepted history without a human approving this exact commit.
    if (!c.review?.approved || c.review.commit !== c.candidateCommit || c.review.actor?.userId !== recorded.actor.userId) return { ok: false, error: "No current owner approval for this candidate commit" };
    if (ev.status !== "passed" || ev.candidateCommit !== c.candidateCommit) return { ok: false, error: "Evidence does not match candidate" };
    const external = this.connections().candidateState(candidateId);
    if (external && (external.frozen.repositoryId !== s.projectId || external.frozen.candidateId !== candidateId || external.frozen.commit !== c.candidateCommit || external.frozen.tree !== ev.candidateTree || externalCheckGate(external) !== "passed")) return { ok: false, error: "Required external checks have not passed for this exact candidate" };
    const externalOnly = c.frozenExternalChecksPolicy?.mode === "external";
    if (externalOnly && (!isCommandPolicy(c.frozenVerificationPolicy) || !external || !c.frozenContributorProofs?.length || !external.frozen.policy.checks.some((check) => check.required) || JSON.stringify(external.frozen.policy) !== JSON.stringify(c.frozenExternalChecksPolicy))) return { ok: false, error: "External CI policy and contributor proof are unavailable for this candidate" };
    const verifierIdentity = externalOnly ? VERIFIER_IDENTITIES.external : isCommandPolicy(c.frozenVerificationPolicy) ? VERIFIER_IDENTITIES.custom : VERIFIER_IDENTITIES["ticket-booking"];
    if (ev.verifierIdentity !== verifierIdentity) return { ok: false, error: "Candidate needs verification with the current isolated verifier before publication" };
    if (ev.expectedAcceptedBase !== c.expectedAcceptedBase || ev.requirementsVersion !== c.frozenPolicyVersion) return { ok: false, error: "Evidence was produced for different inputs" };
    const cancelled = c.participatingTaskIds.filter((id) => s.tasks[id]?.status === "cancelled");
    if (cancelled.length > 0) return { ok: false, error: `Task ${cancelled[0]} was cancelled before publication` };
    if (s.acceptedState.currentCommit !== c.expectedAcceptedBase) {
      c.status = "stale";
      this.save();
      return { ok: false, stale: true, error: "Accepted head moved" };
    }
    const prepared = s.journal.find(item => item.candidateId === candidateId && item.state === "PREPARED" && item.newHead === c.candidateCommit && item.expectedHead === c.expectedAcceptedBase && item.candidateTree === ev.candidateTree && item.publicationAuthority?.actor.userId === recorded.actor!.userId && item.publicationAuthority.policyVersion === c.frozenPolicyVersion);
    if (prepared) return { ok: true, journal: prepared };
    const journal: PublicationJournalEntry = {
      id: `jrnl_${crypto.randomUUID()}`,
      candidateId,
      candidateCommit: c.candidateCommit,
      candidateTree: ev.candidateTree,
      expectedHead: c.expectedAcceptedBase,
      newHead: c.candidateCommit,
      outputDigest: ev.builtOutputDigest,
      state: "PREPARED",
      publicationAuthority: { actor: { ...recorded.actor }, reviewedAt: recorded.at, commit: c.candidateCommit, tree: ev.candidateTree, policyVersion: c.frozenPolicyVersion, authorizedAt: new Date().toISOString() },
      timestamp: new Date().toISOString(),
    };
    try {
      this.ctx.storage.transactionSync(() => { assertCurrent(); this.assertCandidateNotRerunFrozen(candidateId); s.journal.push(journal); this.save(); });
    } catch (cause) { this.state = null; throw cause; }
    return { ok: true, journal };
  }

  /** Fresh authorization for a new Git dispatch; confirmed ref updates reconcile independently. */
  async authorizeCandidatePublication(candidateId: string, commit: string): Promise<boolean> {
    if(this.legacyCandidateRerunFrozen(candidateId))return false;
    const recorded = this.load().candidates[candidateId]?.review;
    if (!recorded?.approved || recorded.commit !== commit || !recorded.actor) return false;
    let assertCurrent: () => void;
    try { assertCurrent = await this.authorizeHumanDecision(recorded.actor); assertCurrent(); }
    catch { return false; }
    const state = this.load(), candidate = state.candidates[candidateId];
    if(!candidate||this.legacyCandidateRerunFrozen(candidateId)||this.candidatePreservationFailure(candidate))return false;
    const evidence = candidate?.evidenceId ? state.evidence[candidate.evidenceId] : undefined;
    const journal = state.journal.find(item => item.candidateId === candidateId && item.state === "PREPARED" && item.newHead === commit);
    const authority = journal?.publicationAuthority;
    return !!candidate && candidate.candidateCommit === commit && candidate.review?.approved === true && candidate.review.commit === commit && candidate.review.actor?.userId === recorded.actor.userId && !!authority && authority.actor.userId === recorded.actor.userId && authority.commit === commit && authority.tree === evidence?.candidateTree && authority.policyVersion === candidate.frozenPolicyVersion;
  }

  /** Ledger step 2: the Artifacts ref update succeeded (or was found already applied). */
  async completePublish(journalId: string, readbackScope?:string): Promise<void> {
    // Arm recovery before loading state or committing the outbox; no async boundary
    // separates the ledger snapshot from its atomic update.
    await this.ensureRecoveryAlarm();
    const s = this.load();
    const j = s.journal.find((e) => e.id === journalId);
    if(readbackScope&&j?.state!=="ACCEPTED"&&(!j||this.publicationReadbackScope(j)!==readbackScope))throw new Error("Publication proof scope changed before reconciliation");
    if (!j) throw new Error("Unknown journal entry");
    if (j.state === "ABORTED") throw new Error("Aborted publication cannot be accepted");
    const alreadyAccepted = j.state === "ACCEPTED";
    const c = s.candidates[j.candidateId]!;
    const advanceHead = s.acceptedState.currentCommit === j.expectedHead || s.acceptedState.currentCommit === j.newHead;
    let deliveries: string[] = [];
    try {
      if (!alreadyAccepted) this.ctx.storage.transactionSync(() => {
        j.state = "ACCEPTED";
        j.timestamp = new Date().toISOString();
        c.status = "accepted";
        if (advanceHead) {
          s.acceptedState.currentCommit = j.newHead;
          s.acceptedState.buildDigest = j.outputDigest;
          s.acceptedState.acceptedAt = j.timestamp;
        }
        s.acceptedState.history.push({ commit: j.newHead, candidateId: c.id, acceptedAt: j.timestamp, participatingTasks: c.participatingTaskIds, evidenceId: c.evidenceId!, outputDigest: j.outputDigest });
        for (const id of c.participatingTaskIds) {
          const t = s.tasks[id]!;
          if (!t.activeCandidateId || t.activeCandidateId === c.id) t.status = t.currentCommit === c.participatingCommits[id] ? "accepted" : "ready";
        }
        if (advanceHead && s.policyVersion === c.frozenPolicyVersion) {
          for (const requirement of c.frozenRequirements) {
            if (requirement.status === "approved" && !s.acceptedState.activeRequirements.some((active) => active.id === requirement.id)) s.acceptedState.activeRequirements.push(requirement);
          }
        }
        if (c.workflowInstanceId) this.ctx.storage.sql.exec("DELETE FROM lease WHERE id = 1 AND holder = ?", c.workflowInstanceId);
        deliveries = this.stageEvent("change.accepted", { commit: j.newHead, changes: c.participatingTaskIds, tree: j.candidateTree ?? null });
        this.save();
        });
    } catch (error) {
      // SQL rolled back, so discard the mutated cache before the next RPC retries.
      this.state = null;
      throw error;
    }
    for (const deliveryId of deliveries) await this.env.INTEGRATION_QUEUE.send({ type: "webhook.deliver", projectId: s.projectId, deliveryId }).catch(() => undefined);
    // Issues resolved by accepted changes close with a pointer to the commit that is now in history.
    for (const id of c.participatingTaskIds) {
      const t = s.tasks[id]!;
      if (t.status !== "accepted" || !t.issue) continue;
      const issue = this.issueRow(t.issue);
      if (!issue || issue.state === "closed") continue;
      const subject = `issue:${t.issue}`;
      const exists = this.ctx.storage.sql.exec('SELECT id FROM comments WHERE subject = ? AND author = ? AND "commit" = ? LIMIT 1', subject, "FlareGit", j.newHead).toArray().length > 0;
      if (!exists) await this.addComment({ subject, author: "FlareGit", body: `Resolved by change ${t.id}, accepted as ${j.newHead.slice(0, 7)}.`, commit: j.newHead });
      await this.setIssueState(t.issue, "closed", `change ${t.id}`);
    }
    await this.logActivity("FlareGit", "integration.accepted", `Accepted ${j.newHead.slice(0, 7)} (${c.participatingTaskIds.join(" + ")})`);
  }

  /** Verified and waiting: a person must accept (or reject) this exact commit before it can land. */
  async awaitReview(candidateId: string, commit: string, workflowInstanceId: string): Promise<void> {
    this.assertCandidateNotRerunFrozen(candidateId);
    const s = this.load();
    const c = s.candidates[candidateId];
    if (!c || c.candidateCommit !== commit) return;
    const evidence = c.evidenceId ? s.evidence[c.evidenceId] : undefined;
    if (!evidence || evidence.candidateCommit !== commit) throw new Error("Candidate evidence is unavailable");
    const ledger = this.connections();
    const external = ledger.candidateState(candidateId) ?? ledger.freeze({ repositoryId: s.projectId, candidateId, commit, tree: evidence.candidateTree, policy: c.frozenExternalChecksPolicy ?? ledger.policy() });
    if (external.frozen.commit !== commit || external.frozen.tree !== evidence.candidateTree) throw new Error("Frozen checks belong to another candidate revision");
    for (const check of external.frozen.policy.checks) {
      if (!external.selectedRuns[check.id]) ledger.registerRun(candidateId, check.id, `run_${crypto.randomUUID()}`);
    }
    c.status = "awaiting_review";
    c.workflowInstanceId = workflowInstanceId;
    c.updatedAt = new Date().toISOString();
    this.save();
    await this.logActivity("FlareGit", "review.requested", `Verified candidate ${commit.slice(0, 7)} (${c.participatingTaskIds.join(" + ")}) is waiting for review`);
  }
  private async authorizeHumanDecision(actor: HumanDecisionActor, credentialHash?: string, requireCredential = false): Promise<() => void> {
    if (!actor || typeof actor.userId !== "string" || !actor.userId || typeof actor.displayName !== "string" || !actor.displayName || actor.displayName.length > 120 || typeof actor.viaToken !== "boolean") throw new Error("Server-derived owner identity is required");
    const initial = this.load();
    const projectId = initial.projectId, canonicalRepoName = initial.canonicalRepoName;
    const assertCurrent = () => {
      const current = this.load();
      const role = this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?", actor.userId).toArray()[0]?.role;
      if (this.repositoryDeleting() || role !== "owner" || current.projectId !== projectId || current.canonicalRepoName !== canonicalRepoName) throw new Error("Repository owner authority changed");
    };
    assertCurrent();
    const accountKey = await accountKeyFor(actor.userId);
    const account = accountOf(this.env, accountKey);
    if (await account.accountLifecycle() !== "active") throw new Error("Repository owner account is unavailable");
    if (requireCredential && actor.viaToken && (!credentialHash || !await account.apiTokenHashCanAdminister(credentialHash, actor.userId, projectId))) throw new Error("Repository owner token authority changed");
    assertCurrent();
    return assertCurrent;
  }
  async recordReview(candidateId: string, review: { approved: boolean; actor: HumanDecisionActor; note?: string }, expectedCommit: string, credentialHash?: string): Promise<{ ok: boolean; instanceId?: string; error?: string; review?: CandidateGeneration["review"] }> {
    const assertCurrent = await this.authorizeHumanDecision(review.actor, credentialHash, true);
    assertCurrent();
    const s = this.load();
    const c = s.candidates[candidateId];
    if(this.legacyCandidateRerunFrozen(candidateId))return {ok:false,error:"This preserved predecessor has a saved owner rerun. Review its linked fresh candidate."};
    if (!c || !c.candidateCommit || !c.workflowInstanceId) return { ok: false, error: "This candidate is not waiting for review" };
    if (!/^[a-f0-9]{40}$/.test(expectedCommit ?? "") || expectedCommit !== c.candidateCommit) return { ok: false, error: "The candidate changed from the commit you reviewed. Refresh and inspect its diff before deciding." };
    if(review.approved){const preservationFailure=this.candidatePreservationFailure(c);if(preservationFailure)return {ok:false,error:preservationFailure};}
    // Idempotent: the same decision can be re-sent if notifying the integration run failed the first time.
    if (c.review && c.review.commit === c.candidateCommit && (c.status === "verified" || c.status === "failed") && !s.journal.some((j) => j.candidateId === c.id)) {
      return c.review.approved === review.approved && (c.review.note ?? "") === (review.note ?? "") ? { ok: true, instanceId: c.workflowInstanceId, review: c.review } : { ok: false, error: `Already ${c.review.approved ? "approved" : "rejected"} by ${c.review.by}` };
    }
    if (c.status !== "awaiting_review") return { ok: false, error: "This candidate is not waiting for review" };
    const external = this.connections().candidateState(candidateId);
    const evidence = c.evidenceId ? s.evidence[c.evidenceId] : undefined;
    if (review.approved && c.frozenExternalChecksPolicy?.checks.some((check) => check.required) && !external) return { ok: false, error: "Required external check evidence is unavailable" };
    if (review.approved && external && (external.frozen.repositoryId !== s.projectId || external.frozen.candidateId !== candidateId || external.frozen.commit !== c.candidateCommit || external.frozen.tree !== evidence?.candidateTree || externalCheckGate(external) !== "passed")) return { ok: false, error: "Required external checks must pass for this exact candidate before acceptance" };
    try {
      this.ctx.storage.transactionSync(() => {
        assertCurrent();
        this.assertCandidateNotRerunFrozen(candidateId);
        c.review = { ...review, actor: { ...review.actor }, by: review.actor.displayName, at: new Date().toISOString(), commit: c.candidateCommit! };
        c.status = review.approved ? "verified" : "failed";
        c.updatedAt = new Date().toISOString();
        this.save();
      });
    } catch (cause) { this.state = null; throw cause; }
    await this.logActivity(review.actor.displayName, review.approved ? "review.approved" : "review.rejected", `${review.approved ? "Approved" : "Rejected"} ${c.candidateCommit.slice(0, 7)}${review.note ? `: ${review.note.slice(0, 160)}` : ""}`);
    return { ok: true, instanceId: c.workflowInstanceId, review: c.review };
  }

  async abortPublish(candidateId: string, journalId: string | undefined, reason: string, outcome: "failed" | "stale"): Promise<void> {
    await this.ensureRecoveryAlarm();
    // Cancellation cleanup must not turn the preserved predecessor or its tasks into a fabricated failure.
    if(this.legacyCandidateRerunFrozen(candidateId))return;
    const s = this.load();
    const c = s.candidates[candidateId];
    if (!c) return;
    const j = journalId ? s.journal.find((e) => e.id === journalId) : undefined;
    if(this.legacyPreparedPublication(candidateId))return;
    if (c.status === "accepted" || j?.state === "ACCEPTED") return;
    if (c.status === outcome && (!j || j.state === "ABORTED")) return;
    let deliveries: string[] = [];
    try {
      this.ctx.storage.transactionSync(() => {
        if (j) Object.assign(j, { state: "ABORTED", error: reason, timestamp: new Date().toISOString() });
        c.status = outcome;
        c.failureBlocker = outcome === "failed" ? reason : undefined;
        for (const id of c.participatingTaskIds) {
          const t = s.tasks[id]!;
          if (t.status === "cancelled" || (t.activeCandidateId && t.activeCandidateId !== c.id)) continue;
          t.status = outcome === "stale" ? "ready" : "blocked";
          t.blockedReason = outcome === "failed" ? reason : undefined;
        }
        if (c.workflowInstanceId) this.ctx.storage.sql.exec("DELETE FROM lease WHERE id = 1 AND holder = ?", c.workflowInstanceId);
        if (outcome === "failed") deliveries = this.stageEvent("change.blocked", { changes: c.participatingTaskIds, reason: reason.slice(0, 280) });
        this.save();
      });
    } catch (error) { this.state = null; throw error; }
    for (const deliveryId of deliveries) await this.env.INTEGRATION_QUEUE.send({ type: "webhook.deliver", projectId: s.projectId, deliveryId }).catch(() => undefined);
    await this.logActivity("FlareGit", outcome === "stale" ? "integration.stale" : "integration.blocked", outcome === "stale" ? "Base moved; will recompose" : `Blocked: ${reason}`.slice(0, 280));
  }

  async resolveDecision(decisionId: string, selectedOptionId: string, actor: HumanDecisionActor, credentialHash?: string, sessionExpiresAt?:number): Promise<{ taskIds: string[];legacyRerunId?:string;continuationWorkflowId?:string }> {
    let assertCurrent = await this.authorizeHumanDecision(actor, credentialHash, true);
    assertCurrent();
    const s = this.load();
    const d = s.decisions[decisionId];
    if (!d) throw new Error("Unknown decision");
    const reruns=new LegacyCandidateReruns(this.ctx.storage),rerun=d.legacyRerunId?reruns.get(d.legacyRerunId):null;
    if(d.legacyRerunId&&(!rerun||(rerun.successorDecisionId!==decisionId&&(d.status!=="resolved"||!rerun.decisionIds?.includes(decisionId)))))throw new LegacyRerunError("Saved rerun decision scope changed.");
    if(rerun)this.assertLegacyRerunScope(rerun);
    const continuationWorkflowId=rerun?`decision-${s.projectId}-${decisionId}`:undefined;
    if(rerun&&(s.projectId!==rerun.snapshot.projectId||this.readRepositoryIncarnation()!==rerun.snapshot.incarnation||s.canonicalRepoName!==rerun.snapshot.canonicalRepoName||JSON.stringify(s.candidates[rerun.predecessorCandidateId])!==JSON.stringify(rerun.snapshot.candidate)))throw new LegacyRerunError("Historical decision scope changed.");
    if (d.status === "resolved") {
      if (d.selectedOptionId !== selectedOptionId) throw new Error("This decision was already resolved with a different option");
      return { taskIds: [...(d.resolvedTaskIds ?? [])],...(rerun?{legacyRerunId:rerun.id,continuationWorkflowId}: {}) };
    }
    if (d.status !== "pending") throw new Error("This decision is not awaiting a choice");
    if(rerun){
      const scopeKey=JSON.stringify({projectId:s.projectId,incarnation:this.readRepositoryIncarnation(),canonicalRepoName:s.canonicalRepoName});
      const authorize=async()=>{assertCurrent=await this.authorizeRebaseRecovery(actor,credentialHash,sessionExpiresAt);assertCurrent();if(JSON.stringify({projectId:this.load().projectId,incarnation:this.readRepositoryIncarnation(),canonicalRepoName:this.load().canonicalRepoName})!==scopeKey)throw new LegacyRerunError("Decision repository scope changed.");this.assertLegacyRerunScope(rerun);};
      await authorize();const accountKey=await accountKeyFor(actor.userId);await authorize();
      for(const task of rerun.snapshot.tasks){using repository=await openRepositoryRead(this.env,{repoName:task.workspace.repoName,authorize,reserveGroup:operationId=>globalOf(this.env).reserveCoreGitOperation(operationId,accountKey,this.currentGitBudget()),limits:{maxProviderCalls:8,deadlineMs:10000}});const head=(await repository.log({ref:`refs/heads/${task.workspace.branch}`,limit:1}))[0]?.hash;if(head!==task.currentCommit)throw new LegacyRerunError("A contribution branch advanced. No product choice or continuation was applied.");}
      await authorize();
    }

    const [idA, idB] = d.conflictingRequirementIds;
    if (selectedOptionId !== idA && selectedOptionId !== idB) throw new Error("Unknown option");
    const taskIds: string[] = [];
    try {
      this.ctx.storage.transactionSync(() => {
        assertCurrent();
        if(rerun){this.assertLegacyRerunScope(rerun);if(rerun.phase!=="awaiting_decision")throw new LegacyRerunError("This decision no longer owns the rerun inputs.");}
        d.selectedOptionId = selectedOptionId;
        d.status = "resolved";
        d.resolvedAt = new Date().toISOString();
        d.resolvedBy = { ...actor };
        for (const t of rerun?rerun.taskIds.map(id=>s.tasks[id]!):Object.values(s.tasks)) {
          for (const r of t.requirements) {
            if (r.id === (selectedOptionId === idA ? idB : idA)) r.status = "superseded";
            if (r.id === selectedOptionId && r.policyPatch) {
              s.verificationPolicy = { ...s.verificationPolicy, ...r.policyPatch };
              s.policyVersion += 1;
            }
          }
          if (t.status === "needs_decision") {
            t.status = "ready";
            taskIds.push(t.id);
          }
        }
        d.resolvedTaskIds = [...taskIds];
        if(rerun){if(JSON.stringify(taskIds)!==JSON.stringify(rerun.taskIds))throw new LegacyRerunError("The decision task set changed; recovery is required.");reruns.continueDecision(rerun.id,decisionId,continuationWorkflowId!,actor,credentialHash);}
        this.save();
      });
    } catch (cause) { this.state = null; throw cause; }
    return { taskIds,...(rerun?{legacyRerunId:rerun.id,continuationWorkflowId}: {}) };
  }
}
