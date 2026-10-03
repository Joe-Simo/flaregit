import { orderedPreviewAssets } from "./preview-assets.js";
import { globalOf } from "./projects.js";
import { admitNativeCompute, claimNativeCompute } from "./native-compute.js";
import type { Env } from "./env.js";
import { gitAuthEnv, q } from "./shell.js";
import { buildPrefix } from "./preview-access.js";

const MIME: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", svg: "image/svg+xml", json: "application/json", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf" };

/** Build the exact commit in a disposable unprivileged snapshot, then store its preview assets. */
export async function ensureBuild(env: Env, projectId: string, commit: string, canonicalRepo: string, accountKey: string): Promise<void> {
  const prefix = buildPrefix(projectId, commit);
  if (await env.EVIDENCE_BUCKET.head(`${prefix}/index.html`)) return;
  const operationKey = `build-${projectId}-${commit}`;
  if(await globalOf(env).nativeComputeFailure(operationKey))throw new Error("Preview build failed; owner retry is required");
  const lease = await claimNativeCompute(env, operationKey);
  if (!lease) return;
  try { await admitNativeCompute(env, accountKey, `native-${lease}`); }
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
    const listing = await run("cd /tmp/build-out && find . -type f");
    if (!listing.success) throw new Error("Could not inspect built assets; no preview was published");
    const files = orderedPreviewAssets(listing.stdout);
    for (const rel of files) {
      const ext = rel.split(".").pop() ?? "";
      await env.EVIDENCE_BUCKET.put(`${prefix}/${rel}`, await sb.readFileBytes(`/tmp/build-out/${rel}`), { httpMetadata: { contentType: MIME[ext] ?? "application/octet-stream" } });
    }
  } catch(error) {
    await globalOf(env).setNativeComputeFailure(operationKey,true);
    throw error;
  } finally {
    if (token && repo) await repo.revokeToken(token).catch(() => false);
    let stopped = false;
    try { await sb.destroy(); stopped = true; } catch { console.error("Preview container stop unconfirmed; build claim retained"); }
    if (stopped) await globalOf(env).finishNativeCompute(operationKey, lease);
  }
}
