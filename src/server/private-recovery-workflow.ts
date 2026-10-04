import {recoveryBranchMetadata,recoveryBranchMetadataMatches,recoveryBranchFields} from "./private-recovery-branch";
export {recoveryBranchMetadata,recoveryBranchMetadataMatches} from "./private-recovery-branch";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./env.js";
import { accountOf, globalOf, projectOf } from "./projects.js";
import { admitNativeCompute, claimNativeCompute, recoverNativeCompute } from "./native-compute.js";
import { BUNDLE_CHUNK_BYTES, MAX_BUNDLE_BYTES, createAcceptedBundle } from "./private-recovery-bundle.js";
import { recoveryBundleKey, recoveryScopeId, type PrivateRecoveryOperation, type PrivateRecoveryReceipt } from "./private-recovery.js";

export interface PrivateRecoveryParams { projectId: string; operationId: string }

/** Match durable scope and complete private object before accepting a cached receipt. */
export async function verifiedRecoveryReceipt(bucket: R2Bucket, operation: PrivateRecoveryOperation, expectedETag?: string): Promise<PrivateRecoveryReceipt | null> {
  const key = recoveryBundleKey(operation);
  const document = await bucket.get(`${key}.json`);
  if (!document) return null;
  let receipt: PrivateRecoveryReceipt;
  try { receipt = await document.json<PrivateRecoveryReceipt>(); } catch { return null; }
  if (!receipt || receipt.projectId !== operation.projectId || receipt.incarnation !== operation.incarnation || receipt.commit !== operation.commit || receipt.tree !== operation.tree || receipt.journalId !== operation.journalId || receipt.objectScope !== "exact-accepted-reachable-closure" || receipt.acceptedRef!==operation.acceptedRef || receipt.acceptedRootVersion!==operation.acceptedRootVersion || !Number.isSafeInteger(receipt.size) || receipt.size < 1 || receipt.size > MAX_BUNDLE_BYTES || !Number.isSafeInteger(receipt.objectCount) || receipt.objectCount < 1 || !/^[a-f0-9]{64}$/.test(receipt.sha256) || !Number.isFinite(Date.parse(receipt.createdAt))) return null;
  const object = await bucket.head(key);
  if (!object || !recoveryBranchMetadataMatches(operation,object.customMetadata) || (expectedETag !== undefined && object.etag !== expectedETag) || object.size !== receipt.size || object.customMetadata?.sha256 !== receipt.sha256 || object.customMetadata?.commit !== operation.commit || object.customMetadata?.tree !== operation.tree || object.customMetadata?.operationId !== operation.id || object.customMetadata?.scopeId !== recoveryScopeId(operation) || object.customMetadata?.objectCount !== String(receipt.objectCount) || object.customMetadata?.createdAt !== receipt.createdAt || object.customMetadata?.projectId !== operation.projectId || object.customMetadata?.incarnation !== operation.incarnation || object.customMetadata?.journalId !== operation.journalId || object.customMetadata?.objectScope !== receipt.objectScope) return null;
  return receipt;
}

export class FlareGitPrivateRecoveryWorkflow extends WorkflowEntrypoint<Env, PrivateRecoveryParams> {
  override async run(event: WorkflowEvent<PrivateRecoveryParams>, step: WorkflowStep) {
    const { projectId, operationId } = event.payload;
        const ledger = projectOf(this.env, projectId);
    const initial = await ledger.privateRecoveryOperation(operationId);
    if (!initial || recoveryScopeId(initial) !== event.instanceId) throw new Error("Private recovery workflow identity mismatch");
    const authorize = async () => {
      const operation = await ledger.privateRecoveryOperation(operationId);
      if (!operation || operation.id !== operationId || operation.projectId !== projectId || recoveryScopeId(operation) !== event.instanceId || await accountOf(this.env, operation.accountKey).accountLifecycle() !== "active" || !await ledger.privateRecoveryAuthorize(operationId, operation.ownerId)) throw new Error("Private recovery owner authorization unavailable");
      return operation;
    };
    try {
      await step.do("authorize-private-recovery", authorize);
      const receipt = await step.do("build-and-persist-private-accepted-bundle", { retries: { limit: 0, delay: "5 seconds", backoff: "constant" }, timeout: "20 minutes" }, async () => {
        let operation = await authorize();
        const leaseKey = `recovery-${recoveryScopeId(operation)}`;
        if ((await globalOf(this.env).nativeComputeStatus(leaseKey))?.active) await recoverNativeCompute(this.env, leaseKey);
        // An unrecorded upload ID may retain billable multipart parts. Never
        // start a replacement or release its reservation from object absence.
        if (!operation.uploadState || operation.uploadState === "allocating") throw new Error("Private recovery upload allocation is unconfirmed");
        if (operation.uploadState === "active") {
          if (!operation.uploadId) throw new Error("Private recovery upload identity is unavailable");
          await this.env.EVIDENCE_BUCKET.resumeMultipartUpload(recoveryBundleKey(operation), operation.uploadId).abort();
          await ledger.privateRecoveryCloseUpload(operationId, operation.uploadId, event.instanceId);
          operation = await authorize();
        }
        let cached = await verifiedRecoveryReceipt(this.env.EVIDENCE_BUCKET, operation);
        if (!cached && operation.uploadState !== "allocating" && operation.uploadState) {
          const key = recoveryBundleKey(operation);
          const completed = await this.env.EVIDENCE_BUCKET.head(key);
          if (completed) {
            const metadata = completed.customMetadata;
            const objectCount = Number(metadata?.objectCount);
            if (!operation.tree || !recoveryBranchMetadataMatches(operation,metadata) || completed.size < 1 || completed.size > MAX_BUNDLE_BYTES || metadata?.projectId !== operation.projectId || metadata?.incarnation !== operation.incarnation || metadata?.operationId !== operation.id || metadata?.scopeId !== recoveryScopeId(operation) || metadata?.commit !== operation.commit || metadata?.tree !== operation.tree || metadata?.journalId !== operation.journalId || metadata?.objectScope !== "exact-accepted-reachable-closure" || !metadata.sha256 || !/^[a-f0-9]{64}$/.test(metadata.sha256) || !Number.isSafeInteger(objectCount) || objectCount < 1 || !metadata.createdAt || !Number.isFinite(Date.parse(metadata.createdAt))) throw new Error("Existing private recovery object needs confirmed cleanup");
            await authorize();
            const reconstructed: PrivateRecoveryReceipt = { ...recoveryBranchFields(operation),projectId, incarnation: operation.incarnation, commit: operation.commit, tree: operation.tree, journalId: operation.journalId, size: completed.size, sha256: metadata.sha256, objectCount, objectScope: "exact-accepted-reachable-closure", createdAt: metadata.createdAt };
            const pinned = await this.env.EVIDENCE_BUCKET.head(key);
            if (!pinned || pinned.etag !== completed.etag || pinned.size !== completed.size) throw new Error("Private recovery object changed during receipt recovery");
            await this.env.EVIDENCE_BUCKET.put(`${key}.json`, JSON.stringify(reconstructed), { httpMetadata: { contentType: "application/json" } });
            cached = await verifiedRecoveryReceipt(this.env.EVIDENCE_BUCKET, operation, completed.etag);
            if (!cached) throw new Error("Private recovery receipt reconciliation is unconfirmed");
          }
        }
        if (cached) {
          await authorize();
          return cached;
        }
        const lease = await claimNativeCompute(this.env, leaseKey);
        if (!lease) throw new Error("Private recovery native workspace is already active");
        const sandboxName = `native-${lease}`;
        const sandbox = this.env.INTEGRATOR.getByName(sandboxName);
        let allocated = false;
        try {
          await admitNativeCompute(this.env, operation.accountKey, sandboxName);
          await authorize();
          using repository = await this.env.ARTIFACTS.get(operation.canonicalRepoName);
          const info = await repository.info();
          const token = await repository.createToken("read", 1200);
          allocated = true;
          const bundle = await createAcceptedBundle(sandbox, { remote: String(info.remote), token: token.plaintext, commit: operation.commit, tree: operation.tree, ...recoveryBranchFields(operation),directory: `/tmp/flaregit-private-recovery-${crypto.randomUUID()}` });
          if (operation.tree === null) {
            await ledger.privateRecoveryRecordTree(operationId, bundle.tree, event.instanceId);
            operation = await authorize();
          }
          if(bundle.acceptedRef!==operation.acceptedRef||bundle.acceptedRootVersion!==operation.acceptedRootVersion)throw new Error("Recovery branch authority changed");
          if (operation.tree !== bundle.tree) throw new Error("Recovery tree authority changed");
          await authorize();
          const key = recoveryBundleKey(operation);
          await ledger.privateRecoveryBeginUpload(operationId, event.instanceId);
          const preparedAt = new Date().toISOString();
          const upload = await this.env.EVIDENCE_BUCKET.createMultipartUpload(key, { httpMetadata: { contentType: "application/x-git-bundle" }, customMetadata: { ...recoveryBranchMetadata(operation),projectId, incarnation: operation.incarnation, commit: operation.commit, tree: operation.tree, journalId: operation.journalId, objectScope: "exact-accepted-reachable-closure", scopeId: recoveryScopeId(operation), sha256: bundle.sha256, objectCount: String(bundle.objectCount), createdAt: preparedAt, operationId } });
          try {
            await ledger.privateRecoverySaveUpload(operationId, upload.uploadId, event.instanceId);
            const parts: R2UploadedPart[] = [];
            for (let offset = 0; offset < bundle.size; offset += BUNDLE_CHUNK_BYTES) {
              const length = Math.min(BUNDLE_CHUNK_BYTES, bundle.size - offset);
              await authorize();
              const bytes = await sandbox.readFileChunk(bundle.path, offset, length);
              if (bytes.byteLength !== length) throw new Error("Private recovery bundle chunk is incomplete");
              parts.push(await upload.uploadPart(parts.length + 1, bytes));
            }
            await authorize();
            await upload.complete(parts);
            await ledger.privateRecoveryCloseUpload(operationId, upload.uploadId, event.instanceId);
          } catch {
            // Keep the durable hold if abort or its saved confirmation fails.
            await upload.abort().then(() => ledger.privateRecoveryCloseUpload(operationId, upload.uploadId, event.instanceId)).catch(() => undefined);
            throw new Error("Private recovery bundle upload failed");
          }
          await authorize();
          const document: PrivateRecoveryReceipt = { ...recoveryBranchFields(operation),projectId, incarnation: operation.incarnation, commit: operation.commit, tree: operation.tree, journalId: operation.journalId, size: bundle.size, sha256: bundle.sha256, objectCount: bundle.objectCount, objectScope: "exact-accepted-reachable-closure", createdAt: preparedAt };
          await this.env.EVIDENCE_BUCKET.put(`${key}.json`, JSON.stringify(document), { httpMetadata: { contentType: "application/json" } });
          const verified = await verifiedRecoveryReceipt(this.env.EVIDENCE_BUCKET, operation);
          if (!verified) throw new Error("Private recovery receipt verification failed");
          return verified;
        } finally {
          if (!allocated) await globalOf(this.env).finishNativeCompute(leaseKey, lease);
          else {
            await sandbox.destroy();
            if ((await sandbox.lifetimeStatus())?.state !== "stopped") throw new Error("Private recovery workspace stop is unconfirmed");
            await globalOf(this.env).finishNativeCompute(leaseKey, lease);
          }
        }
      });
      await step.do("publish-private-recovery-receipt", async () => {
        const operation = await authorize();
        const verified = await verifiedRecoveryReceipt(this.env.EVIDENCE_BUCKET, operation);
        if (!verified || verified.sha256 !== receipt.sha256) throw new Error("Private recovery complete object unavailable");
        await ledger.privateRecoveryComplete(operationId, verified);
      });
      return { projectId, operationId, status: "ready" };
    } catch {
      await ledger.privateRecoveryFail(operationId, "Private recovery did not complete. Retry the saved accepted commit.", event.instanceId).catch(() => undefined);
      throw new Error("Private recovery did not complete; no download was published");
    }
  }
}
