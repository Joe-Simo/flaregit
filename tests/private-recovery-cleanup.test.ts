import { expect, test } from "bun:test";
import { cleanupPrivateRecoveryOperation, deleteRecoveryObjects } from "../src/server/private-recovery-cleanup";
import { recoveryScopeId, type PrivateRecoveryOperation } from "../src/server/private-recovery";
import type { Env } from "../src/server/env";
import type { Ledger } from "../src/server/durable-object";

const operation: PrivateRecoveryOperation = {
  id: "11111111-1111-4111-8111-111111111111", projectId: "abcdef123456",
  incarnation: "22222222-2222-4222-8222-222222222222", commit: "a".repeat(40), tree: "b".repeat(40),
  journalId: "accepted", canonicalRepoName: "repository", ownerId: "owner", accountKey: "account",
  status: "ready", dispatchState: "started", uploadState: "closed", cacheState: "deleting", createdAt: new Date().toISOString(),
};

test("slot release follows confirmed deletion of bundle and receipt", async () => {
  const events: string[] = [];
  await deleteRecoveryObjects({ delete: async keys => { expect(keys).toHaveLength(2); events.push("delete"); }, head: async key => { events.push(key.endsWith(".json") ? "receipt" : "bundle"); return null; } }, operation, async (id, account) => { expect(id).toBe(recoveryScopeId(operation)); expect(account).toBe(operation.accountKey); events.push("release"); });
  expect(events).toEqual(["delete", "bundle", "receipt", "release"]);
});

test("unavailable deletion confirmation retains its storage reservation", async () => {
  let released = false;
  await expect(deleteRecoveryObjects({ delete: async () => {}, head: async () => { throw new Error("R2 unavailable"); } }, operation, async () => { released = true; })).rejects.toThrow("R2 unavailable");
  expect(released).toBe(false);
});

test("failed object deletion retains its storage reservation", async () => {
  let released = false;
  await expect(deleteRecoveryObjects({ delete: async () => { throw new Error("delete unavailable"); }, head: async () => null }, operation, async () => { released = true; })).rejects.toThrow("delete unavailable");
  expect(released).toBe(false);
});

function fixture(input: { fenced?: boolean; dispatchState?: PrivateRecoveryOperation["dispatchState"]; workflowAvailable?: boolean; stopped?: boolean; objectPresent?: boolean; activeCompute?: boolean; computeStopped?: boolean; deleted?: boolean; uploadState?: PrivateRecoveryOperation["uploadState"] | "missing"; lostUploadId?: boolean; abortConfirmed?: boolean; closeConfirmed?: boolean; lateUpload?: boolean } = {}) {
  const events: string[] = [];
  const current = { ...operation, ...(input.dispatchState ? { dispatchState: input.dispatchState } : {}), ...(input.fenced === false ? { cacheState: undefined } : {}), ...(input.deleted ? { cacheState: "deleted" as const } : {}), ...(input.uploadState ? { uploadState: input.uploadState === "missing" ? undefined : input.uploadState, uploadId: input.lostUploadId ? undefined : "saved-upload" } : {}) };
  let terminated = false;
  let reads = 0;
  const ledger = { privateRecoveryOperation: async () => { reads++; if (input.lateUpload && reads === 2) { current.uploadState = "active"; current.uploadId = "saved-upload"; } return current; }, privateRecoveryCloseUpload: async (_id: string, uploadId: string) => { expect(uploadId).toBe("saved-upload"); events.push("upload-close"); if (input.closeConfirmed !== false) current.uploadState = "closed"; }, repositoryDeletionPending: async () => false, privateRecoveryFinishDeletion: async () => { events.push("tombstone"); } } as unknown as Ledger;
  const controller = { nativeComputeStatus: async (key: string) => { expect(key).toBe(`recovery-${recoveryScopeId(current)}`); return input.activeCompute ? { active: true, sandboxName: "saved-workspace", token: "lease" } : null; }, finishNativeCompute: async () => { events.push("compute-release"); }, releasePrivateRecoveryStorage: async () => { events.push("release"); } };
  const env = {
    PRIVATE_RECOVERY_WORKFLOW: { get: async (id: string) => {
      expect(id).toBe(recoveryScopeId(current));
      events.push("workflow");
      if (input.workflowAvailable === false) throw new Error("unknown workflow");
      return { status: async () => ({ status: terminated && input.stopped !== false ? "terminated" : "running" }), terminate: async () => { terminated = true; events.push("terminate"); } };
    } },
    EVIDENCE_BUCKET: { resumeMultipartUpload: (_key: string, uploadId: string) => { expect(uploadId).toBe("saved-upload"); return { abort: async () => { events.push("upload-abort"); if (input.abortConfirmed === false) throw new Error("abort unavailable"); } }; }, delete: async () => { events.push("delete"); }, head: async () => input.objectPresent ? {} : null },
    INTEGRATOR: { getByName: () => ({ destroy: async () => { events.push("compute-stop"); }, lifetimeStatus: async () => ({ state: input.computeStopped === false ? "running" : "stopped" }) }) },
    REPOSITORY_CONTROLLER: { idFromName: (name: string) => name, get: () => controller },
  } as unknown as Env;
  return { env, ledger, events, current };
}

test("cleanup refuses storage access without a durable deletion fence", async () => {
  const f = fixture({ fenced: false });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(false);
  expect(f.events).toEqual([]);
});

test("unknown workflow state keeps objects and reservation", async () => {
  const f = fixture({ workflowAvailable: false });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(false);
  expect(f.events).toEqual(["workflow"]);
});

test("unconfirmed workflow termination keeps objects and reservation", async () => {
  const f = fixture({ stopped: false });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(false);
  expect(f.events).toEqual(["workflow", "terminate"]);
});

test("confirmed stopped writer permits cached cleanup and durable tombstone", async () => {
  const f = fixture();
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(true);
  expect(f.events).toEqual(["workflow", "terminate", "delete", "release", "tombstone"]);
});

test("never-dispatched operations can clean up without nonexistent workflow lookup", async () => {
  const f = fixture({ dispatchState: "not-started", workflowAvailable: false });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(true);
  expect(f.events).toEqual(["delete", "release", "tombstone"]);
});

test("objects remaining after delete do not release capacity or retire metadata", async () => {
  const f = fixture({ objectPresent: true });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(false);
  expect(f.events).toEqual(["workflow", "terminate", "delete"]);
});


test("unconfirmed native workspace shutdown retains cached objects and storage capacity", async () => {
  const f = fixture({ activeCompute: true, computeStopped: false });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(false);
  expect(f.events).toEqual(["workflow", "terminate", "compute-stop"]);
});

test("native writer shutdown is independently confirmed before cached object deletion", async () => {
  const f = fixture({ activeCompute: true });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(true);
  expect(f.events).toEqual(["workflow", "terminate", "compute-stop", "compute-release", "delete", "release", "tombstone"]);
});


test("completed cache deletion tombstone avoids expired workflow lookup during later account cleanup", async () => {
  const f = fixture({ deleted: true, workflowAvailable: false });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(true);
  expect(f.events).toEqual([]);
});


test("lost multipart allocation ID holds storage capacity", async () => {
  const f = fixture({ uploadState: "allocating", lostUploadId: true });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(false);
  expect(f.events).toEqual(["workflow", "terminate"]);
});

test("active multipart identity missing from durable state holds storage capacity", async () => {
  const f = fixture({ uploadState: "active", lostUploadId: true });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(false);
  expect(f.events).toEqual(["workflow", "terminate"]);
});

test("unknown multipart abort outcome holds storage capacity", async () => {
  const f = fixture({ uploadState: "active", abortConfirmed: false });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(false);
  expect(f.events).toEqual(["workflow", "terminate", "upload-abort"]);
});

test("multipart closure must be durably confirmed before capacity release", async () => {
  const f = fixture({ uploadState: "active", closeConfirmed: false });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(false);
  expect(f.events).toEqual(["workflow", "terminate", "upload-abort", "upload-close"]);
});

test("known multipart upload is aborted and closure recorded before cached object cleanup", async () => {
  const f = fixture({ uploadState: "active" });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(true);
  expect(f.events).toEqual(["workflow", "terminate", "upload-abort", "upload-close", "delete", "release", "tombstone"]);
});

test("legacy dispatched attempt without multipart bookkeeping retains admission", async () => {
  const f = fixture({ uploadState: "missing" });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(false);
  expect(f.events).toEqual(["workflow", "terminate"]);
});


test("failed preparation before any upload allocation can free its cached reservation", async () => {
  const f = fixture({ uploadState: "not-started" });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(true);
  expect(f.events).toEqual(["workflow", "terminate", "delete", "release", "tombstone"]);
});

test("cleanup re-reads upload identity saved while workflow termination is pending", async () => {
  const f = fixture({ lateUpload: true });
  expect(await cleanupPrivateRecoveryOperation(f.env, f.ledger, f.current)).toBe(true);
  expect(f.events).toEqual(["workflow", "terminate", "upload-abort", "upload-close", "delete", "release", "tombstone"]);
});
