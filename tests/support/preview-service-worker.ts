import { signPreview } from "../../src/server/preview-access";
import type { Env } from "../../src/server/env";
import { projectOf, accountOf, accountKeyFor } from "../../src/server/projects";
import { RepositoryController as ProductionRepositoryController } from "../../src/server/worker";
export { PreviewAssetBroker } from "../../src/server/worker";
export class RepositoryController extends ProductionRepositoryController {
  async fixtureExhaustPreviewReadPool(){this.ctx.storage.sql.exec("INSERT INTO preview_read_admissions VALUES(?,?,?) ON CONFLICT(month,owner_key) DO UPDATE SET attempts=?",new Date().toISOString().slice(0,7),"synthetic-exhausted-owner",100000,100000);this.ctx.storage.sql.exec("UPDATE preview_read_global_admissions SET attempts=(SELECT SUM(attempts) FROM preview_read_admissions WHERE month=?) WHERE month=?",new Date().toISOString().slice(0,7),new Date().toISOString().slice(0,7));}
  async fixturePreviewReadCount(){return this.ctx.storage.sql.exec<{total:number}>("SELECT COALESCE(SUM(attempts),0) AS total FROM preview_read_admissions").one().total;}
}

// Synthetic assets in real emulator R2; no production content or credentials.
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const repositoryId = url.searchParams.get("repository") ?? "abcdef123456";
    if (url.pathname === "/delete-repository") { await projectOf(env, repositoryId).beginRepositoryDeletion(); return new Response("sealed"); }
    if (url.pathname === "/destroy-repository") { await projectOf(env, repositoryId).destroy(); return new Response("destroyed"); }
    if (url.pathname === "/delete-account") { await accountOf(env, await accountKeyFor(`fixture-owner-${repositoryId}`)).beginAccountDeletion(); return new Response("sealed"); }
    if(url.pathname==="/exhaust-preview-reads"){await (env.REPOSITORY_CONTROLLER.get(env.REPOSITORY_CONTROLLER.idFromName("global")) as unknown as RepositoryController).fixtureExhaustPreviewReadPool();return new Response("exhausted");}
    if(url.pathname==="/core-state")return Response.json((await projectOf(env,repositoryId).getState()).acceptedState.currentCommit);
    if(url.pathname==="/preview-read-count")return Response.json(await (env.REPOSITORY_CONTROLLER.get(env.REPOSITORY_CONTROLLER.idFromName("global")) as unknown as RepositoryController).fixturePreviewReadCount());
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
