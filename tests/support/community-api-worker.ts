import { RepositoryController } from "../../src/server/durable-object.js";
import worker from "../../src/server/worker.js";
import { accountKeyFor } from "../../src/server/projects.js";
import type { Env } from "../../src/server/env.js";

export class CommunityApiRepository extends RepositoryController {
  seedPublic() {
    const state={projectId:"abcdef123456",projectName:"Community fixture",canonicalRepoName:"fixture",acceptedState:{currentCommit:"a".repeat(40),history:[]},tasks:{"task-one":{id:"task-one",baseCommit:"a".repeat(40),currentCommit:"c".repeat(40),checkpoints:[{commitHash:"b".repeat(40)}]}}};
    this.ctx.storage.sql.exec("INSERT INTO project VALUES (1,?)",JSON.stringify(state));
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS repository_visibility(id INTEGER PRIMARY KEY,visibility TEXT,version INTEGER,confirmed_by TEXT);INSERT INTO repository_visibility VALUES(1,'public',1,'owner')");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS public_community_policy(id INTEGER PRIMARY KEY,doc TEXT);INSERT INTO public_community_policy VALUES(1,?)",JSON.stringify({enabled:true,scopes:["issues"]}));
  }
}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if(new URL(request.url).pathname==="/fixture") {
      const repo=env.REPOSITORY_CONTROLLER.get(env.REPOSITORY_CONTROLLER.idFromName("project:abcdef123456")) as unknown as CommunityApiRepository;
      await repo.seedPublic();
      await repo.addMember("author","owner");
      const tokens:Record<string,string>={};
      for(const user of ["author","other"]) {
        const key=await accountKeyFor(user);
        const account=env.REPOSITORY_CONTROLLER.get(env.REPOSITORY_CONTROLLER.idFromName(`account:${key}`)) as unknown as CommunityApiRepository;
        const token=`fgt_${key}_${"x".repeat(32)}`;
        await account.createApiToken(user,"local fixture",token);
        await account.setProfile({handle:user,displayName:"Same display name",bio:"Private bio",joinedAt:new Date().toISOString()});
        tokens[user]=token;
      }
      return Response.json(tokens);
    }
    return worker.fetch(request,{...env,API_LIMITER:{limit:async()=>({success:true})}},ctx);
  },
};
