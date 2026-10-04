import type { NativeComputeKind } from "./managed-spend-ledger.js";
import type { Env } from "./env.js";
import { accountOf, globalOf, managedBudget } from "./projects.js";

export class NativeComputeAdmissionError extends Error {
  constructor(){super("Native compute budget unavailable before VM allocation");this.name="NativeComputeAdmissionError";}
}

/** Bounded native compute shares the funded pool without inventing AI usage. */
export async function admitNativeCompute(env: Env, accountKey: string, runId: string,resourceKind?:NativeComputeKind): Promise<void> {
  try {
  if(resourceKind!==undefined&&resourceKind!=="native-essential"&&resourceKind!=="native-optional")throw new NativeComputeAdmissionError();
  if (await accountOf(env, accountKey).accountLifecycle() !== "active") throw new Error("Compute account unavailable");
  const reservation = await globalOf(env).reserveManagedSpend({ ...(resourceKind?{resourceKind}:{}),runId, accountKey, usdMicros: 43_008, maxInputBytes: 1, maxOutputTokens: 1, maxCalls: 1, maxContainerSeconds: 1200 }, managedBudget(env));
  if (!reservation.allowed) throw new Error("Native compute budget unavailable; repository browsing remains available");
  await globalOf(env).consumeManagedSpend(runId, 0, 0, 1200);
  } catch { throw new NativeComputeAdmissionError(); }
}

/** Explicit recovery never steals a live attempt. It stops and inspects the
 * saved VM through the container's trusted lifetime controller before unlocking.
 * Its old financial reservation stays charged because usage is unknown. */
export async function recoverNativeCompute(env: Env, operationKey: string): Promise<{ recovered: boolean }> {
  const global = globalOf(env);
  const status = await global.nativeComputeStatus(operationKey);
  if (!status?.active) return { recovered: false };
  const sandbox = env.INTEGRATOR.getByName(status.sandboxName);
  await sandbox.destroy();
  const lifetime = await sandbox.lifetimeStatus();
  if (lifetime?.state !== "stopped") throw new Error("Native workspace stop is unconfirmed; operation remains locked");
  await global.finishNativeCompute(operationKey, status.token);
  return { recovered: true };
}

export async function claimNativeCompute(env: Env, operationKey: string): Promise<string | null> {
  const controller=globalOf(env);
  const token=await controller.claimNativeCompute(operationKey);
  if(token)return token;
  const status=await controller.nativeComputeStatus(operationKey);
  if(!status?.active||Date.now()<status.deadline)return null;
  await recoverNativeCompute(env,operationKey);
  return controller.claimNativeCompute(operationKey);
}
