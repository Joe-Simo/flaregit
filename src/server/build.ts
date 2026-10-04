import { assertPreviewStorageAdmission, PreviewStorageAdmissionError } from "./preview-storage.js";
import { inspectPreviewStorageManifest, publishPreviewStorageManifest } from "./preview-storage-upload.js";
import { globalOf, projectOf } from "./projects.js";
import { admitNativeCompute, claimNativeCompute } from "./native-compute.js";
import type { Env } from "./env.js";
import { gitAuthEnv, q } from "./shell.js";
import { buildPrefix } from "./preview-access.js";

/** Build the exact commit in a disposable unprivileged snapshot, then store its preview assets. */
export async function ensureBuild(env: Env, projectId: string, commit: string, canonicalRepo: string, accountKey: string): Promise<void> {
  const prefix = buildPrefix(projectId, commit);
  if (await env.EVIDENCE_BUCKET.head(`${prefix}/index.html`)) return;
  const operationKey = `build-${projectId}-${commit}`;
  if(await globalOf(env).nativeComputeFailure(operationKey))throw new Error("Preview build failed; owner retry is required");
  const lease = await claimNativeCompute(env, operationKey);
  if (!lease) return;
  try { await admitNativeCompute(env, accountKey, `native-${lease}`,"native-optional"); }
  catch (error) { await globalOf(env).finishNativeCompute(operationKey, lease); throw error; }
  // Durable single-flight covers the exact repository commit.
  let repo: Awaited<ReturnType<Env["ARTIFACTS"]["get"]>> | undefined;
  let token: string | undefined;
  const sb = env.INTEGRATOR.getByName(`native-${lease}`);
  const run = (cmd: string, e?: Record<string, string>) => sb.exec(["sh", "-c", cmd], { env: e });
  const dir = "/workspace/build-src";

  try {
    repo = await env.ARTIFACTS.get(canonicalRepo);
    const remote = String((await repo.info()).remote);
    token = (await repo.createToken("read", 900)).plaintext;
    const cloned = await run(`git clone --quiet ${q(remote)} ${dir} && git -C ${dir} checkout --quiet --detach ${q(commit)}`, gitAuthEnv(token));
    if (!cloned.success) throw new Error("Build checkout failed; no preview was published");
    const built = await run(`bun /opt/flaregit/src/core/verification/build-preview.ts ${q(dir)} /tmp/build-out`);
    if (!built.success) throw new Error("Build failed; no preview was published");
    const ledger=projectOf(env,projectId);
    const scope=await ledger.previewStorageScope(commit,canonicalRepo);
    const manifest=await inspectPreviewStorageManifest(sb,scope);
    await publishPreviewStorageManifest(manifest,{
      prefix, bucket:env.EVIDENCE_BUCKET,
      reserve:async value=>assertPreviewStorageAdmission(await globalOf(env).reservePreviewStorage(value)),
      writer:{begin:id=>globalOf(env).reservePreviewWriter(prefix,id),beforePut:(id,path)=>globalOf(env).beginPreviewPut(prefix,id,path),settledPut:(id,path)=>globalOf(env).finishPreviewPut(prefix,id,path),finish:id=>globalOf(env).finishPreviewWriter(prefix,id)},
      authorize:async()=>{const current=await ledger.previewStorageScope(commit,canonicalRepo);if(JSON.stringify(current)!==JSON.stringify(scope))throw new Error("Preview storage owner or incarnation changed");},
      getFile:path=>sb.readFileBytes(path),
    });
  } catch(error) {
    const unfinished=(await globalOf(env).previewStorageWriterState(prefix).catch(()=>({unfinished:true}))).unfinished;
    await globalOf(env).setNativeComputeFailureReason(operationKey,unfinished?"storage_reconciliation":error instanceof PreviewStorageAdmissionError?error.reason:"build_failed");
    throw error;
  } finally {
    if (token && repo) await repo.revokeToken(token).catch(() => false);
    let stopped = false;
    try { await sb.destroy(); stopped = (await sb.lifetimeStatus())?.state === "stopped"; } catch { console.error("Preview container stop unconfirmed; build claim retained"); }
    if (stopped) await globalOf(env).finishNativeCompute(operationKey, lease);
  }
}
