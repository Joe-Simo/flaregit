import { admitNativeCompute } from "./native-compute.js";
import { isSafeRef } from "../core/sanitize.js";
import { buildPrefix } from "./preview-access.js";
import { publicationInHistory } from "./publication.js";
import { pushMirror } from "./mirror.js";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { WorkersAIClient, DEFAULT_CODE_MODEL } from "../ai/workers-ai.js";
import { buildRepairPrompt, parseRepairResponse, MAX_REPAIR_ROUNDS } from "../core/pipeline/repair.js";
import type { CandidateGeneration, VerificationEvidence } from "../core/types.js";
import type { Env } from "./env.js";
import type { ClaimResult, Ledger, PrepareResult } from "./durable-object.js";
import { gitAuthEnv, q } from "./shell.js";
import { ledgerOf } from "./scenario-workflow.js";
import { settingsFor } from "../core/command-policy.js";
import { inAgentScope, isProtectedPath, redactSecrets } from "../agents/prompt.js";
import { globalOf, reserveManagedAgent, assertManagedInitiator } from "./projects.js";
import type { WorkflowOutcome } from "./durable-object.js";

export interface IntegrationParams {
  projectId: string;
  accountKey?: string;
  /** One to eight changes, merged in this order. */
  taskIds: string[];
}

const WORK = "/workspace/integration";

type Stub = Ledger;

export class FlareGitIntegrationWorkflow extends WorkflowEntrypoint<Env, IntegrationParams> {
  override async run(event: WorkflowEvent<IntegrationParams>, step: WorkflowStep) {
    const record = async (status: WorkflowOutcome) => {
      try { await step.do(`outcome-${status}`, async () => globalOf(this.env).recordWorkflowOutcome("integration", event.instanceId, status)); }
      catch { console.error("Workflow outcome recording unavailable"); }
    };
    await record("started");
    try {
      const result = await this.execute(event, step);
      await record(result.status);
      return result;
    } catch (error) {
      await record("failed");
      throw error;
    }
  }
  private async execute(event: WorkflowEvent<IntegrationParams>, step: WorkflowStep) {
    const stub = ledgerOf(this.env, event.payload.projectId) as Stub;
    this.projectId = event.payload.projectId;
    this.computeAccountKey = event.payload.accountKey;
    this.computeWorkflowId = event.instanceId;
    const holder = event.instanceId;

    // Merge queue: landings are serialized by the ledger lease. A busy lease means "wait your turn" (durably, via
    // Workflow sleeps), never a silently dropped request. Other refusals are final and reported.
    let claim: ClaimResult = { reason: "not attempted" };
    for (let turn = 0; turn < 72; turn++) {
      claim = (await step.do(`claim-landing-${turn}`, async () => (await stub.claimLanding({ holder, taskIds: event.payload.taskIds })) as never)) as ClaimResult;
      if (claim.candidate || claim.decision || claim.reason !== "Another landing holds the lease") break;
      await step.sleep(`queued-${turn}`, "30 seconds");
    }
    if (!claim.candidate) {
      if (!claim.decision) await step.do("report-not-started", async () => stub.logActivity("FlareGit", "integration.not_started", `Integration of ${event.payload.taskIds.join(" + ")} did not start: ${claim.reason}`));
      return { status: claim.decision ? "needs_decision" as const : "not_started" as const, reason: claim.reason, decision: claim.decision };
    }
    const candidate = claim.candidate;

    const integrated = await step.do(
      "compose-repair-verify",
      { retries: { limit: 1, delay: "10 seconds", backoff: "constant" }, timeout: "20 minutes" },
      async () => this.composeRepairVerify(candidate, event.payload, stub, event.instanceId)
    );

    if (!integrated.ok) {
      await step.do("abort", async () => stub.abortPublish(candidate.id, undefined, integrated.error, "failed"));
      return { status: "blocked" as const, error: integrated.error };
    }

    // Human control over history: the verified candidate waits until a person accepts this exact commit.
    await step.do("await-review", async () => stub.awaitReview(candidate.id, integrated.commit, event.instanceId));
    let review: { approved: boolean; by: string; note?: string };
    try {
      review = (await step.waitForEvent<{ approved: boolean; by: string; note?: string }>("human-review", { type: "review", timeout: "7 days" })).payload;
    } catch {
      await step.do("abort-unreviewed", async () => stub.abortPublish(candidate.id, undefined, "Nobody reviewed the candidate within 7 days; run the integration again", "stale"));
      return { status: "stale" as const, error: "review timed out" };
    }
    if (!review.approved) {
      await step.do("abort-rejected", async () => stub.abortPublish(candidate.id, undefined, `Rejected in review by ${review.by}${review.note ? `: ${review.note}` : ""}`, "failed"));
      return { status: "rejected" as const, by: review.by };
    }

    const prepared = (await step.do("prepare-publish", async () => (await stub.preparePublish(candidate.id)) as never)) as PrepareResult;
    if (!prepared.ok || !prepared.journal) {
      await step.do("abort-prepare", async () => stub.abortPublish(candidate.id, undefined, prepared.error ?? "refused", prepared.stale ? "stale" : "failed"));
      return { status: prepared.stale ? "stale" as const : "blocked" as const, error: prepared.error };
    }

    const pushed = await step.do("cas-push-to-artifacts", { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" } }, async () => this.casPush(candidate, integrated.commit, stub, integrated.branch));
    if (!pushed.ok) {
      await step.do("abort-push", async () => stub.abortPublish(candidate.id, prepared.journal!.id, pushed.error, pushed.stale ? "stale" : "failed"));
      return { status: pushed.stale ? "stale" as const : "blocked" as const, error: pushed.error };
    }
    await step.do("complete-publish", async () => stub.completePublish(prepared.journal!.id));
    // Stacked changes: re-base every dependent change onto what just landed, so the stack keeps tracking upstream.
    await step.do("rebase-dependents", { retries: { limit: 1, delay: "5 seconds" } }, async () => this.rebaseDependents(candidate, integrated.commit, integrated.branch, stub));
    // Preserve contributor forks for original-change review and recoverable authorship,
    // including squash landings whose original commits are not ancestors of the accepted head.
    await step.do("preserve-contribution-history", async () => ({ preserved: candidate.participatingTaskIds }));
    // One-way copy to GitHub, only after the landing is fully committed. It never throws: GitHub being down or
    // diverged is recorded for the owner and changes nothing here.
    await step.do("mirror-to-github", async () => {
      const cfg = await stub.mirrorSecret();
      if (!cfg) return { skipped: true };
      const mirror = await this.sandbox(`mirror-${candidate.id}`);
      try {
        const canonical = await this.canonicalRemote(stub);
        const r = await pushMirror({ exec: mirror.exec }, { target: cfg.target, githubToken: cfg.token, canonicalRemote: canonical.remote, canonicalToken: canonical.token, branch: integrated.branch, commit: integrated.commit });
        await stub.recordMirrorRun(integrated.commit, r.status, r.detail);
        return { status: r.status };
      } catch {
        await stub.recordMirrorRun(integrated.commit, "error", "Mirror workspace unavailable; use Retry now");
        return { status: "error" };
      } finally {
        await mirror.destroy();
      }
    });
    return { status: "accepted" as const, commit: integrated.commit, evidenceId: integrated.evidenceId };
  }

  /**
   * After a landing, replay each dependent change on top of its parent's new tip (`git rebase --onto new old`),
   * walking the stack downwards. A conflict stops that branch of the stack and flags the change for its author.
   */
  private async rebaseDependents(candidate: CandidateGeneration, landed: string, branch: string, stub: Stub): Promise<{ rebased: string[]; blocked: string[] }> {
    const state = await stub.getState();
    const accepted = new Set(candidate.participatingTaskIds);
    const tasks = Object.values(state.tasks);
    if (!tasks.some((t) => t.dependsOn && accepted.has(t.dependsOn))) return { rebased: [], blocked: [] };
    const sb = await this.sandbox(`rebase-${candidate.id}`);
    try {
    const canonical = await this.canonicalRemote(stub);
    const cloned = await sb.exec(`rm -rf ${WORK} && git clone --quiet ${q(canonical.remote)} ${WORK} && git -C ${WORK} config user.name FlareGit && git -C ${WORK} config user.email integrator@flaregit.com`, gitAuthEnv(canonical.token));
    if (!cloned.success) throw new Error("Could not clone canonical repository for stack rebase");

    const tip = new Map<string, string>(); // task id -> new tip (accepted tasks resolve to the landed commit)
    const oldTip = new Map<string, string>(); // task id -> tip before the rebase
    for (const id of accepted) { tip.set(id, landed); oldTip.set(id, state.tasks[id]!.currentCommit); }
    const rebased: string[] = [];
    const blocked: string[] = [];
    const queue = tasks.filter((t) => t.dependsOn && accepted.has(t.dependsOn));
    while (queue.length > 0) {
      const child = queue.shift()!;
      if (child.status === "cancelled" || child.status === "accepted") continue;
      const parentId = child.dependsOn!;
      const newParent = tip.get(parentId);
      const oldParent = oldTip.get(parentId);
      if (!newParent || !oldParent) continue; // parent was itself blocked: leave this subtree alone
      const repo = await this.env.ARTIFACTS.get(child.workspace.repoName);
      const remote = String((await repo.info()).remote);
      const token = (await repo.createToken("write", 1800)).plaintext;
      const ref = `refs/flaregit/rb/${child.id}`;
      const fetch = await sb.exec(`git -C ${WORK} fetch --quiet ${q(remote)} ${q(`+refs/heads/${child.workspace.branch}:${ref}`)}`, gitAuthEnv(token));
      const before = (await sb.exec(`git -C ${WORK} rev-parse ${q(ref)}`)).stdout.trim();
      const reb = fetch.success ? await sb.exec(`git -C ${WORK} checkout --quiet -B rb-work ${q(ref)} && git -C ${WORK} rebase --onto ${q(newParent)} ${q(oldParent)} rb-work`) : fetch;
      if (!reb.success) {
        await sb.exec(`git -C ${WORK} rebase --abort`);
        blocked.push(child.id);
        await stub.applyRebase(child.id, { failed: `Could not rebase onto ${parentId}: resolve the conflict locally and push again` });
        continue;
      }
      const head = (await sb.exec(`git -C ${WORK} rev-parse HEAD`)).stdout.trim();
      const push = await sb.exec(`git -C ${WORK} push --quiet --force-with-lease=${q(`refs/heads/${child.workspace.branch}:${before}`)} ${q(remote)} ${q(`HEAD:refs/heads/${child.workspace.branch}`)}`, gitAuthEnv(token));
      if (!push.success) {
        blocked.push(child.id);
        await stub.applyRebase(child.id, { failed: "Rebased locally but the push was refused (the branch moved); push again to retry" });
        continue;
      }
      oldTip.set(child.id, child.currentCommit);
      tip.set(child.id, head);
      rebased.push(child.id);
      await stub.applyRebase(child.id, { commit: head, base: newParent, parentAccepted: accepted.has(parentId) });
      queue.push(...tasks.filter((t) => t.dependsOn === child.id));
    }
    return { rebased, blocked };
    } finally {
      await sb.destroy();
    }
  }

  private projectId = "";

  /** Every allocation is isolated; interrupted work is recovered from retained Git refs. */
  private computeAccountKey?: string;
  private computeWorkflowId?: string;
  private async sandbox(id: string) {
    const repository=ledgerOf(this.env,this.projectId);
    await assertManagedInitiator(this.env,repository,this.computeWorkflowId,this.computeAccountKey);
    const allocationId=`native-${crypto.randomUUID()}`;
    await admitNativeCompute(this.env,this.computeAccountKey!,allocationId);
    const sb = this.env.INTEGRATOR.getByName(allocationId);
    return {
      exec: (cmd: string, env?: Record<string, string>) => sb.exec(["sh", "-c", cmd], { env }),
      readFile: async (p: string) => ({ content: await sb.readFile(p) }),
      readFileBytes: (p: string) => sb.readFileBytes(p),
      writeFile: (p: string, c: string) => sb.writeFile(p, c),
      destroy: async () => {
        try { await sb.destroy(); }
        catch {
          console.warn("Container cleanup failed");
          await ledgerOf(this.env, this.projectId).logActivity("FlareGit", "container.cleanup_failed", `Container ${id} did not confirm shutdown; durable Git refs are preserved`).catch(() => console.warn("Container cleanup evidence unavailable"));
        }
      },
    };
  }

  private async canonicalRemote(stub: Stub): Promise<{ remote: string; token: string }> {
    const repo = await this.env.ARTIFACTS.get((await stub.getState()).canonicalRepoName);
    const info = await repo.info();
    return { remote: String(info.remote), token: (await repo.createToken("write", 1800)).plaintext };
  }

  private async composeRepairVerify(
    candidate: CandidateGeneration,
    params: IntegrationParams,
    stub: Stub,
    parentWorkflowId: string
  ): Promise<{ ok: true; commit: string; evidenceId: string; branch: string } | { ok: false; error: string }> {
    const settings = settingsFor(candidate.frozenVerificationPolicy);
    const externalOnly = candidate.frozenExternalChecksPolicy?.mode === "external";
    if (externalOnly && (settings.fixture !== "custom" || !candidate.frozenExternalChecksPolicy?.checks.some((check) => check.required) || !candidate.frozenContributorProofs?.length)) return { ok: false, error: "External CI requires a custom repository, frozen contributor proofs and at least one required check" };
    const spendRunId = `repair-${candidate.id}`;
    let spending: Awaited<ReturnType<typeof reserveManagedAgent>> | null = null;
    try {
      if (!externalOnly) await assertManagedInitiator(this.env, stub, parentWorkflowId, params.accountKey);
      spending = externalOnly ? null : await reserveManagedAgent(this.env, params.accountKey, spendRunId);
      if (spending) await globalOf(this.env).consumeManagedSpend(spendRunId, 0, 0, 600);
    } catch {
      return { ok: false, error: "Managed verification budget unavailable; saved contributor checkpoints remain available. Configure a budget or use external checks." };
    }
    const sb = await this.sandbox(`integrate-${candidate.id}`);
    try {
    const run = async (cmd: string, env?: Record<string, string>) => sb.exec(cmd, env);
    const state = await stub.getState();
    const tasks = candidate.participatingTaskIds.map((id) => state.tasks[id]!);
    if (externalOnly && (candidate.frozenContributorProofs!.length !== tasks.length || !candidate.participatingTaskIds.every((id) => candidate.frozenContributorProofs!.some((proof) => proof.id === id && proof.commit === candidate.participatingCommits[id] && proof.ref === `refs/flaregit/tasks/${id}`)))) return { ok: false, error: "Frozen contributor proofs do not match every participating checkpoint" };
    const canonical = await this.canonicalRemote(stub);

    let r = await run(`rm -rf ${WORK} && git clone --quiet ${q(canonical.remote)} ${WORK}`, gitAuthEnv(canonical.token));
    if (!r.success) return { ok: false, error: "Could not clone canonical repository" };
    // The clone's HEAD names the remote's real default branch (Artifacts metadata can differ for imported repos).
    const branch = (await run(`git -C ${WORK} symbolic-ref --short HEAD`)).stdout.trim() || state.defaultBranch || "main";
    // The default branch name comes from the (possibly imported) repository: whitelist it before it reaches any command.
    if (!isSafeRef(branch)) throw new Error("Default branch name contains characters FlareGit does not accept");
    await run(`git -C ${WORK} config user.name FlareGit && git -C ${WORK} config user.email integrator@flaregit.com && git -C ${WORK} checkout --quiet --detach ${q(candidate.expectedAcceptedBase)}`);

    for (const t of tasks) {
      const repo = await this.env.ARTIFACTS.get(t.workspace.repoName);
      const remote = String((await repo.info()).remote);
      const token = (await repo.createToken("read", 900)).plaintext;
      r = await run(`git -C ${WORK} fetch --quiet ${q(remote)} ${q(`+refs/heads/${t.workspace.branch}:refs/flaregit/tasks/${t.id}`)}`, gitAuthEnv(token));
      const head = (await run(`git -C ${WORK} rev-parse refs/flaregit/tasks/${t.id}`)).stdout.trim();
      if (!r.success || head !== candidate.participatingCommits[t.id]) return { ok: false, error: `Task ${t.id} head does not match the frozen checkpoint` };
      const changed = await run(`git -C ${WORK} diff --name-only -z ${q(t.baseCommit)} ${q(head)}`);
      if (!changed.success) return { ok: false, error: `Could not inspect contributor changes for ${t.id}` };
      const touched = changed.stdout.split("\0").filter(Boolean);
      const bad = touched.filter((f) => isProtectedPath(f, settings.protectedPaths) || !inAgentScope(t, f) || !inAgentScope({ allowedScope: settings.allowedScope }, f));
      if (bad.length) return { ok: false, error: `Contributor change rejected: ${bad.join(", ")}` };
    }

    const ai = new WorkersAIClient({ binding: this.env.AI, gatewayId: this.env.AI_GATEWAY_ID, model: DEFAULT_CODE_MODEL, maxOutputTokens: 8192, maxCalls: 8, beforeDispatch: async ({ model, inputBytes, maxOutputTokens }) => {
      if (!spending || model !== DEFAULT_CODE_MODEL) throw new Error("Managed repair budget unavailable");
      await assertManagedInitiator(this.env, stub, parentWorkflowId, params.accountKey);
      await globalOf(this.env).consumeManagedSpend(spendRunId, inputBytes, maxOutputTokens, 0);
    } });
    let round = 0;
    candidate.repairAttempts = [];
    await stub.recordComposition(candidate.id, []);
    const repair = async (type: "text_conflict" | "behavior_failure", files: string[], evidence?: VerificationEvidence): Promise<boolean> => {
      if (externalOnly) return false; // External CI never grants implicit model repair authority.
      const started = Date.now();
      round += 1;
      if (round > MAX_REPAIR_ROUNDS) return false;
      const contents: Record<string, string> = {};
      for (const f of files) {
        const parts = f.split("/");
        if (f.startsWith("/") || parts.some((part) => !part || part === "." || part === "..")) return false;
        const ancestors = parts.map((_, i) => `${WORK}/${parts.slice(0, i + 1).join("/")}`);
        if (!(await run(ancestors.map((ancestor) => `test ! -L ${q(ancestor)}`).join(" && "))).success) return false;
        contents[f] = (await sb.readFile(`${WORK}/${f}`)).content;
      }
      // Whole-file model responses cannot preserve values the model is forbidden to see.
      // Leave credential-bearing files untouched for an explicit contributor correction.
      if (Object.values(contents).some((content) => redactSecrets(content) !== content)) {
        candidate.repairAttempts.push({ round, prompt: `Resolve ${type}`, patch: "", affectedContracts: [], diagnosticError: "Automatic repair refused: an editable file contains credentials; a contributor must resolve it", durationMs: Date.now() - started, timestamp: new Date().toISOString() });
        await stub.recordComposition(candidate.id, candidate.repairAttempts);
        return false;
      }
      const prompt = buildRepairPrompt({
        repoDir: WORK, candidate, tasks, round, conflictType: type,
        editableFiles: files, fileContents: contents, failureEvidence: evidence, protectedPaths: settings.protectedPaths, model: ai.asModel(),
      });
      const proposed = parseRepairResponse(await ai.complete(prompt));
      if (proposed.size === 0) return false;
      for (const [file, content] of proposed) {
        if (!files.includes(file) || /^(<<<<<<<|=======|>>>>>>>)/m.test(content)) return false;
        await sb.writeFile(`${WORK}/${file}`, content.endsWith("\n") ? content : `${content}\n`);
      }
      const committed = await run(`git -C ${WORK} add -A && git -C ${WORK} commit --quiet --allow-empty -m ${q(`FlareGit repair round ${round}`)}`);
      const patch = committed.success ? (await run(`git -C ${WORK} diff HEAD^ HEAD -- ${files.map(q).join(" ")}`)).stdout : "";
      candidate.repairAttempts.push({ round, prompt: redactSecrets(`Resolve ${type} in ${files.join(", ")}`), patch: redactSecrets(patch), affectedContracts: [], diagnosticError: committed.success ? "" : "Repair commit failed", durationMs: Date.now() - started, timestamp: new Date().toISOString() });
      await stub.recordComposition(candidate.id, candidate.repairAttempts);
      return committed.success;
    };

    for (const t of tasks) {
      const m = await run(`git -C ${WORK} merge --no-ff -m ${q(`FlareGit candidate ${candidate.id}: ${t.id}`)} refs/flaregit/tasks/${t.id}`);
      if (m.success) continue;
      const files = (await run(`git -C ${WORK} diff --name-only --diff-filter=U`)).stdout.split("\n").filter(Boolean);
      if (externalOnly) return { ok: false, error: "Native Git conflict requires explicit contributor resolution; saved branches are preserved" };
      if (files.length === 0 || !(await repair("text_conflict", files))) return { ok: false, error: "Conflict repair failed" };
    }

    // Squash landing: one commit on the accepted base with the combined tree. It is rebuilt before every
    // verification, so the commit that is verified, reviewed and published is always the squashed one.
    const squash = async () => {
      if (settings.landing !== "squash") return true;
      const tree = (await run(`git -C ${WORK} rev-parse ${q("HEAD^{tree}")}`)).stdout.trim();
      const coauthors = [...new Map(tasks.map((t) => [t.contributor.name, `Co-authored-by: ${t.contributor.name} <${t.contributor.id}@users.flaregit.com>`])).values()];
      const message = [`Land ${tasks.map((t) => t.id).join(" + ")}`, "", ...tasks.map((t) => `- ${t.goal}`), "", ...coauthors].join("\n");
      const made = await run(`git -C ${WORK} commit-tree ${q(tree)} -p ${q(candidate.expectedAcceptedBase)} -m ${q(message)}`);
      if (!made.success) return false;
      return (await run(`git -C ${WORK} checkout --quiet --detach ${q(made.stdout.trim())}`)).success;
    };

    for (;;) {
      if (!(await squash())) return { ok: false, error: "Could not create the squashed commit" };
      const commit = (await run(`git -C ${WORK} rev-parse HEAD`)).stdout.trim();
      const tree = externalOnly ? (await run(`git -C ${WORK} rev-parse ${q(`${commit}^{tree}`)}`)).stdout.trim() : undefined;
      const nativeInput = { repoDir: WORK, candidateCommit: commit, candidateTree: tree, expectedBase: candidate.expectedAcceptedBase, requirementsVersion: candidate.frozenPolicyVersion, policy: candidate.frozenVerificationPolicy, protectedPaths: settings.protectedPaths, allowedScope: settings.allowedScope, contributors: candidate.frozenContributorProofs, landing: settings.landing };
      const v = await run(externalOnly
        ? `cd /opt/flaregit && bun src/core/verification/cli.ts --native-integrity ${q(JSON.stringify(nativeInput))}`
        : `cd /opt/flaregit && bun src/core/verification/cli.ts ${settings.fixture} ${WORK} ${commit} ${candidate.expectedAcceptedBase} ${candidate.frozenPolicyVersion} ${q(JSON.stringify(candidate.frozenVerificationPolicy))}`
      );
      if (!v.success) return { ok: false, error: `Verifier crashed: ${v.stderr.slice(-500)}` };
      const evidence = JSON.parse(v.stdout.trim().split("\n").at(-1)!) as VerificationEvidence;
      await stub.recordVerification(candidate.id, commit, evidence);
      if (evidence.status === "passed") {
        // Build the exact verified commit and store it under that commit hash for immutable previews.
        // Only web apps with an index.html get a stored preview; other repositories are verified and accepted without one.
        const hasPage = !externalOnly && settings.fixture === "ticket-booking" && (await run(`test -f ${WORK}/index.html`)).success;
        const built = hasPage
          ? await run(`bun /opt/flaregit/src/core/verification/build-preview.ts ${q(WORK)} /tmp/build-out`)
          : { success: true, stderr: "" };
        if (!built.success) return { ok: false, error: `Build failed: ${built.stderr.slice(-400)}` };
        const files = hasPage ? (await run("cd /tmp/build-out && find . -type f")).stdout.split("\n").filter(Boolean) : [];
        for (const f of files) {
          const rel = f.replace(/^\.\//, "");
          const types: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf" };
          const type = types[rel.split(".").pop() ?? ""] ?? "application/octet-stream";
          await this.env.EVIDENCE_BUCKET.put(`${buildPrefix(params.projectId, commit)}/${rel}`, await sb.readFileBytes(`/tmp/build-out/${rel}`), { httpMetadata: { contentType: type } });
        }
        await this.env.EVIDENCE_BUCKET.put(`evidence/${evidence.id}.json`, JSON.stringify(evidence), { httpMetadata: { contentType: "application/json" }, customMetadata: { commit, tree: evidence.candidateTree } });
        // Publish the candidate under a private ref so reviewers can read exactly what would land, and it survives restarts.
        const shared = await run(`git -C ${WORK} push --quiet ${q(canonical.remote)} ${q(`${commit}:refs/flaregit/candidates/${candidate.id}`)}`, gitAuthEnv(canonical.token));
        if (!shared.success) return { ok: false, error: "Could not store the candidate for review" };
        return { ok: true, commit, evidenceId: evidence.id, branch };
      }
      if (externalOnly) return { ok: false, error: "Native Git integrity failed; no customer commands or automatic repairs ran" };
      const editable = (await run(`git -C ${WORK} ls-files`)).stdout
        .split("\n")
        .filter((f) => f && inAgentScope({ allowedScope: settings.allowedScope }, f) && !isProtectedPath(f, settings.protectedPaths) && /\.(ts|tsx|js|jsx|mjs|css|json|html|md|py|go|rs|rb|java|c|h|cpp|sh)$/.test(f))
        .slice(0, 40);
      if (!(await repair("behavior_failure", editable, evidence))) return { ok: false, error: "Protected verification failed and repair did not fix it" };
    }
    } finally {
      await sb.destroy();
    }
  }

  /** Compare-and-swap: only moves main if it still equals the verified base. */
  /**
   * Compare-and-swap publication. It depends on nothing that lived through review: a fresh workspace fetches the
   * stored candidate ref, proves it is the reviewed commit, and only moves the branch if it still equals the base.
   */
  private async casPush(candidate: CandidateGeneration, commit: string, stub: Stub, branch: string): Promise<{ ok: true } | { ok: false; error: string; stale?: boolean }> {
    const sb = await this.sandbox(`publish-${candidate.id}`);
    try {
    const canonical = await this.canonicalRemote(stub);
    const dir = "/workspace/publish";
    const fetched = await sb.exec(
      `rm -rf ${dir} && git init --quiet ${dir} && git -C ${dir} fetch --quiet --filter=blob:none ${q(canonical.remote)} ${q(`refs/flaregit/candidates/${candidate.id}:refs/flaregit/candidate`)}`,
      gitAuthEnv(canonical.token)
    );
    if (!fetched.success) return { ok: false, error: "The stored candidate could not be read back; nothing was published" };
    const head = (await sb.exec(`git -C ${dir} rev-parse refs/flaregit/candidate`)).stdout.trim();
    if (head !== commit) return { ok: false, error: "Stored candidate differs from the reviewed commit; nothing was published" };
    // A response can be lost after Git accepted the push. Prove ancestry from the real
    // canonical branch before retrying, including when another contributor advanced it.
    const alreadyLanded = () => publicationInHistory((command, env) => sb.exec(command, env), dir, canonical.remote, canonical.token, branch, commit);
    if (await alreadyLanded()) return { ok: true };
    const res = await sb.exec(
      `git -C ${dir} push --quiet --force-with-lease=${q(`refs/heads/${branch}:${candidate.expectedAcceptedBase}`)} ${q(canonical.remote)} ${q(`${commit}:refs/heads/${branch}`)}`,
      gitAuthEnv(canonical.token)
    );
    if (res.success) return { ok: true };
    // A retried step may find its own earlier push already landed: that is success, not a conflict.
    if (await alreadyLanded()) return { ok: true };
    return { ok: false, error: `Canonical ref update refused: ${res.stderr.replace(/Bearer [^\s"]+/g, "Bearer ***").slice(-300).trim()}`, stale: /stale info|rejected/i.test(res.stderr) };
    } finally {
      await sb.destroy();
    }
  }

}
