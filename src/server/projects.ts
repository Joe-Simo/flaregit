import type { Ledger } from "./durable-object.js";
import type { Env } from "./env.js";
import { projectIdFor } from "./shell.js";

/** Stable per-user key (hash of the Clerk user id): owns billing, quota and the repository list. */
export const accountKeyFor = (userId: string) => projectIdFor(userId);

const stub = (env: Env, name: string) => env.REPOSITORY_CONTROLLER.get(env.REPOSITORY_CONTROLLER.idFromName(name)) as unknown as Ledger;

export const accountOf = (env: Env, accountKey: string): Ledger => stub(env, `account:${accountKey}`);
export const projectOf = (env: Env, projectId: string): Ledger => stub(env, `project:${projectId}`);
export const globalOf = (env: Env): Ledger => stub(env, "global");

export const PROJECT_ID = /^[a-z0-9]{12,16}$/;
export const newProjectId = () => `p${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
export const canonicalNameFor = (projectId: string) => `flaregit-${projectId}`;
export const taskRepoName = (projectId: string, taskId: string) => `t-${projectId}-${taskId}`;

/** Spend control shared by every model-backed action: kill switch, per-account plan quota, platform-wide ceiling. */
export async function admitRun(env: Env, account: Ledger, planLimit: number): Promise<Response | null> {
  if (env.RUNS_ENABLED === "false") return new Response("AI runs are temporarily paused. Please try again later.", { status: 503 });
  const mine = await account.consumeRun(planLimit);
  if (!mine.allowed) return new Response(`Daily run limit reached (${mine.used}/${planLimit}). Upgrade for more.`, { status: 429 });
  const global = await globalOf(env).consumeRun(Number(env.GLOBAL_RUNS_PER_DAY ?? "300"));
  if (!global.allowed) return new Response("FlareGit is at capacity for today. Please try again tomorrow.", { status: 503 });
  return null;
}
