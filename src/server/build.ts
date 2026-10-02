import type { Env } from "./env.js";
import { gitAuthEnv, q } from "./shell.js";

const MIME: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", svg: "image/svg+xml", json: "application/json" };

/** Bundle the application at `commit` (no contributor code is executed) and store it under builds/<commit>/ in R2. */
export async function ensureBuild(env: Env, projectId: string, commit: string, canonicalRepo: string): Promise<void> {
  if (await env.EVIDENCE_BUCKET.head(`builds/${commit}/index.html`)) return;
  // A marker stops concurrent requests from each starting a container for the same commit.
  const marker = await env.EVIDENCE_BUCKET.head(`builds/${commit}/.building`);
  if (marker && Date.now() - marker.uploaded.getTime() < 10 * 60_000) return;
  await env.EVIDENCE_BUCKET.put(`builds/${commit}/.building`, "1");

  const repo = await env.ARTIFACTS.get(canonicalRepo);
  const remote = String((await repo.info()).remote);
  const token = (await repo.createToken("read", 900)).plaintext;
  const sb = env.INTEGRATOR.getByName(`build-${projectId}`);
  const run = (cmd: string, e?: Record<string, string>) => sb.exec(["sh", "-c", cmd], { env: e });
  const dir = "/workspace/build-src";

  const cloned = await run(`rm -rf ${dir} /tmp/build-out && git clone --quiet ${q(remote)} ${dir} && git -C ${dir} checkout --quiet --detach ${q(commit)}`, gitAuthEnv(token));
  if (!cloned.success) throw new Error(`build checkout failed: ${cloned.stderr.slice(-300)}`);
  const built = await run(`cd ${dir} && ln -sfn /opt/flaregit/node_modules node_modules && bun build index.html --outdir /tmp/build-out --minify`);
  if (!built.success) throw new Error(`build failed: ${built.stderr.slice(-300)}`);
  const files = (await run("cd /tmp/build-out && find . -type f")).stdout.split("\n").filter(Boolean);
  for (const f of files) {
    const rel = f.replace(/^\.\//, "");
    const ext = rel.split(".").pop() ?? "";
    await env.EVIDENCE_BUCKET.put(`builds/${commit}/${rel}`, await sb.readFile(`/tmp/build-out/${rel}`), { httpMetadata: { contentType: MIME[ext] ?? "application/octet-stream" } });
  }
  await env.EVIDENCE_BUCKET.delete(`builds/${commit}/.building`);
  await sb.destroy();
}
