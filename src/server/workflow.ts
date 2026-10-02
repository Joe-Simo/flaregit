import { isSafeRef } from "../core/sanitize.js";
import { buildPrefix } from "./preview-access.js";
import { pushMirror } from "./mirror.js";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { WorkersAIClient } from "../ai/workers-ai.js";
import { buildRepairPrompt, parseRepairResponse, MAX_REPAIR_ROUNDS } from "../core/pipeline/repair.js";
import type { CandidateGeneration, VerificationEvidence } from "../core/types.js";
import type { Env } from "./env.js";
import type { ClaimResult, Ledger, PrepareResult } from "./durable-object.js";
import { gitAuthEnv, q } from "./shell.js";
import { ledgerOf } from "./scenario-workflow.js";
import { settingsFor } from "../core/command-policy.js";
import { inAgentScope, isProtectedPath } from "../agents/prompt.js";

export interface IntegrationParams {
  projectId: string;
  /** One to eight changes, merged in this order. */
  taskIds: string[];
}

const WORK = "/workspace/integration";

type Stub = Ledger;

export class FlareGitIntegrationWorkflow extends WorkflowEntrypoint<Env, IntegrationParams> {
  override async run(event: WorkflowEvent<IntegrationParams>, step: WorkflowStep) {
    const stub = ledgerOf(this.env, event.payload.projectId) as Stub;
    this.projectId = event.payload.projectId;
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
      return { status: claim.decision ? "needs_decision" : "not_started", reason: claim.reason, decision: claim.decision };
    }
    const candidate = claim.candidate;

    const integrated = await step.do(
      "compose-repair-verify",
      { retries: { limit: 1, delay: "10 seconds", backoff: "constant" }, timeout: "20 minutes" },
      async () => this.composeRepairVerify(candidate, event.payload, stub)
    );

    if (!integrated.ok) {
      await step.do("abort", async () => stub.abortPublish(candidate.id, undefined, integrated.error, "failed"));
      return { status: "blocked", error: integrated.error };
    }

    // Human control over history: the verified candidate waits until a person accepts this exact commit.
    await step.do("await-review", async () => stub.awaitReview(candidate.id, integrated.commit, event.instanceId));
    let review: { approved: boolean; by: string; note?: string };
    try {
      review = (await step.waitForEvent<{ approved: boolean; by: string; note?: string }>("human-review", { type: "review", timeout: "7 days" })).payload;
    } catch {
      await step.do("abort-unreviewed", async () => stub.abortPublish(candidate.id, undefined, "Nobody reviewed the candidate within 7 days; run the integration again", "stale"));
      return { status: "stale", error: "review timed out" };
    }
    if (!review.approved) {
      await step.do("abort-rejected", async () => stub.abortPublish(candidate.id, undefined, `Rejected in review by ${review.by}${review.note ? `: ${review.note}` : ""}`, "failed"));
      return { status: "rejected", by: review.by };
    }

    const prepared = (await step.do("prepare-publish", async () => (await stub.preparePublish(candidate.id)) as never)) as PrepareResult;
    if (!prepared.ok || !prepared.journal) {
      await step.do("abort-prepare", async () => stub.abortPublish(candidate.id, undefined, prepared.error ?? "refused", prepared.stale ? "stale" : "failed"));
      return { status: prepared.stale ? "stale" : "blocked", error: prepared.error };
    }

    const pushed = await step.do("cas-push-to-artifacts", { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" } }, async () => this.casPush(candidate, integrated.commit, stub, integrated.branch));
    if (!pushed.ok) {
      await step.do("abort-push", async () => stub.abortPublish(candidate.id, prepared.journal!.id, pushed.error, pushed.stale ? "stale" : "failed"));
      return { status: pushed.stale ? "stale" : "blocked", error: pushed.error };
    }
    await step.do("complete-publish", async () => stub.completePublish(prepared.journal!.id));
    // Stacked changes: re-base every dependent change onto what just landed, so the stack keeps tracking upstream.
    await step.do("rebase-dependents", { retries: { limit: 1, delay: "5 seconds" } }, async () => this.rebaseDependents(candidate, integrated.commit, integrated.branch, stub));
    // The accepted commits now live in the canonical repository; the task forks are no longer needed.
    await step.do("cleanup-forks", async () => {
      const st = await stub.getState();
      for (const id of candidate.participatingTaskIds) {
        const t = st.tasks[id];
        if (t && t.status === "accepted") await this.env.ARTIFACTS.delete(t.workspace.repoName).catch(() => false);
      }
      return { cleaned: true };
    });
    // One-way copy to GitHub, only after the landing is fully committed. It never throws: GitHub being down or
    // diverged is recorded for the owner and changes nothing here.
    await step.do("mirror-to-github", async () => {
      const cfg = await stub.mirrorSecret();
      if (!cfg) return { skipped: true };
      try {
        const canonical = await this.canonicalRemote(stub);
        const r = await pushMirror({ exec: this.sandbox(`mirror-${candidate.id}`).exec }, { target: cfg.target, githubToken: cfg.token, canonicalRemote: canonical.remote, canonicalToken: canonical.token, branch: integrated.branch, commit: integrated.commit });
        await stub.recordMirrorRun(integrated.commit, r.status, r.detail);
        return { status: r.status };
      } catch {
        await stub.recordMirrorRun(integrated.commit, "error", "Mirror workspace unavailable; use Retry now");
        return { status: "error" };
      }
    });
    return { status: "accepted", commit: integrated.commit, evidenceId: integrated.evidenceId };
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
    const sb = this.sandbox(`rebase-${candidate.id}`);
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
  }

  private projectId = "";

  /** Containers are named per repository and candidate, so concurrent runs elsewhere can never share a workspace. */
  private sandbox(id: string) {
    const sb = this.env.INTEGRATOR.getByName(`${this.projectId}-${id}`);
    return {
      exec: (cmd: string, env?: Record<string, string>) => sb.exec(["sh", "-c", cmd], { env }),
      readFile: async (p: string) => ({ content: await sb.readFile(p) }),
      writeFile: (p: string, c: string) => sb.writeFile(p, c),
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
    stub: Stub
  ): Promise<{ ok: true; commit: string; evidenceId: string; branch: string } | { ok: false; error: string }> {
    const settings = settingsFor(candidate.frozenVerificationPolicy);
    const sb = this.sandbox(`integrate-${candidate.id}`);
    const run = async (cmd: string, env?: Record<string, string>) => sb.exec(cmd, env);
    const state = await stub.getState();
    const tasks = candidate.participatingTaskIds.map((id) => state.tasks[id]!);
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
      const touched = (await run(`git -C ${WORK} diff --name-only ${q(candidate.expectedAcceptedBase)} ${head}`)).stdout.split("\n").filter(Boolean);
      const bad = touched.filter((f) => isProtectedPath(f, settings.protectedPaths) || !inAgentScope({ allowedScope: settings.allowedScope }, f));
      if (bad.length) return { ok: false, error: `Contributor change rejected: ${bad.join(", ")}` };
    }

    const ai = new WorkersAIClient({ binding: this.env.AI, gatewayId: this.env.AI_GATEWAY_ID });
    let round = 0;
    const repair = async (type: "text_conflict" | "behavior_failure", files: string[], evidence?: VerificationEvidence): Promise<boolean> => {
      round += 1;
      if (round > MAX_REPAIR_ROUNDS) return false;
      const contents: Record<string, string> = {};
      for (const f of files) contents[f] = (await sb.readFile(`${WORK}/${f}`)).content;
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
      return (await run(`git -C ${WORK} add -A && git -C ${WORK} commit --quiet --allow-empty -m ${q(`FlareGit repair round ${round}`)}`)).success;
    };

    for (const t of tasks) {
      const m = await run(`git -C ${WORK} merge --no-ff -m ${q(`FlareGit candidate ${candidate.id}: ${t.id}`)} refs/flaregit/tasks/${t.id}`);
      if (m.success) continue;
      const files = (await run(`git -C ${WORK} diff --name-only --diff-filter=U`)).stdout.split("\n").filter(Boolean);
      if (files.length === 0 || !(await repair("text_conflict", files))) return { ok: false, error: "Conflict repair failed" };
    }

    for (;;) {
      const commit = (await run(`git -C ${WORK} rev-parse HEAD`)).stdout.trim();
      const v = await run(
        `cd /opt/flaregit && bun src/core/verification/cli.ts ${settings.fixture} ${WORK} ${commit} ${candidate.expectedAcceptedBase} ${candidate.frozenPolicyVersion} ${q(JSON.stringify(candidate.frozenVerificationPolicy))}`
      );
      if (!v.success) return { ok: false, error: `Verifier crashed: ${v.stderr.slice(-500)}` };
      const evidence = JSON.parse(v.stdout.trim().split("\n").at(-1)!) as VerificationEvidence;
      await stub.recordVerification(candidate.id, commit, evidence);
      if (evidence.status === "passed") {
        // Build the exact verified commit and store it under that commit hash for immutable previews.
        // Only web apps with an index.html get a stored preview; other repositories are verified and accepted without one.
        const hasPage = (await run(`test -f ${WORK}/index.html`)).success && settings.fixture === "ticket-booking";
        const built = hasPage
          ? await run(`cd ${WORK} && ln -sfn /opt/flaregit/node_modules node_modules && rm -rf /tmp/build-out && bun build index.html --outdir /tmp/build-out --minify`)
          : { success: true, stderr: "" };
        if (!built.success) return { ok: false, error: `Build failed: ${built.stderr.slice(-400)}` };
        const files = hasPage ? (await run("cd /tmp/build-out && find . -type f")).stdout.split("\n").filter(Boolean) : [];
        for (const f of files) {
          const rel = f.replace(/^\.\//, "");
          const type = rel.endsWith(".html") ? "text/html; charset=utf-8" : rel.endsWith(".js") ? "text/javascript" : rel.endsWith(".css") ? "text/css" : "application/octet-stream";
          await this.env.EVIDENCE_BUCKET.put(`${buildPrefix(params.projectId, commit)}/${rel}`, (await sb.readFile(`/tmp/build-out/${rel}`)).content, { httpMetadata: { contentType: type } });
        }
        await this.env.EVIDENCE_BUCKET.put(`evidence/${evidence.id}.json`, JSON.stringify(evidence), { httpMetadata: { contentType: "application/json" }, customMetadata: { commit, tree: evidence.candidateTree } });
        // Publish the candidate under a private ref so reviewers can read exactly what would land, and it survives restarts.
        const shared = await run(`git -C ${WORK} push --quiet ${q(canonical.remote)} ${q(`${commit}:refs/flaregit/candidates/${candidate.id}`)}`, gitAuthEnv(canonical.token));
        if (!shared.success) return { ok: false, error: "Could not store the candidate for review" };
        return { ok: true, commit, evidenceId: evidence.id, branch };
      }
      const editable = (await run(`git -C ${WORK} ls-files`)).stdout
        .split("\n")
        .filter((f) => f && inAgentScope({ allowedScope: settings.allowedScope }, f) && !isProtectedPath(f, settings.protectedPaths) && /\.(ts|tsx|js|jsx|mjs|css|json|html|md|py|go|rs|rb|java|c|h|cpp|sh)$/.test(f))
        .slice(0, 40);
      if (!(await repair("behavior_failure", editable, evidence))) return { ok: false, error: "Protected verification failed and repair did not fix it" };
    }
  }

  /** Compare-and-swap: only moves main if it still equals the verified base. */
  /**
   * Compare-and-swap publication. It depends on nothing that lived through review: a fresh workspace fetches the
   * stored candidate ref, proves it is the reviewed commit, and only moves the branch if it still equals the base.
   */
  private async casPush(candidate: CandidateGeneration, commit: string, stub: Stub, branch: string): Promise<{ ok: true } | { ok: false; error: string; stale?: boolean }> {
    const sb = this.sandbox(`publish-${candidate.id}`);
    const canonical = await this.canonicalRemote(stub);
    const dir = "/workspace/publish";
    const fetched = await sb.exec(
      `rm -rf ${dir} && git init --quiet ${dir} && git -C ${dir} fetch --quiet --filter=blob:none ${q(canonical.remote)} ${q(`refs/flaregit/candidates/${candidate.id}:refs/flaregit/candidate`)}`,
      gitAuthEnv(canonical.token)
    );
    if (!fetched.success) return { ok: false, error: "The stored candidate could not be read back; nothing was published" };
    const head = (await sb.exec(`git -C ${dir} rev-parse refs/flaregit/candidate`)).stdout.trim();
    if (head !== commit) return { ok: false, error: "Stored candidate differs from the reviewed commit; nothing was published" };
    const res = await sb.exec(
      `git -C ${dir} push --quiet --force-with-lease=${q(`refs/heads/${branch}:${candidate.expectedAcceptedBase}`)} ${q(canonical.remote)} ${q(`${commit}:refs/heads/${branch}`)}`,
      gitAuthEnv(canonical.token)
    );
    if (res.success) return { ok: true };
    // A retried step may find its own earlier push already landed: that is success, not a conflict.
    const now = (await sb.exec(`git -C ${dir} ls-remote ${q(canonical.remote)} ${q(`refs/heads/${branch}`)}`, gitAuthEnv(canonical.token))).stdout.split("\t")[0]?.trim();
    if (now === commit) return { ok: true };
    return { ok: false, error: `Canonical ref update refused: ${res.stderr.replace(/Bearer [^\s"]+/g, "Bearer ***").slice(-300).trim()}`, stale: /stale info|rejected/i.test(res.stderr) };
  }

}
