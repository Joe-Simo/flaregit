import { DurableObject } from "cloudflare:workers";
import worker from "../../src/server/worker";
import type { Env } from "../../src/server/env";
export class PublicProfileFixture extends DurableObject {
  override async fetch(request: Request) {
    const url=new URL(request.url);
    if(url.pathname==="/mode"){await this.ctx.storage.put("mode",url.searchParams.get("value"));return Response.json({ok:true});}
    const mode=await this.ctx.storage.get("mode")??"private";let reads=0;
    const env={
      API_LIMITER:{limit:async()=>({success:true})},
      REPOSITORY_CONTROLLER:{idFromName:(name:string)=>name,get:(name:string)=>name==="global"?{accountForHandle:async()=>"account"}:name.startsWith("account:")?{
        publicProfileState:async()=>{reads++;return {profile:{handle:"contributor",displayName:"Contributor",bio:"Public bio",joinedAt:"2026-10-02"},visibility:mode==="private"||(mode==="revoke"&&reads>1)?"private":"public",version:1,ownerId:"private-user-id"};},
        listProjects:async()=>[{id:"abcdef123456"},{id:"abcdef123457"}],
      }:{publicGrant:async()=>name==="project:abcdef123456"?{name:"Public repo",version:1,acceptedCommit:"a".repeat(40)}:null,roleOf:async()=>"contributor",listMembers:async()=>[{user_id:"private-user-id"}],getState:async()=>({tasks:{task:{id:"task",goal:"PRIVATE TASK GOAL",contributor:{type:"human",id:"private-user-id".slice(-12)}}},acceptedState:{history:[{commit:"a".repeat(40),acceptedAt:"2026-10-02",participatingTasks:["task"]}]}})}},
    } as unknown as Env;
    return worker.fetch(request,env,this.ctx as unknown as ExecutionContext);
  }
}
export default {fetch:(request:Request,env:{TEST:DurableObjectNamespace<PublicProfileFixture>})=>env.TEST.getByName("one").fetch(request)};
