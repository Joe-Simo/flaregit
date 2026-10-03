import { signPreview } from "../../src/server/preview-access";
import type { Env } from "../../src/server/env";
export { PreviewAssetBroker, RepositoryController } from "../../src/server/worker";

// Synthetic assets in real emulator R2; no production content or credentials.
export default {
  async fetch(_request: Request, env: Env) {
    const commit = "a".repeat(40);
    const origins = JSON.parse(env.REPOSITORY_PREVIEW_ORIGINS!) as Record<string, string>;
    const links: Record<string, string> = {};
    for (const [repository, origin] of Object.entries(origins)) {
      await env.EVIDENCE_BUCKET.put(`builds/${repository}/${commit}/index.html`, `private fixture ${repository}`, { httpMetadata: { contentType: "text/html" } });
      await env.EVIDENCE_BUCKET.put(`builds/${repository}/${commit}/assets/main.js`, `export const repository = "${repository}";`, { httpMetadata: { contentType: "application/javascript" } });
      const { exp, sig } = await signPreview(env, repository, commit, origin);
      links[repository] = `${origin}/preview/${commit}/${exp}/${sig}/`;
    }
    return Response.json(links);
  },
};
