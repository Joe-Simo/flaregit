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

/** Only explicit owner-confirmed cache or owner repository/account deletion calls
 * this. A durable fence and stopped writers precede cached-object deletion. */
export async function cleanupPrivateRecoveryOperation(env: Env, ledger: Ledger, operation: PrivateRecoveryOperation): Promise<boolean> {
  try {
    const current = await ledger.privateRecoveryOperation(operation.id);
    if (!current || current.incarnation !== operation.incarnation || (!current.cacheState && !await ledger.repositoryDeletionPending())) return false;
    if (current.cacheState === "deleted") return true;
    if (current.dispatchState !== "not-started") {
      if (!env.PRIVATE_RECOVERY_WORKFLOW) return false;
      const handle = await env.PRIVATE_RECOVERY_WORKFLOW.get(recoveryScopeId(current));
      if (!["complete", "errored", "terminated"].includes((await handle.status()).status)) {
        await handle.terminate();
        if ((await handle.status()).status !== "terminated") return false;
      }
      await recoverNativeCompute(env, `recovery-${recoveryScopeId(current)}`);
    }
    let stopped = await ledger.privateRecoveryOperation(current.id);
    if (!stopped || stopped.incarnation !== current.incarnation) return false;
    if (stopped.uploadState === "allocating") return false;
    if (stopped.uploadState === "active") {
      if (!stopped.uploadId) return false;
      await env.EVIDENCE_BUCKET.resumeMultipartUpload(recoveryBundleKey(stopped), stopped.uploadId).abort();
      await ledger.privateRecoveryCloseUpload(stopped.id, stopped.uploadId, recoveryScopeId(stopped));
      stopped = await ledger.privateRecoveryOperation(stopped.id);
      if (!stopped || stopped.uploadState !== "closed") return false;
    }
    // New dispatched operations must carry explicit upload bookkeeping. Old
    // unknown attempts retain admission because hidden multipart parts may exist.
    if (stopped.dispatchState !== "not-started" && !["not-started", "closed"].includes(stopped.uploadState ?? "")) return false;
    await deleteRecoveryObjects(env.EVIDENCE_BUCKET, stopped, (id, accountKey) => globalOf(env).releasePrivateRecoveryStorage(id, accountKey));
    await ledger.privateRecoveryFinishDeletion(stopped.id);
    return true;
  } catch {
    return false;
  }
}

export async function cleanupPrivateRecovery(env: Env, ledger: Ledger): Promise<boolean> {
  if (!await ledger.repositoryDeletionPending()) return false;
  for (const operation of await ledger.privateRecoveryCleanupList()) {
    if (!await cleanupPrivateRecoveryOperation(env, ledger, operation)) return false;
  }
  return true;
}
