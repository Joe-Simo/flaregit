import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { WorkersAIClient } from "../ai/workers-ai.js";
import { buildRepairPrompt, parseRepairResponse, MAX_REPAIR_ROUNDS } from "../core/pipeline/repair.js";
import type { CandidateGeneration, Task, VerificationEvidence } from "../core/types.js";
import type { Env } from "./env.js";
import type { ClaimResult, Ledger, PrepareResult } from "./durable-object.js";
import { gitAuthEnv, q } from "./shell.js";
import { ledgerOf } from "./scenario-workflow.js";
import { settingsFor } from "../core/command-policy.js";
import { inAgentScope, isProtectedPath } from "../agents/prompt.js";

export interface IntegrationParams {
  projectId: string;
  taskIds: [string, string];
}

const WORK = "/workspace/integration";

type Stub = Ledger;

export class FlareGitIntegrationWorkflow extends WorkflowEntrypoint<Env, IntegrationParams> {
  override async run(event: WorkflowEvent<IntegrationParams>, step: WorkflowStep) {
    const stub = ledgerOf(this.env, event.payload.projectId) as Stub;
    const holder = event.instanceId;

    const claim = await step.do("claim-landing", async () => (await stub.claimLanding({ holder, taskIds: event.payload.taskIds })) as never) as ClaimResult;
    if (!claim.candidate) return { status: claim.decision ? "needs_decision" : "not_started", reason: claim.reason, decision: claim.decision };
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
    // The accepted commits now live in the canonical repository; the task forks are no longer needed.
    await step.do("cleanup-forks", async () => {
      const st = await stub.getState();
      for (const id of candidate.participatingTaskIds) {
        const t = st.tasks[id];
        if (t && t.status === "accepted") await this.env.ARTIFACTS.delete(t.workspace.repoName).catch(() => false);
      }
      return { cleaned: true };
    });
    return { status: "accepted", commit: integrated.commit, evidenceId: integrated.evidenceId };
  }

  private sandbox(id: string) {
    const sb = this.env.INTEGRATOR.getByName(id);
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
    const tasks = candidate.participatingTaskIds.map((id) => state.tasks[id]!) as [Task, Task];
    const canonical = await this.canonicalRemote(stub);

    let r = await run(`rm -rf ${WORK} && git clone --quiet ${q(canonical.remote)} ${WORK}`, gitAuthEnv(canonical.token));
    if (!r.success) return { ok: false, error: "Could not clone canonical repository" };
    // The clone's HEAD names the remote's real default branch (Artifacts metadata can differ for imported repos).
    const branch = (await run(`git -C ${WORK} symbolic-ref --short HEAD`)).stdout.trim() || state.defaultBranch || "main";
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
        repoDir: WORK, candidate, taskA: tasks[0], taskB: tasks[1], round, conflictType: type,
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
          await this.env.EVIDENCE_BUCKET.put(`builds/${commit}/${rel}`, (await sb.readFile(`/tmp/build-out/${rel}`)).content, { httpMetadata: { contentType: type } });
        }
        await this.env.EVIDENCE_BUCKET.put(`evidence/${evidence.id}.json`, JSON.stringify(evidence), { httpMetadata: { contentType: "application/json" }, customMetadata: { commit, tree: evidence.candidateTree } });
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
  private async casPush(candidate: CandidateGeneration, commit: string, stub: Stub, branch: string): Promise<{ ok: true } | { ok: false; error: string; stale?: boolean }> {
    const sb = this.sandbox(`integrate-${candidate.id}`);
    const canonical = await this.canonicalRemote(stub);
    const head = (await sb.exec(`git -C ${WORK} rev-parse HEAD`)).stdout.trim();
    if (head !== commit) return { ok: false, error: "Workspace head differs from the verified commit" };
    const res = await sb.exec(
      `git -C ${WORK} push --quiet --force-with-lease=refs/heads/${branch}:${q(candidate.expectedAcceptedBase)} ${q(canonical.remote)} ${commit}:refs/heads/${branch}`,
      gitAuthEnv(canonical.token)
    );
    if (res.success) return { ok: true };
    return { ok: false, error: `Canonical ref update refused: ${res.stderr.replace(/Bearer [^\s"]+/g, "Bearer ***").slice(-300).trim()}`, stale: /stale info/i.test(res.stderr) };
  }
}
