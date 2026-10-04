import { acceptedTargetSchema, type UnbornAcceptedTarget } from "./accepted-target.js";
import { verifyNativeIntegrity } from "./verification/integrity.js";
import { settingsFor } from "./command-policy.js";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ArtifactsClient } from "../artifacts/types.js";
import { isolateTaskWorkspace } from "./pipeline/isolate.js";
import { recordCheckpoint } from "./pipeline/checkpoint.js";
import { detectCompatibility, type DetectionResult } from "./pipeline/detect.js";
import { freezeCandidateGeneration } from "./pipeline/freeze.js";
import { composeCandidateCommits } from "./pipeline/compose.js";
import { MAX_REPAIR_ROUNDS, repairCandidate, type RepairModel } from "./pipeline/repair.js";
import { publishAcceptedCandidate, reconcileJournalEntry } from "./pipeline/accept.js";
import { authArgs, changedFiles, git, gitOrThrow } from "./pipeline/git.js";
import { createProductDecision, detectContradiction } from "./decision/contradiction.js";
import type { ProtectedVerifier } from "./verifier.js";
import type {
  CandidateGeneration,
  FlareGitProjectState,
  ProductDecision,
  PublicationJournalEntry,
  Requirement,
  Task,
  VerificationEvidence,
} from "./types.js";

export type EventSubscriber = (event: { type: string; payload: unknown }) => void;

export interface ControllerDeps {
  artifacts: ArtifactsClient;
  verifier: ProtectedVerifier;
  repairModel: RepairModel;
  storageDir: string;
  /** Canonical branch contributors' work lands on. */
  defaultBranch?: string;
  unbornTarget?: UnbornAcceptedTarget;
}

export interface IntegrationOutcome {
  success: boolean;
  candidate?: CandidateGeneration;
  evidence?: VerificationEvidence;
  decision?: ProductDecision;
  error?: string;
}

/** Repairs are platform-authored, so they may touch any project source (never protected paths). */
const REPAIR_SCOPE = ["src/"];
const MAX_STALE_RETRIES = 2;
const MAX_REPAIR_CONTEXT_BYTES = 120_000;

export class FlareGitRepositoryController {
  private state: FlareGitProjectState;
  private readonly deps: ControllerDeps;
  private readonly defaultBranch: string;
  private readonly subscribers = new Set<EventSubscriber>();
  /** Serializes landings: one candidate at a time may compose, verify and publish. */
  private landingQueue: Promise<unknown> = Promise.resolve();
  private readonly seenCheckpoints = new Set<string>();

  constructor(deps: ControllerDeps, initialState: FlareGitProjectState) {
    this.deps = deps;
    this.defaultBranch = deps.defaultBranch ?? "main";
    this.state = initialState;
    if(initialState.acceptedState.kind==="unborn"){
      const target=acceptedTargetSchema.parse(deps.unbornTarget);
      if(target.kind!=="unborn"||target.projectId!==initialState.projectId||target.canonicalRepoName!==initialState.canonicalRepoName||target.branch!==this.defaultBranch)throw new Error("Recorded unborn target must match this controller");
    }
    if (!this.state.verificationPolicy) this.state.verificationPolicy = { ...deps.verifier.defaultPolicy };
    fs.mkdirSync(deps.storageDir, { recursive: true });
    this.persist();
  }

  /** Reload persisted state after a crash and settle anything that was in flight. */
  static async restore(deps: ControllerDeps, projectId: string): Promise<FlareGitRepositoryController | null> {
    const file = path.join(deps.storageDir, `${projectId}.state.json`);
    if (!fs.existsSync(file)) return null;
    const state = JSON.parse(fs.readFileSync(file, "utf-8")) as FlareGitProjectState;
    const controller = new FlareGitRepositoryController(deps, state);
    await controller.recoverInterruptedWork();
    return controller;
  }

  getState(): FlareGitProjectState {
    return JSON.parse(JSON.stringify(this.state));
  }

  subscribe(subscriber: EventSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  private emit(type: string, payload: unknown): void {
    for (const sub of this.subscribers) {
      try {
        sub({ type, payload });
      } catch (err) {
        console.error("Subscriber error:", err);
      }
    }
  }

  private persist(): void {
    const file = path.join(this.deps.storageDir, `${this.state.projectId}.state.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, file);
  }

  private setStatus(tasks: Task[], status: Task["status"], reason?: string): void {
    for (const t of tasks) {
      t.status = status;
      t.blockedReason = status === "blocked" ? reason : undefined;
      t.updatedAt = new Date().toISOString();
    }
    this.persist();
    this.emit("task.status_changed", { taskIds: tasks.map((t) => t.id), status, reason });
  }

  private async canonicalDir(): Promise<string> {
    return (await (await this.deps.artifacts.get(this.state.canonicalRepoName)).info()).remote;
  }

  /** Short-lived write token, only for https (Artifacts) remotes. */
  private async canonicalToken(remote: string): Promise<string | undefined> {
    if (!/^https:\/\//.test(remote)) return undefined;
    return (await (await this.deps.artifacts.get(this.state.canonicalRepoName)).createToken("write", 900)).plaintext;
  }

  /** Crash recovery: settle unfinished publications against the real ref; re-queue stuck tasks. */
  async recoverInterruptedWork(): Promise<void> {
    const canonical = await this.canonicalDir();
    const ref = `refs/heads/${this.defaultBranch}`;
    const remote = /^https:\/\//.test(canonical);
    const token = remote ? await this.canonicalToken(canonical) : undefined;
    const head = remote
      ? gitOrThrow(this.deps.storageDir, [...authArgs(canonical, token), "ls-remote", canonical, ref]).split("\t")[0]?.trim() ?? ""
      : git(canonical, ["rev-parse", "--verify", ref], { gitDir: true }).stdout.trim();
    if (!head&&this.state.acceptedState.kind==="unborn"&&!this.state.journal.some(entry=>entry.state==="PREPARED"||entry.state==="REF_UPDATED")){this.persist();return;}
    if (!head) throw new Error("Could not read canonical head; interrupted publication remains pending.");
    const unfinished = this.state.journal.some((e) => e.state === "PREPARED" || e.state === "REF_UPDATED");
    const recoveryRepo = remote && unfinished ? fs.mkdtempSync(path.join(this.deps.storageDir, "recovery-")) : canonical;
    try {
      if (remote && unfinished) {
        gitOrThrow(recoveryRepo, ["init", "--bare", "--quiet"]);
        gitOrThrow(recoveryRepo, [...authArgs(canonical, token), "fetch", "--quiet", canonical, ref], { gitDir: true });
      }
      this.state.journal = this.state.journal.map((e): PublicationJournalEntry =>
        e.state === "PREPARED" || e.state === "REF_UPDATED"
          ? reconcileJournalEntry(head, e, git(recoveryRepo, ["merge-base", "--is-ancestor", e.newHead, head], { gitDir: true }).ok)
          : e
      );
    } finally {
      if (remote && unfinished) fs.rmSync(recoveryRepo, { recursive: true, force: true });
    }
    const settled = this.state.journal.find((e) => e.state === "ACCEPTED" && e.newHead === head);
    if (head && head !== this.state.acceptedState.currentCommit && settled) {
      const candidate = this.state.candidates[settled.candidateId];
      if(this.state.acceptedState.kind==="unborn"){
        const evidence=candidate?.evidenceId?this.state.evidence[candidate.evidenceId]:undefined;
        if(!candidate||!evidence||evidence.status!=="passed"||evidence.candidateCommit!==head)throw new Error("First-root accepted journal evidence is unavailable");
        this.state.acceptedState={kind:"committed",currentCommit:head,acceptedAt:settled.timestamp,buildDigest:settled.outputDigest,activeRequirements:candidate.frozenRequirements,history:[{acceptedTarget:candidate.acceptedTarget,commit:head,candidateId:candidate.id,acceptedAt:settled.timestamp,participatingTasks:candidate.participatingTaskIds,evidenceId:evidence.id,outputDigest:settled.outputDigest}]};
      }else{this.state.acceptedState.currentCommit=head;this.state.acceptedState.buildDigest=settled.outputDigest;}
      if (candidate) {
        candidate.status = "accepted";
        for (const id of candidate.participatingTaskIds) {
          const task = this.state.tasks[id];
          if (task) task.status = task.currentCommit === candidate.participatingCommits[id] ? "accepted" : "ready";
        }
      }
    }
    for (const task of Object.values(this.state.tasks)) {
      if (task.status === "integrating" || task.status === "verifying") task.status = "ready";
    }
    for (const candidate of Object.values(this.state.candidates)) {
      if (["composing", "repairing", "verifying"].includes(candidate.status)) candidate.status = "failed";
    }
    this.persist();
  }

  async createTask(opts: {
    taskId: string;
    goal: string;
    contributorName: string;
    contributorType: "human" | "agent";
    requirements?: Requirement[];
    allowedScope?: string[];
  }): Promise<Task> {
    if (this.state.tasks[opts.taskId]) throw new Error(`Task ${opts.taskId} already exists`);
    const isolated = await isolateTaskWorkspace(this.deps.artifacts, {
      projectId: this.state.projectId,
      taskId: opts.taskId,
      goal: opts.goal,
      contributorName: opts.contributorName,
      contributorType: opts.contributorType,
      canonicalRepoName: this.state.canonicalRepoName,
      baseCommit: this.state.acceptedState.currentCommit,
      ...(this.state.acceptedState.kind==="unborn"?{unbornTarget:this.deps.unbornTarget}:{}),
      allowedScope: opts.allowedScope??(settingsFor(this.state.verificationPolicy).fixture==="git-integrity"?settingsFor(this.state.verificationPolicy).allowedScope:undefined),
      workspacesDir: path.join(this.deps.storageDir, "workspaces", opts.taskId),
    });
    const task:Task=this.state.acceptedState.kind==="unborn"&&this.deps.unbornTarget?{...isolated,acceptedTarget:structuredClone(this.deps.unbornTarget)}:isolated;
    if (opts.requirements) task.requirements = opts.requirements;
    this.state.tasks[task.id] = task;
    this.persist();
    this.emit("task.created", task);
    return task;
  }

  /** Idempotent: re-delivering the same checkpoint (same commit, same readiness) is a no-op. */
  recordTaskCheckpoint(opts: { taskId: string; message?: string; isReadyForIntegration: boolean }): Task {
    const task = this.state.tasks[opts.taskId];
    if (!task) throw new Error(`Task ${opts.taskId} not found`);
    if (task.status === "cancelled") throw new Error(`Task ${opts.taskId} was cancelled`);
    if (task.status === "integrating" || task.status === "verifying") {
      throw new Error(`Task ${opts.taskId} is being integrated; checkpoint again once the candidate settles`);
    }

    const { task: updated, checkpoint } = recordCheckpoint({
      task,
      message: opts.message,
      isReadyForIntegration: opts.isReadyForIntegration,
    });
    const key = `${task.id}:${checkpoint.commitHash}:${opts.isReadyForIntegration}`;
    if (this.seenCheckpoints.has(key)) return task;
    this.seenCheckpoints.add(key);

    this.state.tasks[task.id] = updated;
    this.persist();
    this.emit("task.checkpointed", { task: updated, checkpoint });
    return updated;
  }

  cancelTask(taskId: string): Task {
    const task = this.state.tasks[taskId];
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status === "accepted") throw new Error(`Task ${taskId} is already accepted`);
    this.setStatus([task], "cancelled");
    return task;
  }

  async analyzeCompatibility(taskAId: string, taskBId: string): Promise<DetectionResult> {
    const taskA = this.state.tasks[taskAId];
    const taskB = this.state.tasks[taskBId];
    if (!taskA || !taskB) throw new Error("Tasks not found");
    if(this.state.acceptedState.currentCommit===null)throw new Error("Initial-root compatibility is reviewed through an explicit first-root candidate");
    const workspace = await this.prepareIntegrationWorkspace(`analysis-${Date.now()}`, [taskA, taskB]);
    try {
      const result = await detectCompatibility({
        repoDir: workspace,
        acceptedBase: this.state.acceptedState.currentCommit,
        taskA,
        taskB,
        verifier: this.deps.verifier,
        policy: this.state.verificationPolicy,
        requirementsVersion: this.state.policyVersion,
      });
      this.emit("compatibility.analyzed", { taskAId, taskBId, result });
      return result;
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }

  /** A clone of canonical used only by the integrator; contributor workspaces are never touched. */
  private async prepareIntegrationWorkspace(id: string, tasks: Task[]): Promise<string> {
    const canonical = await this.canonicalDir();
    const dir = path.join(this.deps.storageDir, "integration", id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    gitOrThrow(path.dirname(dir), [...authArgs(canonical, await this.canonicalToken(canonical)), "clone", "--quiet", "--no-hardlinks", canonical, dir]);
    for (const task of tasks) {
      if(!task.currentCommit)throw new Error("Contribution has no committed checkpoint");
      gitOrThrow(dir, [...authArgs(task.workspace.remote, task.workspace.token), "fetch", "--quiet", task.workspace.remote, `+refs/heads/${task.workspace.branch}:refs/flaregit/tasks/${task.id}`]);
      const fetched = gitOrThrow(dir, ["rev-parse", `refs/flaregit/tasks/${task.id}`]);
      if (fetched !== task.currentCommit) {
        throw new Error(`Task ${task.id} remote is at ${fetched.slice(0, 7)} but checkpoint recorded ${task.currentCommit.slice(0, 7)}`);
      }
    }
    return dir;
  }

  private policyViolations(repoDir: string, task: Task): string[] {
    if(!task.currentCommit)throw new Error("Contribution has no committed checkpoint");
    const files = changedFiles(repoDir, this.state.acceptedState.currentCommit, task.currentCommit);
    const scoped = (f: string) =>
      task.allowedScope.some((s) => s==="*"||(s.endsWith("/**/*") ? f.startsWith(s.slice(0, -4)) : s.endsWith("/") ? f.startsWith(s) : f === s));
    const protectedHit = (f: string) => this.deps.verifier.protectedPaths.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p));
    return files.flatMap((f) =>
      protectedHit(f) ? [`${f} is protected verification/configuration`] : scoped(f) ? [] : [`${f} is outside the allowed scope`]
    );
  }

  /** Preparation never publishes the missing accepted branch. All original
   * checkpoints are retained as parents when an initial batch composes cleanly. */
  async prepareFirstRootCandidate(ids:string|string[]):Promise<IntegrationOutcome>{
    const taskIds=typeof ids==="string"?[ids]:ids,target=this.deps.unbornTarget;
    if(this.state.acceptedState.currentCommit!==null||!target)return{success:false,error:"Initial target is stale; preserve the contribution and explicitly rebase it"};
    if(!taskIds.length||taskIds.length>8||new Set(taskIds).size!==taskIds.length)throw Error("One to eight distinct initial contributions required");
    const tasks=taskIds.map(id=>{const task=this.state.tasks[id];if(!task||!task.currentCommit||task.baseCommit!==null||task.status==="cancelled")throw Error("Initial contribution checkpoints are unavailable");return task;});
    for(let a=0;a<tasks.length;a++)for(let b=a+1;b<tasks.length;b++)for(const left of tasks[a]!.requirements.filter(requirement=>requirement.status==="approved"))for(const right of tasks[b]!.requirements.filter(requirement=>requirement.status==="approved")){if(detectContradiction(left,right)){const decision=createProductDecision(left,right);this.state.decisions[decision.id]=decision;this.setStatus(tasks,"needs_decision");return{success:false,decision,error:"Initial requirements conflict; a human decision is required before composition"};}}
    const candidate=freezeCandidateGeneration({tasks,acceptedTarget:target,acceptedBaseCommit:null,policyVersion:this.state.policyVersion,verificationPolicy:this.state.verificationPolicy,approvedRequirements:tasks.flatMap(task=>task.requirements).filter(requirement=>requirement.status==="approved")});
    this.state.candidates[candidate.id]=candidate;this.persist();this.emit("candidate.frozen",candidate);
    const workspace=await this.prepareIntegrationWorkspace(candidate.id,tasks);
    try{
      const violations=tasks.flatMap(task=>this.policyViolations(workspace,task));if(violations.length)throw Error(violations.join("; "));
      const first=candidate.participatingCommits[taskIds[0]!];if(!first)throw Error("First committed checkpoint unavailable");
      const branch=`candidate/${candidate.id}`;gitOrThrow(workspace,["checkout","--quiet","-B",branch,first]);
      for(const id of taskIds.slice(1)){const commit=candidate.participatingCommits[id];if(!commit)throw Error("Frozen checkpoint unavailable");const merged=git(workspace,["-c","user.name=FlareGit Integrator","-c","user.email=integrator@flaregit.com","merge","--allow-unrelated-histories","--no-ff","--no-edit",commit]);if(!merged.ok){candidate.status="failed";const files=git(workspace,["diff","--name-only","--diff-filter=U"]).stdout.trim().split("\n").filter(Boolean);candidate.repairAttempts.push({round:0,prompt:"Human resolution required",patch:"",affectedContracts:[],diagnosticError:`Initial Git conflict: ${files.join(", ")}`,durationMs:0,timestamp:new Date().toISOString()});this.persist();return{success:false,candidate,error:`Initial contributions conflict in ${files.join(", ")}; original checkpoints remain preserved for an explicit resolution`};}}
      const commit=gitOrThrow(workspace,["rev-parse","HEAD"]),tree=gitOrThrow(workspace,["rev-parse","HEAD^{tree}"]),settings=settingsFor(this.state.verificationPolicy);
      const evidence=await verifyNativeIntegrity({repoDir:workspace,candidateCommit:commit,candidateTree:tree,expectedBase:null,acceptedTarget:target,requirementsVersion:this.state.policyVersion,policy:this.state.verificationPolicy,protectedPaths:settings.protectedPaths,allowedScope:settings.allowedScope,landing:"merge",contributors:tasks.map(task=>({id:task.id,commit:candidate.participatingCommits[task.id]!,baseCommit:null,ref:`refs/flaregit/tasks/${task.id}`,allowedScope:task.allowedScope}))});
      candidate.candidateCommit=commit;candidate.evidenceId=evidence.id;candidate.status=evidence.status==="passed"?"verified":"failed";this.state.evidence[evidence.id]=evidence;this.persist();this.emit(evidence.status==="passed"?"candidate.verified":"candidate.failed",{candidate,evidence});return{success:false,candidate,evidence,error:evidence.status==="passed"?"Exact initial candidate is ready for human review; no accepted branch was created":"Initial Git integrity verification failed"};
    }catch(error){candidate.status="failed";this.persist();return{success:false,candidate,error:error instanceof Error?error.message:"Initial preparation failed"};}
  }
  /** Explicit local human review binds the exact prepared commit and tree. */
  acceptFirstRootCandidate(id:string,review:{commit:string;tree:string;actorId:string}):Promise<IntegrationOutcome>{
    const run=this.landingQueue.then(async()=>{
      const candidate=this.state.candidates[id],evidence=candidate?.evidenceId?this.state.evidence[candidate.evidenceId]:undefined,target=this.deps.unbornTarget;
      if(!candidate||!evidence||!target)return{success:false,candidate,evidence,error:"Initial candidate is unavailable"};
      if(this.state.acceptedState.currentCommit!==null){candidate.status="stale";this.persist();return{success:false,candidate,evidence,error:"Initial target changed; original contributions remain preserved"};}
      if(!review.actorId||candidate.candidateCommit!==review.commit||evidence.candidateTree!==review.tree)return{success:false,candidate,evidence,error:"Review must approve the exact prepared commit and tree"};
      if(candidate.status!=="verified"||candidate.frozenPolicyVersion!==this.state.policyVersion||JSON.stringify(candidate.frozenVerificationPolicy)!==JSON.stringify(this.state.verificationPolicy)||candidate.participatingTaskIds.some(taskId=>!this.state.tasks[taskId]||this.state.tasks[taskId]!.status==="cancelled"))return{success:false,candidate,evidence,error:"Initial review context changed; prepare a fresh candidate"};
      const workspace=path.join(this.deps.storageDir,"integration",id),canonical=await this.canonicalDir();
      const published=publishAcceptedCandidate({canonicalRepoDir:canonical,canonicalToken:await this.canonicalToken(canonical),defaultBranch:this.defaultBranch,candidate,evidence,candidateRepoDir:workspace,candidateRef:`refs/heads/candidate/${id}`,unbornTarget:target,rootReview:{...review,candidateId:id},onJournal:entry=>this.upsertJournal(entry)});
      if(!published.success||!published.acceptanceRecord){candidate.status=published.staleBase?"stale":"failed";this.persist();return{success:false,candidate,evidence,error:published.error};}
      const record=published.acceptanceRecord;this.state.acceptedState={kind:"committed",currentCommit:record.commit,acceptedAt:record.acceptedAt,buildDigest:record.outputDigest,activeRequirements:candidate.frozenRequirements,history:[record]};candidate.status="accepted";for(const taskId of candidate.participatingTaskIds){const task=this.state.tasks[taskId];if(task&&task.currentCommit===candidate.participatingCommits[taskId])task.status="accepted";}this.persist();this.emit("candidate.accepted",{candidate,record,acceptedState:this.state.acceptedState});return{success:true,candidate,evidence};
    });this.landingQueue=run.catch(()=>undefined);return run;
  }

  /** Public entry point: queued so concurrent landing attempts are strictly serialized. */
  runIntegrationPipeline(taskIds: [string, string]): Promise<IntegrationOutcome> {
    const run = this.landingQueue.then(() => this.integrate(taskIds));
    this.landingQueue = run.catch(() => undefined);
    return run;
  }

  private async integrate(taskIds: [string, string]): Promise<IntegrationOutcome> {
    for (let attempt = 1; ; attempt++) {
      const outcome = await this.integrateOnce(taskIds, attempt);
      if (!outcome.candidate || outcome.candidate.status !== "stale" || attempt > MAX_STALE_RETRIES) return outcome;
    }
  }

  private async integrateOnce(taskIds: [string, string], attemptNumber: number): Promise<IntegrationOutcome> {
    const tasks = taskIds.map((id) => this.state.tasks[id]);
    if (tasks.some((t) => !t)) throw new Error("Tasks not found for integration");
    const [taskA, taskB] = tasks as [Task, Task];
    if(this.state.acceptedState.currentCommit===null)return{success:false,error:"Prepare initial contributions for exact human review before the first accepted commit"};
    if(!taskA.currentCommit||!taskB.currentCommit)return{success:false,error:"Every contribution needs a real committed checkpoint"};

    for (const t of [taskA, taskB]) {
      if (t.status === "accepted") return { success: false, error: `Task ${t.id} is already accepted (duplicate request ignored).` };
      if (t.status === "cancelled") return { success: false, error: `Task ${t.id} was cancelled.` };
      if (t.status === "needs_decision") return { success: false, error: `Task ${t.id} awaits a product decision.` };
      if (t.status === "working" || t.status === "checkpointed") {
        return { success: false, error: `Task ${t.id} has not been marked ready for integration.` };
      }
    }

    // Contradictory approved requirements pause everything; the accepted version is untouched.
    for (const reqA of taskA.requirements.filter((r) => r.status === "approved")) {
      for (const reqB of taskB.requirements.filter((r) => r.status === "approved")) {
        if (!detectContradiction(reqA, reqB)) continue;
        const decision = createProductDecision(reqA, reqB);
        this.state.decisions[decision.id] = decision;
        this.setStatus([taskA, taskB], "needs_decision");
        this.emit("decision.needed", decision);
        return { success: false, decision, error: "Contradictory requirements. Paused for a product decision." };
      }
    }

    this.setStatus([taskA, taskB], "integrating");
    const acceptedBase = this.state.acceptedState.currentCommit;
    const candidate = freezeCandidateGeneration({
      tasks: [taskA, taskB],
      acceptedBaseCommit: acceptedBase,
      policyVersion: this.state.policyVersion,
      verificationPolicy: this.state.verificationPolicy,
      approvedRequirements: [...this.state.acceptedState.activeRequirements, ...taskA.requirements, ...taskB.requirements].filter(
        (r) => r.status === "approved"
      ),
      attemptNumber,
    });
    this.state.candidates[candidate.id] = candidate;
    taskA.activeCandidateId = taskB.activeCandidateId = candidate.id;
    this.persist();
    this.emit("candidate.frozen", candidate);

    const fail = (message: string, evidence?: VerificationEvidence): IntegrationOutcome => {
      candidate.status = "failed";
      candidate.failureBlocker = message;
      candidate.updatedAt = new Date().toISOString();
      this.setStatus([taskA, taskB], "blocked", message);
      this.emit("candidate.failed", candidate);
      return { success: false, candidate, evidence, error: message };
    };

    let workspace: string;
    try {
      workspace = await this.prepareIntegrationWorkspace(candidate.id, [taskA, taskB]);
    } catch (err) {
      return fail(`Could not prepare integration workspace: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const violations = [...this.policyViolations(workspace, taskA), ...this.policyViolations(workspace, taskB)];
      if (violations.length > 0) return fail(`Contributor change rejected: ${violations.join("; ")}`);

      // Compose with native Git on top of the exact accepted head.
      const composed = composeCandidateCommits({
        repoDir: workspace,
        candidateId: candidate.id,
        acceptedBase,
        commitA: taskA.currentCommit,
        commitB: taskB.currentCommit,
        labelA: taskA.id,
        labelB: taskB.id,
      });
      candidate.compositionMethod = composed.compositionMethod;
      candidate.candidateCommit = composed.candidateCommit ?? undefined;

      let round = 0;
      const repair = async (
        conflictType: "text_conflict" | "behavior_failure",
        evidence?: VerificationEvidence
      ): Promise<string | null> => {
        round += 1;
        candidate.status = "repairing";
        this.persist();
        this.emit("candidate.repairing", { candidateId: candidate.id, round, conflictType });
        const editableFiles =
          conflictType === "text_conflict" ? composed.conflictingFiles : this.editableSourceFiles(workspace, REPAIR_SCOPE);
        const fileContents = this.readFiles(workspace, editableFiles);
        const result = await repairCandidate({
          repoDir: workspace,
          candidate,
          tasks: [taskA, taskB],
          round,
          conflictType,
          editableFiles,
          fileContents: conflictType === "text_conflict" ? { ...composed.conflictContents } : fileContents,
          contextFiles: this.readFiles(
            workspace,
            this.editableSourceFiles(workspace, REPAIR_SCOPE).filter((f) => !editableFiles.includes(f))
          ),
          sideVersions:
            conflictType === "text_conflict"
              ? Object.fromEntries(
                  editableFiles.map((f) => [
                    f,
                    {
                      base: git(workspace, ["show", `:1:${f}`]).stdout,
                      a: git(workspace, ["show", `${taskA.currentCommit}:${f}`]).stdout,
                      b: git(workspace, ["show", `${taskB.currentCommit}:${f}`]).stdout,
                    },
                  ])
                )
              : undefined,
          failureEvidence: evidence,
          protectedPaths: this.deps.verifier.protectedPaths,
          model: this.deps.repairModel,
        });
        candidate.repairAttempts.push(result.attempt);
        if (!result.success || !result.candidateCommit) return null;
        candidate.candidateCommit = result.candidateCommit;
        candidate.compositionMethod = "repaired_merge";
        return result.candidateCommit;
      };

      if (!composed.isClean) {
        if (!(await repair("text_conflict"))) {
          return fail(candidate.repairAttempts.at(-1)?.diagnosticError || "Conflict repair failed.");
        }
      }

      let evidence: VerificationEvidence;
      for (;;) {
        candidate.status = "verifying";
        this.setStatus([taskA, taskB], "verifying");
        this.emit("candidate.verifying", candidate);
        const commit = candidate.candidateCommit!;

        const tampered = changedFiles(workspace, acceptedBase, commit).filter((f) =>
          this.deps.verifier.protectedPaths.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p))
        );
        if (tampered.length > 0) return fail(`Candidate modifies protected paths: ${tampered.join(", ")}`);

        evidence = await this.deps.verifier.verify({
          repoDir: workspace,
          candidateCommit: commit,
          expectedBase: acceptedBase,
          requirementsVersion: candidate.frozenPolicyVersion,
          policy: candidate.frozenVerificationPolicy,
        });
        this.state.evidence[evidence.id] = evidence;
        this.persist();
        if (evidence.status === "passed") break;

        if (round >= MAX_REPAIR_ROUNDS) {
          return fail("Protected verification still fails after the maximum repair rounds; accepted version preserved.", evidence);
        }
        if (!(await repair("behavior_failure", evidence))) {
          return fail(candidate.repairAttempts.at(-1)?.diagnosticError || "Behavioral repair failed.", evidence);
        }
      }

      candidate.status = "verified";
      candidate.evidenceId = evidence.id;
      this.emit("candidate.verified", { candidate, evidence });

      if (taskA.status === ("cancelled" as Task["status"]) || taskB.status === ("cancelled" as Task["status"])) {
        return fail("A participating task was cancelled before publication.", evidence);
      }

      const canonicalRemote = await this.canonicalDir();
      const published = publishAcceptedCandidate({
        canonicalRepoDir: canonicalRemote,
        canonicalToken: await this.canonicalToken(canonicalRemote),
        defaultBranch: this.defaultBranch,
        candidate,
        evidence,
        candidateRepoDir: workspace,
        candidateRef: `refs/heads/candidate/${candidate.id}`,
        onJournal: (entry) => this.upsertJournal(entry),
      });

      if (!published.success || !published.acceptanceRecord) {
        if (published.staleBase) {
          candidate.status = "stale";
          this.setStatus([taskA, taskB], "ready");
          this.emit("candidate.stale", candidate);
          return { success: false, candidate, evidence, error: published.error };
        }
        return fail(published.error ?? "Publication refused.", evidence);
      }

      const record = published.acceptanceRecord;
      candidate.status = "accepted";
      for (const t of [taskA, taskB]) {
        // A checkpoint that arrived after the freeze is newer work, not part of this landing.
        t.status = t.currentCommit === candidate.participatingCommits[t.id] ? "accepted" : "ready";
        t.updatedAt = new Date().toISOString();
      }
      this.state.acceptedState = {kind:"committed",currentCommit:record.commit,buildDigest:record.outputDigest,acceptedAt:record.acceptedAt,history:[...this.state.acceptedState.history,record],activeRequirements:[...this.state.acceptedState.activeRequirements]};
      for (const req of [...taskA.requirements, ...taskB.requirements]) {
        if (req.status === "approved" && !this.state.acceptedState.activeRequirements.some((r) => r.id === req.id)) {
          this.state.acceptedState.activeRequirements.push(req);
        }
      }
      this.persist();
      this.emit("candidate.accepted", { candidate, record, acceptedState: this.state.acceptedState });
      return { success: true, candidate, evidence };
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }

  private upsertJournal(entry: PublicationJournalEntry): void {
    const i = this.state.journal.findIndex((e) => e.id === entry.id);
    if (i >= 0) this.state.journal[i] = entry;
    else this.state.journal.push(entry);
    this.persist();
  }

  private editableSourceFiles(repoDir: string, allowedScope: string[]): string[] {
    const tracked = gitOrThrow(repoDir, ["ls-files"]).split("\n").filter(Boolean);
    return tracked.filter(
      (f) =>
        allowedScope.some((s) => f.startsWith(s.replace(/\*\*\/\*$/, ""))) &&
        !this.deps.verifier.protectedPaths.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p)) &&
        /\.(ts|tsx|css|json|html)$/.test(f)
    );
  }

  private readFiles(repoDir: string, files: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    let total = 0;
    for (const f of files) {
      const content = fs.readFileSync(path.join(repoDir, f), "utf-8");
      total += Buffer.byteLength(content);
      if (total > MAX_REPAIR_CONTEXT_BYTES) break;
      out[f] = content;
    }
    return out;
  }

  /**
   * Apply the human's choice: the chosen requirement wins, the other is superseded, its policy
   * patch is applied, and FlareGit re-runs integration (implementation + verification) itself.
   */
  async resolveProductDecision(decisionId: string, selectedOptionId: string): Promise<{ decision: ProductDecision; integration?: IntegrationOutcome }> {
    const decision = this.state.decisions[decisionId];
    if (!decision) throw new Error(`Decision ${decisionId} not found`);
    if (decision.status === "resolved") return { decision }; // idempotent
    const [idA, idB] = decision.conflictingRequirementIds;
    if (selectedOptionId !== idA && selectedOptionId !== idB) throw new Error(`Unknown option ${selectedOptionId}`);
    const loserId = selectedOptionId === idA ? idB : idA;

    decision.selectedOptionId = selectedOptionId;
    decision.status = "resolved";
    decision.resolvedAt = new Date().toISOString();

    const waiting: Task[] = [];
    let winner: Requirement | undefined;
    for (const task of Object.values(this.state.tasks)) {
      for (const req of task.requirements) {
        if (req.id === loserId) req.status = "superseded";
        if (req.id === selectedOptionId) winner = req;
      }
      if (task.status === "needs_decision") waiting.push(task);
    }
    if (winner?.policyPatch) {
      this.state.verificationPolicy = { ...this.state.verificationPolicy, ...winner.policyPatch };
      this.state.policyVersion += 1;
    }
    this.setStatus(waiting, "ready");
    this.emit("decision.resolved", { decision, verificationPolicy: this.state.verificationPolicy });

    if (waiting.length !== 2) return { decision };
    const integration = await this.runIntegrationPipeline([waiting[0]!.id, waiting[1]!.id]);
    return { decision, integration };
  }

  /** Retry blocked work (e.g. after a transient model outage). */
  retryBlocked(taskIds: [string, string]): Promise<IntegrationOutcome> {
    for (const id of taskIds) {
      const t = this.state.tasks[id];
      if (t?.status === "blocked") this.setStatus([t], "ready");
    }
    return this.runIntegrationPipeline(taskIds);
  }
}
