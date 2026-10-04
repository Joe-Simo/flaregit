import { signPreview } from "../../src/server/preview-access";
import type { Env } from "../../src/server/env";
import { projectOf, accountOf, accountKeyFor } from "../../src/server/projects";
export { PreviewAssetBroker, RepositoryController } from "../../src/server/worker";

// Synthetic assets in real emulator R2; no production content or credentials.
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const repositoryId = url.searchParams.get("repository") ?? "abcdef123456";
    if (url.pathname === "/delete-repository") { await projectOf(env, repositoryId).beginRepositoryDeletion(); return new Response("sealed"); }
    if (url.pathname === "/destroy-repository") { await projectOf(env, repositoryId).destroy(); return new Response("destroyed"); }
    if (url.pathname === "/delete-account") { await accountOf(env, await accountKeyFor(`fixture-owner-${repositoryId}`)).beginAccountDeletion(); return new Response("sealed"); }
    const commit = "a".repeat(40);
    const origins = JSON.parse(env.REPOSITORY_PREVIEW_ORIGINS!) as Record<string, string>;
    const links: Record<string, string> = {};
    for (const [repository, origin] of Object.entries(origins)) {
      await projectOf(env, repository).initialize({projectId:repository,projectName:"Synthetic preview fixture",canonicalRepoName:`flaregit-${repository}`,head:commit,verificationPolicy:{},ownerId:`fixture-owner-${repository}`});
      await env.EVIDENCE_BUCKET.put(`builds/${repository}/${commit}/index.html`, `private fixture ${repository}`, { httpMetadata: { contentType: "text/html" } });
      await env.EVIDENCE_BUCKET.put(`builds/${repository}/${commit}/assets/main.js`, `export const repository = "${repository}";`, { httpMetadata: { contentType: "application/javascript" } });
      const { exp, sig } = await signPreview(env, repository, commit, origin);
      links[repository] = `${origin}/preview/${commit}/${exp}/${sig}/`;
    }
    return Response.json(links);
  },
};
