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
import { RepositoryDiscussions } from "./repository-discussions.js";
import { ArtifactAllocationFence, type PendingArtifactAllocation } from "./allocation-fence.js";
import { ArtifactStorageAdmission, type ArtifactKind, type StorageAdmissionPolicy, type StorageReservation } from "./storage-admission.js";
import { CoreGitOperationLedger, type CoreGitBudget, type CoreGitAdmission } from "./core-git-budget.js";
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
import type { PublicProfileState } from "./public-profile.js";
import type { ImportJob } from "./import-job.js";
import type { PublicRepositoryGrant } from "./public-repositories.js";
import { AgentRunLedger, type AgentRunInput, type AgentRunRecord, type AgentRunClaim } from "./agent-run-ledger.js";
import { actorName, RepositoryPublicCommunity, type PublicCommunityActor, type PublicCommunityPolicy, type PublicPost, type ContributionRequest } from "./public-community.js";
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
export interface PrepareResult { ok: boolean; journal?: PublicationJournalEntry; error?: string; stale?: boolean }

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

export interface ImportHistoryOperation { projectId: string; head: string; canonicalRepoName: string; ownerId: string; instanceId: string; createdAt: string }

export interface Ledger {
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
  reserveCoreGitOperation(operationId: string, accountKey: string, budget: CoreGitBudget): Promise<CoreGitAdmission>;
  markManagedDispatchAttempted(runIds: string[], accountKey: string): Promise<void>;
  cancelUnstartedManagedSpend(runIds: string[], accountKey: string): Promise<void>;
  managedSpendReserved(month: string, accountKey?: string): Promise<number>;
  reserveManagedSpendBatch(inputs: ManagedEnvelope[], budget: ManagedBudget): Promise<ManagedAdmission[]>;
  reserveManagedSpend(input: ManagedEnvelope, budget: ManagedBudget): Promise<ManagedAdmission>;
  consumeManagedSpend(runId: string, inputBytes: number, outputTokens: number, containerSeconds: number): Promise<ManagedReservation>;

  acceptedDeploymentTarget(journalId:string):Promise<{canonicalRepoName:string;target:AcceptedDeploymentTarget}|null>;
  acceptedDeploymentTargets():Promise<AcceptedDeploymentTarget[]>;
  privateRecoveryTargets():Promise<PrivateRecoveryTarget[]>;
  listDeployments():Promise<DeploymentRecord[]>;
  requestDeployment(target:AcceptedDeploymentTarget,serviceId:string,environment:string,key:string,actorId:string):Promise<{kind:"created"|"duplicate";deployment:DeploymentRecord}>;
  discussionList(publicOnly:boolean,actor?:PublicCommunityActor):Promise<ReturnType<RepositoryDiscussions["list"]>>;
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
  claimImportHistoryOperation(input: { projectId: string; head: string; canonicalRepoName: string; ownerId: string; instanceId: string }): Promise<ImportHistoryOperation>;
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
  registerWorkflow(instanceId: string, kind: "agent" | "integration" | "scenario", taskId?: string, actorId?: string): Promise<void>;
  getWorkflowRun(instanceId: string): Promise<{ instanceId: string; kind: "agent" | "integration" | "scenario"; actorId: string | null } | null>;
  admitIntegrationDispatch(eventId: string, taskIds: string[]): Promise<{ terminal: boolean; actorId: string | null }>;
  recordIntegrationDispatchOutcome(eventId: string, status: WorkflowOutcome): Promise<void>;
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
  applyRebase(taskId: string, r: { commit?: string; base?: string; parentAccepted?: boolean; failed?: string }): Promise<void>;
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
  resolveDecision(decisionId: string, selectedOptionId: string, actor: HumanDecisionActor, credentialHash?: string): Promise<{ taskIds: string[] }>;
  getState(): Promise<FlareGitProjectState>;
  claimLanding(req: { holder: string; taskIds: string[] }): Promise<ClaimResult>;
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
    const s = this.load();
    const task = s.tasks[ev.taskId];
    if (!task || task.status === "cancelled" || task.status === "accepted") return { applied: false };
    let deliveries: string[] = [];
    let applied = false;
    try {
      this.ctx.storage.transactionSync(() => {
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
  /** Records the result of re-basing a stacked change onto its parent's new tip. */
  async applyRebase(taskId: string, r: { commit?: string; base?: string; parentAccepted?: boolean; failed?: string }): Promise<void> {
    const s = this.load();
    const task = s.tasks[taskId];
    if (!task) return;
    if (r.failed) {
      task.status = "blocked";
      task.blockedReason = r.failed;
    } else if (r.commit && r.base) {
      task.currentCommit = r.commit;
      task.baseCommit = r.base;
      if (r.parentAccepted) delete task.dependsOn;
      if (task.status === "blocked") { task.status = "working"; delete task.blockedReason; }
    }
    task.updatedAt = new Date().toISOString();
    this.save();
    await this.logActivity("FlareGit", r.failed ? "stack.rebase_blocked" : "stack.rebased", r.failed ? `${taskId}: ${r.failed}` : `${taskId} was rebased onto its updated parent (${r.commit?.slice(0, 7)})`);
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
  async registerWorkflow(instanceId: string, kind: "agent" | "integration" | "scenario", taskId?: string, actorId?: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(instanceId) || !["agent", "integration", "scenario"].includes(kind)) throw new Error("Invalid workflow registration");
    const state = this.load();
    if (taskId && (kind !== "agent" || !state.tasks[taskId])) throw new Error("Unknown agent change");
    const old = await this.getWorkflowRun(instanceId);
    if (old && old.kind !== kind) throw new Error("Workflow kind differs from its saved registration");
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO project_workflows (instance_id, kind, actor_id) VALUES (?, ?, ?)", instanceId, kind, actorId ?? null);
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
  async managedSpendReserved(month: string, accountKey?: string): Promise<number> {
    if (!/^\d{4}-\d{2}$/.test(month) || (accountKey !== undefined && !/^[A-Za-z0-9_-]{1,200}$/.test(accountKey))) throw new Error("Invalid spending scope");
    return new ManagedSpendLedger(this.ctx.storage).used(month, accountKey);
  }
  async reserveCoreGitOperation(operationId: string, accountKey: string, budget: CoreGitBudget): Promise<CoreGitAdmission> {
    return new CoreGitOperationLedger(this.ctx.storage).reserve(operationId, accountKey, budget);
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
  async claimLanding(req: { holder: string; taskIds: string[] }): Promise<ClaimResult> {
    await this.ensureRecoveryAlarm();
    const s = this.load();
    const now = Date.now();
    const lease = this.ctx.storage.sql.exec<{ holder: string; expires_at: number }>("SELECT holder, expires_at FROM lease WHERE id = 1").toArray()[0];
    if (lease && lease.expires_at > now && lease.holder !== req.holder) return { reason: "Another landing holds the lease" };
    if (req.taskIds.length < 1 || req.taskIds.length > 8 || new Set(req.taskIds).size !== req.taskIds.length) return { reason: "Integrate one to eight different changes" };

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
                    s.decisions[decision.id] = decision;
                    a.status = b.status = "needs_decision";
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
        candidate.workflowInstanceId = req.holder;
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

  async recordComposition(candidateId: string, attempts: RepairAttempt[]): Promise<void> {
    const candidate = this.load().candidates[candidateId];
    if (!candidate) throw new Error("Unknown candidate");
    candidate.repairAttempts = attempts;
    candidate.compositionMethod = attempts.length ? "repaired_merge" : "clean_git_merge";
    this.save();
  }

  async recordVerification(candidateId: string, commit: string, evidence: VerificationEvidence): Promise<void> {
    const s = this.load();
    const c = s.candidates[candidateId];
    if (!c) throw new Error("Unknown candidate");
    s.evidence[evidence.id] = evidence;
    c.candidateCommit = commit;
    c.evidenceId = evidence.id;
    c.status = evidence.status === "passed" && evidence.candidateCommit === commit ? "verified" : "verifying";
    this.save();
  }

  /** Ledger step 1: validate every invariant, then journal PREPARED. The workflow then pushes with a lease. */
  async preparePublish(candidateId: string): Promise<PrepareResult> {
    const recorded = this.load().candidates[candidateId]?.review;
    if (!recorded?.actor) return { ok: false, error: "The previous approval has no verified owner identity. Run a new candidate and review it before publishing." };
    let assertCurrent: () => void;
    try { assertCurrent = await this.authorizeHumanDecision(recorded.actor); assertCurrent(); }
    catch { return { ok: false, error: "The approving owner no longer has publication authority" }; }
    const s = this.load();
    const c = s.candidates[candidateId];
    const ev = c?.evidenceId ? s.evidence[c.evidenceId] : undefined;
    if (!c || !ev || !c.candidateCommit) return { ok: false, error: "No verified candidate" };
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
      this.ctx.storage.transactionSync(() => { assertCurrent(); s.journal.push(journal); this.save(); });
    } catch (cause) { this.state = null; throw cause; }
    return { ok: true, journal };
  }

  /** Fresh authorization for a new Git dispatch; confirmed ref updates reconcile independently. */
  async authorizeCandidatePublication(candidateId: string, commit: string): Promise<boolean> {
    const recorded = this.load().candidates[candidateId]?.review;
    if (!recorded?.approved || recorded.commit !== commit || !recorded.actor) return false;
    let assertCurrent: () => void;
    try { assertCurrent = await this.authorizeHumanDecision(recorded.actor); assertCurrent(); }
    catch { return false; }
    const state = this.load(), candidate = state.candidates[candidateId];
    const evidence = candidate?.evidenceId ? state.evidence[candidate.evidenceId] : undefined;
    const journal = state.journal.find(item => item.candidateId === candidateId && item.state === "PREPARED" && item.newHead === commit);
    const authority = journal?.publicationAuthority;
    return !!candidate && candidate.candidateCommit === commit && candidate.review?.approved === true && candidate.review.commit === commit && candidate.review.actor?.userId === recorded.actor.userId && !!authority && authority.actor.userId === recorded.actor.userId && authority.commit === commit && authority.tree === evidence?.candidateTree && authority.policyVersion === candidate.frozenPolicyVersion;
  }

  /** Ledger step 2: the Artifacts ref update succeeded (or was found already applied). */
  async completePublish(journalId: string): Promise<void> {
    // Arm recovery before loading state or committing the outbox; no async boundary
    // separates the ledger snapshot from its atomic update.
    await this.ensureRecoveryAlarm();
    const s = this.load();
    const j = s.journal.find((e) => e.id === journalId);
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
    if (!c || !c.candidateCommit || !c.workflowInstanceId) return { ok: false, error: "This candidate is not waiting for review" };
    if (!/^[a-f0-9]{40}$/.test(expectedCommit ?? "") || expectedCommit !== c.candidateCommit) return { ok: false, error: "The candidate changed from the commit you reviewed. Refresh and inspect its diff before deciding." };
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
    const s = this.load();
    const c = s.candidates[candidateId];
    if (!c) return;
    const j = journalId ? s.journal.find((e) => e.id === journalId) : undefined;
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

  async resolveDecision(decisionId: string, selectedOptionId: string, actor: HumanDecisionActor, credentialHash?: string): Promise<{ taskIds: string[] }> {
    const assertCurrent = await this.authorizeHumanDecision(actor, credentialHash, true);
    assertCurrent();
    const s = this.load();
    const d = s.decisions[decisionId];
    if (!d) throw new Error("Unknown decision");
    if (d.status === "resolved") {
      if (d.selectedOptionId !== selectedOptionId) throw new Error("This decision was already resolved with a different option");
      return { taskIds: [...(d.resolvedTaskIds ?? [])] };
    }
    if (d.status !== "pending") throw new Error("This decision is not awaiting a choice");
    const [idA, idB] = d.conflictingRequirementIds;
    if (selectedOptionId !== idA && selectedOptionId !== idB) throw new Error("Unknown option");
    const taskIds: string[] = [];
    try {
      this.ctx.storage.transactionSync(() => {
        assertCurrent();
        d.selectedOptionId = selectedOptionId;
        d.status = "resolved";
        d.resolvedAt = new Date().toISOString();
        d.resolvedBy = { ...actor };
        for (const t of Object.values(s.tasks)) {
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
        this.save();
      });
    } catch (cause) { this.state = null; throw cause; }
    return { taskIds };
  }
}
