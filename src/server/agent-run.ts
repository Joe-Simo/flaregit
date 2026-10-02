import { WorkersAIClient } from "../ai/workers-ai.js";
import { assertAgentWrites, buildAgentPrompt, inAgentScope, isProtectedPath } from "../agents/prompt.js";
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
  const settings = settingsFor(state.verificationPolicy);
  const sb = env.AGENT.getByName(`agent-${task.id}`);
  const repo = await env.ARTIFACTS.get(task.workspace.repoName);
  const remote = String((await repo.info()).remote);
  const token = (await repo.createToken("write", 1800)).plaintext;
  const run = (cmd: string, e?: Record<string, string>) => sb.exec(["sh", "-c", cmd], { env: e });

  try {
    let r = await run(`rm -rf ${WORK} && git clone --quiet ${q(remote)} ${WORK}`, gitAuthEnv(token));
    if (!r.success) throw new Error(`clone failed: ${r.stderr.slice(-300)}`);
    await run(`git -C ${WORK} checkout --quiet -B ${q(task.workspace.branch)} ${q(task.baseCommit)}`);

    const listed = (await run(`git -C ${WORK} ls-files`)).stdout.split("\n").filter(Boolean);
    const files: Record<string, string> = {};
    let total = 0;
    for (const f of listed) {
      if (!inAgentScope(task, f) || isProtectedPath(f, settings.protectedPaths) || !/\.(ts|tsx|js|jsx|mjs|cjs|css|json|html|md|py|go|rs|rb|java|c|h|cpp|sh|yml|yaml|toml)$/.test(f)) continue;
      const content = await sb.readFile(`${WORK}/${f}`);
      if (content.length > MAX_FILE_BYTES) continue;
      total += content.length;
      if (total > MAX_CONTEXT_BYTES) break;
      files[f] = content;
    }

    const ai = new WorkersAIClient({ binding: env.AI, gatewayId: env.AI_GATEWAY_ID });
    const proposed = parseRepairResponse(await ai.complete(buildAgentPrompt(task, task.contributor.name, files, settings.checkCommand)));
    if (proposed.size === 0) throw new Error("model returned no file changes");
    assertAgentWrites(task, proposed.keys(), settings.protectedPaths);
    for (const [file, content] of proposed) {
      const dir = file.split("/").slice(0, -1).join("/");
      if (dir) await run(`mkdir -p ${q(`${WORK}/${dir}`)}`);
      await sb.writeFile(`${WORK}/${file}`, content.endsWith("\n") ? content : `${content}\n`);
    }
    r = await run(`git -C ${WORK} add -A && git -C ${WORK} -c user.name=${q(task.contributor.name)} -c user.email=${q(`${task.id}@agents.flaregit.com`)} commit --quiet -m ${q(task.goal)}`);
    if (!r.success) throw new Error(`commit failed: ${r.stderr.slice(-300)}`);
    const commit = (await run(`git -C ${WORK} rev-parse HEAD`)).stdout.trim();
    r = await run(`git -C ${WORK} push --quiet ${q(remote)} ${q(`${task.workspace.branch}:refs/heads/${task.workspace.branch}`)}`, gitAuthEnv(token));
    if (!r.success) throw new Error(`push failed: ${r.stderr.slice(-300)}`);

    await ledger.ingestCheckpoint({ eventId: `push-${task.id}-${commit}`, taskId: task.id, commit, ready: true });
    return { commit };
  } finally {
    await repo.revokeToken(token).catch(() => false); // the agent's credential dies with its run
    await sb.destroy().catch(() => undefined);
  }
}
