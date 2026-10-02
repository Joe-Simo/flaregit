import type { Env } from "./env.js";
import { gitAuthEnv, q } from "./shell.js";
import { buildPrefix } from "./preview-access.js";

const MIME: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", svg: "image/svg+xml", json: "application/json" };

/** Bundle the application at `commit` (no contributor code is executed) and store it under builds/<project>/<commit>/ in R2. */
export async function ensureBuild(env: Env, projectId: string, commit: string, canonicalRepo: string): Promise<void> {
  const prefix = buildPrefix(projectId, commit);
  if (await env.EVIDENCE_BUCKET.head(`${prefix}/index.html`)) return;
  // Each invocation owns its container. R2 head/put is not an atomic build lock.
  const repo = await env.ARTIFACTS.get(canonicalRepo);
  let token: string | undefined;
  const sb = env.INTEGRATOR.getByName(`build-${projectId}-${crypto.randomUUID()}`);
  const run = (cmd: string, e?: Record<string, string>) => sb.exec(["sh", "-c", cmd], { env: e });
  const dir = "/workspace/build-src";

  try {
    const remote = String((await repo.info()).remote);
    token = (await repo.createToken("read", 900)).plaintext;
    const cloned = await run(`git clone --quiet ${q(remote)} ${dir} && git -C ${dir} checkout --quiet --detach ${q(commit)}`, gitAuthEnv(token));
    if (!cloned.success) throw new Error("Build checkout failed; no preview was published");
    const built = await run(`cd ${dir} && ln -sfn /opt/flaregit/node_modules node_modules && bun build index.html --outdir /tmp/build-out --minify`);
    if (!built.success) throw new Error("Build failed; no preview was published");
    const listing = await run("cd /tmp/build-out && find . -type f");
    if (!listing.success) throw new Error("Could not inspect built assets; no preview was published");
    const files = listing.stdout.split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, ""));
    if (!files.includes("index.html")) throw new Error("Build has no index.html; no preview was published");
    // index.html is the readiness signal. Every dependent asset must be stored first.
    for (const rel of [...files.filter((f) => f !== "index.html"), "index.html"]) {
      if (rel.startsWith("/") || rel.split("/").some((part) => !part || part === ".." || part === ".")) throw new Error("Build returned an invalid asset path");
      const ext = rel.split(".").pop() ?? "";
      await env.EVIDENCE_BUCKET.put(`${prefix}/${rel}`, await sb.readFile(`/tmp/build-out/${rel}`), { httpMetadata: { contentType: MIME[ext] ?? "application/octet-stream" } });
    }
  } finally {
    if (token) await repo.revokeToken(token).catch(() => false);
    await sb.destroy().catch(() => undefined);
  }
}
