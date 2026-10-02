import { WorkersAIClient } from "../ai/workers-ai.js";
import { assertAgentWrites, buildAgentPrompt, inAgentScope, isProtectedPath, redactSecrets } from "../agents/prompt.js";
import { parseRepairResponse } from "../core/pipeline/repair.js";
import { settingsFor } from "../core/command-policy.js";
import type { Task } from "../core/types.js";
import type { Ledger } from "./durable-object.js";
import type { Env } from "./env.js";
import { gitAuthEnv, q } from "./shell.js";

const WORK = "/workspace/task";
const MAX_CONTEXT_BYTES = 120_000;
const MAX_FILE_BYTES = 60_000;

/**
 * One coding agent, one task, one container: clone the task fork, let the model rewrite files inside the
 * task's scope, commit, push, record the checkpoint, then revoke the agent's credential.
 */
export async function runAgentTask(env: Env, ledger: Ledger, task: Task): Promise<{ commit: string }> {
  const state = await ledger.getState();
  const current = state.tasks[task.id];
  if (!current || ["accepted", "cancelled", "integrating", "verifying"].includes(current.status)) throw new Error("Change is no longer available for agent work");
  const settings = settingsFor(state.verificationPolicy);
  // Container identity is scoped to the repository: equal change ids in two repositories never share a workspace.
  // A duplicate start must never erase or destroy another run's live workspace.
  const sb = env.AGENT.getByName(`agent-${state.projectId}-${task.id}-${crypto.randomUUID()}`);
  const repo = await env.ARTIFACTS.get(task.workspace.repoName);
  const remote = String((await repo.info()).remote);
  const token = (await repo.createToken("write", 1800)).plaintext;
  const run = (cmd: string, e?: Record<string, string>) => sb.exec(["sh", "-c", cmd], { env: e });

  try {
    let r = await run(`rm -rf ${WORK} && git clone --quiet ${q(remote)} ${WORK}`, gitAuthEnv(token));
    if (!r.success) throw new Error("Agent could not clone its saved branch; retry the run");
    // Resume rather than restart: if an earlier (interrupted) run or a human already pushed to this branch, build on it.
    const resumed = (await run(`git -C ${WORK} rev-parse --verify --quiet ${q(`refs/remotes/origin/${task.workspace.branch}`)}`)).success;
    r = await run(`git -C ${WORK} checkout --quiet -B ${q(task.workspace.branch)} ${q(resumed ? `origin/${task.workspace.branch}` : task.baseCommit)}`);
    if (!r.success) throw new Error("Agent could not restore its branch; no changes were made");

    // Shared task context: the linked issue, the conversation on this change, and what was already done.
    const notes: string[] = [];
    if (task.issue) {
      const issue = await ledger.getIssue(task.issue);
      if (issue) notes.push(`Issue #${issue.number}: ${issue.title}\n${issue.body}`.slice(0, 4000));
    }
    const comments = await ledger.listComments(`change:${task.id}`);
    for (const c of comments.slice(-20)) notes.push(`${c.author}${c.path ? ` on ${c.path}${c.line ? `:${c.line}` : ""}` : ""}: ${c.body}`.slice(0, 1500));
    if (resumed) notes.push(`This branch already has work from an earlier run (${task.checkpoints.length} checkpoint(s)); continue from the current files instead of starting over.`);

    const listed = (await run(`git -C ${WORK} ls-files -z`)).stdout.split("\0").filter(Boolean);
    const files: Record<string, string> = {};
    const secretFiles = new Set<string>();
    let total = 0;
    for (const f of listed) {
      if (!inAgentScope(task, f) || isProtectedPath(f, settings.protectedPaths) || !/\.(ts|tsx|js|jsx|mjs|cjs|css|json|html|md|py|go|rs|rb|java|c|h|cpp|sh|yml|yaml|toml)$/.test(f)) continue;
      // Never follow repository symlinks into files outside the checkout or through linked parents.
      if (!(await run(`test -f ${q(`${WORK}/${f}`)} && test ! -L ${q(`${WORK}/${f}`)}`)).success) continue;
      const content = await sb.readFile(`${WORK}/${f}`);
      if (redactSecrets(content) !== content) { secretFiles.add(f); continue; }
      if (content.length > MAX_FILE_BYTES) continue;
      total += content.length;
      if (total > MAX_CONTEXT_BYTES) break;
      files[f] = content;
    }

    const ai = new WorkersAIClient({ binding: env.AI, gatewayId: env.AI_GATEWAY_ID });
    const proposed = parseRepairResponse(await ai.complete(buildAgentPrompt(task, task.contributor.name, files, settings.checkCommand, notes.join("\n\n"))));
    if (proposed.size === 0) throw new Error("model returned no file changes");
    assertAgentWrites(task, proposed.keys(), settings.protectedPaths);
    for (const [file, content] of proposed) {
      if (secretFiles.has(file)) throw new Error("Agent proposed replacing a credential-bearing file; human editing is required");
      const dir = file.split("/").slice(0, -1).join("/");
      for (const prefix of file.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"))) {
        if ((await run(`test -L ${q(`${WORK}/${prefix}`)}`)).success) throw new Error("Agent write would traverse a repository symlink");
      }
      if ((await run(`test -L ${q(`${WORK}/${file}`)}`)).success) throw new Error("Agent cannot replace a repository symlink");
      if (dir) await run(`mkdir -p ${q(`${WORK}/${dir}`)}`);
      await sb.writeFile(`${WORK}/${file}`, content.endsWith("\n") ? content : `${content}\n`);
    }
    r = await run(`git -C ${WORK} add -A && git -C ${WORK} -c user.name=${q(task.contributor.name)} -c user.email=${q(`${task.id}@agents.flaregit.com`)} commit --quiet -m ${q(task.goal)}`);
    if (!r.success) throw new Error("Agent could not commit its changes; the saved branch is unchanged");
    const commit = (await run(`git -C ${WORK} rev-parse HEAD`)).stdout.trim();
    const changed = await run(`git -C ${WORK} diff --name-only -z ${q(task.baseCommit)} ${q(commit)}`);
    if (!changed.success) throw new Error("Agent could not inspect its changes; the saved branch is unchanged");
    const filesChanged = changed.stdout.split("\0").filter(Boolean);
    const beforePush = (await ledger.getState()).tasks[task.id];
    if (!beforePush || ["accepted", "cancelled", "integrating", "verifying"].includes(beforePush.status)) throw new Error("Change was stopped before push; accepted history is unchanged");
    r = await run(`git -C ${WORK} push --quiet ${q(remote)} ${q(`${task.workspace.branch}:refs/heads/${task.workspace.branch}`)}`, gitAuthEnv(token));
    if (!r.success) throw new Error("Agent push was refused; the saved branch may have advanced. Retry to build on the latest work");

    const checkpoint = await ledger.ingestCheckpoint({ eventId: `push-${task.id}-${commit}`, taskId: task.id, commit, ready: true, filesChanged });
    if (!checkpoint.applied) {
      const latest = (await ledger.getState()).tasks[task.id];
      if (!latest || latest.currentCommit !== commit || ["accepted", "cancelled"].includes(latest.status)) throw new Error("Branch push was saved but the change stopped before its checkpoint; inspect the saved branch");
    }
    return { commit };
  } finally {
    await repo.revokeToken(token).catch(() => false); // the agent's credential dies with its run
    await sb.destroy().catch(() => undefined);
  }
}
