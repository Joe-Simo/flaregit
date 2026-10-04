import type { ManagedEnvelope } from "./managed-spend-ledger.js";
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

/** Recover only repository references from the former normalized identity key.
 * Membership is checked against the original, case-sensitive subject before any
 * metadata is copied. Billing, credentials and personal profile data never migrate.
 */
export async function adoptLegacyProject(env: Env, account: Ledger, accountKey: string, userId: string) {
  const formerKey = await projectIdFor(userId.trim().toLowerCase());
  const references = formerKey !== accountKey ? await accountOf(env, formerKey).listProjects().catch(() => []) : [];
  const candidates = new Set([accountKey, formerKey, ...references.map((row) => row.id)]);
  for (const id of candidates) {
    if (!PROJECT_ID.test(id)) continue;
    try {
      const repository = projectOf(env, id);
      const role = await repository.roleOf(userId);
      if (!role) continue;
      const state = await repository.getState();
      await account.addProject({ id, name: state.projectName || "demo", role, kind: state.kind ?? "demo" });
    } catch {
      // Unavailable repositories remain recoverable on the next account read.
    }
  }
  return account.listProjects();
}

/** Spend control shared by every model-backed action: kill switch, per-account plan quota, platform-wide ceiling. */
export async function admitRun(env: Env, account: Ledger, planLimit: number, admissionKey?: string): Promise<Response | null> {
  if (env.RUNS_ENABLED === "false") return new Response("Managed runs are temporarily paused. Please try again later.", { status: 503 });
  const mine = await account.consumeRun(planLimit, admissionKey);
  if (!mine.allowed) return new Response(`Daily run limit reached (${mine.used}/${planLimit}). Upgrade for more.`, { status: 429 });
  const global = await globalOf(env).consumeRun(Number(env.GLOBAL_RUNS_PER_DAY ?? "300"), admissionKey);
  if (!global.allowed) return new Response("FlareGit is at capacity for today. Please try again tomorrow.", { status: 503 });
  return null;
}

const explicitMicros = (value: string | undefined): number | null => {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
};
export const managedBudget = (env: Pick<Env,"MANAGED_ACCOUNT_MONTHLY_USD_MICROS"|"MANAGED_GLOBAL_MONTHLY_USD_MICROS"|"MANAGED_ESSENTIAL_ACCOUNT_MONTHLY_USD_MICROS"|"MANAGED_ESSENTIAL_GLOBAL_MONTHLY_USD_MICROS">) => ({ accountUsdMicros: explicitMicros(env.MANAGED_ACCOUNT_MONTHLY_USD_MICROS), globalUsdMicros: explicitMicros(env.MANAGED_GLOBAL_MONTHLY_USD_MICROS), essentialAccountUsdMicros:explicitMicros(env.MANAGED_ESSENTIAL_ACCOUNT_MONTHLY_USD_MICROS),essentialGlobalUsdMicros:explicitMicros(env.MANAGED_ESSENTIAL_GLOBAL_MONTHLY_USD_MICROS) });
/** Conservative token bound uses one input token per UTF-8 byte plus framing.
 * Model rate snapshot: GPT OSS 120B $0.35/$0.75 per million input/output tokens.
 * Container allocation is separately reserved at $0.129024/hr for standard-2.
 * Provider billing outside these components remains unverified. */
export async function reserveManagedAgent(env: Env, accountKey: string | undefined, runId: string) {
  if (!accountKey) throw new Error("Managed spending account is unavailable");
  if (env.RUNS_ENABLED === "false") throw new Error("Managed execution is paused");
  const result = await globalOf(env).reserveManagedSpend(managedAgentEnvelope(accountKey, runId), managedBudget(env));
  if (!result.allowed) throw new Error(`Managed execution unavailable: ${result.reason}`);
  return result.reservation;
}

export function managedAgentEnvelope(accountKey: string, runId: string):ManagedEnvelope {
  const maxInputBytes = 120_000, maxOutputTokens = 8192, maxCalls = 8, maxContainerSeconds = 1200;
  const modelMicros = Math.ceil(((maxInputBytes + 4096) * 0.35 + maxOutputTokens * 0.75) * maxCalls);
  const containerMicros = Math.ceil(maxContainerSeconds * 129_024 / 3600);
  return { resourceKind:"managed-agent",runId, accountKey, usdMicros: modelMicros + containerMicros, maxInputBytes, maxOutputTokens, maxCalls, maxContainerSeconds };
}
export async function reserveManagedAgents(env: Env, accountKey: string, runIds: string[]): Promise<Response | null> {
  if (env.RUNS_ENABLED === "false") return new Response("Managed execution is temporarily paused", { status: 503 });
  const results = await globalOf(env).reserveManagedSpendBatch(runIds.map((runId) => managedAgentEnvelope(accountKey, runId)), managedBudget(env));
  const refused = results.find((result) => !result.allowed);
  return refused && !refused.allowed ? new Response(`Managed execution unavailable: ${refused.reason}. Repository browsing, review and external tools remain available.`, { status: refused.reason === "account_budget" ? 429 : 503 }) : null;
}

/** Revalidate the durable initiator on every funded dispatch. Workflow payloads
 * alone never authorize billing or survive membership/account revocation. */
export async function assertManagedInitiator(env: Env, repository: Ledger, workflowId: string | undefined, accountKey: string | undefined, taskId?: string): Promise<void> {
  if (!workflowId || !accountKey) throw new Error("Managed initiator unavailable");
  const registered = await repository.getWorkflowRun(workflowId);
  const actorId = registered?.actorId;
  if (!actorId || !await repository.roleOf(actorId) || await accountKeyFor(actorId) !== accountKey || await accountOf(env, accountKey).accountLifecycle() !== "active") throw new Error("Managed initiator access was revoked");
  if (taskId && !await repository.canGitAccess(actorId, taskId, true)) throw new Error("Managed initiator cannot modify this workspace");
}

export async function managedSpendStatus(env: Env, accountKey: string, modelBacked = true) {
  const caps = managedBudget(env), month = new Date().toISOString().slice(0, 7);
  const [reservedUsdMicros, platformReserved] = await Promise.all([globalOf(env).managedSpendReserved(month, accountKey), globalOf(env).managedSpendReserved(month)]);
  return { status: modelBacked && env.RUNS_ENABLED === "false" ? "paused" : caps.accountUsdMicros === null || caps.globalUsdMicros === null ? "unconfigured" : reservedUsdMicros >= caps.accountUsdMicros ? "account_budget_exhausted" : platformReserved >= caps.globalUsdMicros ? "platform_budget_exhausted" : "configured", month, accountBudgetUsdMicros: caps.accountUsdMicros, reservedUsdMicros, basis: "reserved_conservative_bounds" as const, actualInvoiceCost: "unverified" as const, coverage: "managed_model_and_container_envelopes" as const };
}
