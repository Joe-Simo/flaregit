import { RepositoryController } from "../../src/server/durable-object.js";
import worker from "../../src/server/worker.js";
import { accountKeyFor } from "../../src/server/projects.js";
import type { Env } from "../../src/server/env.js";

export class CommunityApiRepository extends RepositoryController {
  async seedPublic() {
    await this.initialize({projectId:"abcdef123456",projectName:"Community fixture",canonicalRepoName:"fixture",head:"a".repeat(40),verificationPolicy:{kind:"git-integrity"},ownerId:"author"});
    const at="2026-10-08T12:00:00.000Z";
    await this.createTask({id:"task-one",goal:"Synthetic comment anchor",contributor:{id:"author",name:"Same display name",type:"human"},baseCommit:"a".repeat(40),currentCommit:"c".repeat(40),allowedScope:["*"],status:"working",requirements:[],workspace:{repoName:"fixture-task-one",remote:"https://fixture.invalid/task-one",branch:"task/task-one"},checkpoints:[{id:"checkpoint-one",commitHash:"b".repeat(40),author:"Same display name",message:"Earlier checkpoint",timestamp:at,isReadyForIntegration:false,filesChanged:["src/change.ts"]}],createdAt:at,updatedAt:at},"author");
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
