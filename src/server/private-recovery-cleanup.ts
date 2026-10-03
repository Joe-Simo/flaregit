import type { Env } from "./env.js";
import type { Ledger } from "./durable-object.js";
import { globalOf } from "./projects.js";
import { recoverNativeCompute } from "./native-compute.js";
import { recoveryBundleKey, recoveryScopeId, type PrivateRecoveryOperation } from "./private-recovery.js";

/** Admission remains charged until both cached objects are independently absent. */
export async function deleteRecoveryObjects(
  bucket: Pick<R2Bucket, "delete" | "head">,
  operation: PrivateRecoveryOperation,
  release: (id: string, accountKey: string) => Promise<void>,
): Promise<void> {
  const key = recoveryBundleKey(operation);
  await bucket.delete([key, `${key}.json`]);
  const [bundle, receipt] = await Promise.all([bucket.head(key), bucket.head(`${key}.json`)]);
  if (bundle || receipt) throw new Error("Private recovery storage cleanup is unconfirmed");
  await release(recoveryScopeId(operation), operation.accountKey);
}

export type PrivateRecoveryCleanupOutcome =
  | { deleted: true; recoveryAction: "none"; detail: string }
  | { deleted: false; recoveryAction: "retry" | "provider-reconciliation"; detail: string };
const retryOutcome = (): PrivateRecoveryCleanupOutcome => ({ deleted: false, recoveryAction: "retry", detail: "Cached recovery cleanup is unconfirmed. Retry the same removal; saved records and capacity reservations are preserved." });
export function privateRecoveryCleanupAdvice(operation: PrivateRecoveryOperation): PrivateRecoveryCleanupOutcome | null {
  if (operation.uploadState === "allocating" || (operation.uploadState === "active" && !operation.uploadId) || (operation.dispatchState !== "not-started" && !operation.uploadState)) return {
    deleted: false, recoveryAction: "provider-reconciliation", detail: "The saved upload identity is incomplete. Operator reconciliation with the storage provider is required; retrying removal alone cannot resolve it. Saved records and capacity reservations are preserved.",
  };
  return null;
}

/** Only explicit owner-confirmed cache or owner repository/account deletion calls
 * this. A durable fence and stopped writers precede cached-object deletion. */
export async function cleanupPrivateRecoveryOutcome(env: Env, ledger: Ledger, operation: PrivateRecoveryOperation): Promise<PrivateRecoveryCleanupOutcome> {
  let unknownDispatch = false;
  try {
    const current = await ledger.privateRecoveryOperation(operation.id);
    if (!current || current.incarnation !== operation.incarnation || (!current.cacheState && !await ledger.repositoryDeletionPending())) return retryOutcome();
    if (current.cacheState === "deleted") return { deleted: true, recoveryAction: "none", detail: "Cached recovery bundle removed. Repository history is preserved." };
    if (current.dispatchState !== "not-started") {
      if (!env.PRIVATE_RECOVERY_WORKFLOW) return retryOutcome();
      unknownDispatch = current.dispatchState === "uncertain";
      const handle = await env.PRIVATE_RECOVERY_WORKFLOW.get(recoveryScopeId(current));
      if (!["complete", "errored", "terminated"].includes((await handle.status()).status)) {
        await handle.terminate();
        if ((await handle.status()).status !== "terminated") return retryOutcome();
      }
      unknownDispatch = false;
      await recoverNativeCompute(env, `recovery-${recoveryScopeId(current)}`);
    }
    let stopped = await ledger.privateRecoveryOperation(current.id);
    if (!stopped || stopped.incarnation !== current.incarnation) return retryOutcome();
    const advice = privateRecoveryCleanupAdvice(stopped);
    if (advice) return advice;
    if (stopped.uploadState === "active") {
      if (!stopped.uploadId) return retryOutcome();
      await env.EVIDENCE_BUCKET.resumeMultipartUpload(recoveryBundleKey(stopped), stopped.uploadId).abort();
      await ledger.privateRecoveryCloseUpload(stopped.id, stopped.uploadId, recoveryScopeId(stopped));
      stopped = await ledger.privateRecoveryOperation(stopped.id);
      if (!stopped || stopped.uploadState !== "closed") return retryOutcome();
    }
    // New dispatched operations must carry explicit upload bookkeeping. Old
    // unknown attempts retain admission because hidden multipart parts may exist.
    if (stopped.dispatchState !== "not-started" && !["not-started", "closed"].includes(stopped.uploadState ?? "")) return retryOutcome();
    await deleteRecoveryObjects(env.EVIDENCE_BUCKET, stopped, (id, accountKey) => globalOf(env).releasePrivateRecoveryStorage(id, accountKey));
    await ledger.privateRecoveryFinishDeletion(stopped.id);
    return { deleted: true, recoveryAction: "none", detail: "Cached recovery bundle removed. Repository history is preserved." };
  } catch {
    if (unknownDispatch) return { deleted: false, recoveryAction: "provider-reconciliation", detail: "Workflow dispatch was not confirmed and its provider state is unavailable. Operator reconciliation with the workflow provider may be required. Saved records and capacity reservations are preserved; absence of a Workflow does not prove dispatch was cancelled." };
    return retryOutcome();
  }
}

export async function cleanupPrivateRecoveryOperation(env: Env, ledger: Ledger, operation: PrivateRecoveryOperation): Promise<boolean> {
  return (await cleanupPrivateRecoveryOutcome(env, ledger, operation)).deleted;
}

export async function cleanupPrivateRecovery(env: Env, ledger: Ledger): Promise<boolean> {
  return (await cleanupPrivateRecoveryRepositoryOutcome(env, ledger)).deleted;
}

export async function cleanupPrivateRecoveryRepositoryOutcome(env: Env, ledger: Ledger): Promise<PrivateRecoveryCleanupOutcome> {
  if (!await ledger.repositoryDeletionPending()) return retryOutcome();
  for (const operation of await ledger.privateRecoveryCleanupList()) {
    const outcome = await cleanupPrivateRecoveryOutcome(env, ledger, operation);
    if (!outcome.deleted) return outcome;
  }
  return { deleted: true, recoveryAction: "none", detail: "Cached recovery storage removed. Repository deletion can continue." };
}
