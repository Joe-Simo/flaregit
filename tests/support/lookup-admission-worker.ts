import worker from "../../src/server/worker";
import {handleGitGateway}from"../../src/server/git-gateway-handler";
import type{Env}from"../../src/server/env";
let allow=false,lookupKeys:string[]=[],actorNames:string[]=[],postAuthCalls=0;
export default{async fetch(request:Request,_env:unknown,ctx:ExecutionContext){const path=new URL(request.url).pathname;
 if(path==="/fixture/reset"){allow=false;lookupKeys=[];actorNames=[];postAuthCalls=0;return Response.json({ok:true});}
 if(path==="/fixture/allow"){allow=true;return Response.json({ok:true});}
 if(path==="/fixture/stats")return Response.json({lookupKeys,actorNames,postAuthCalls});
 const env={LOOKUP_LIMITER:{limit:async(input:{key:string})=>{lookupKeys.push(input.key);return{success:allow};}},API_LIMITER:{limit:async()=>{postAuthCalls++;return{success:true};}},REPOSITORY_CONTROLLER:{idFromName:(name:string)=>{actorNames.push(name);return name;},get:()=>{throw new Error("Unexpected owned fixture DO lookup");}},ASSETS:{fetch:async()=>new Response("Owned fixture asset")}} as unknown as Env;
 if(path==="/fixture/direct-git")return handleGitGateway(new Request("http://fixture/git/p123456789abc/canonical.git/info/refs?service=git-upload-pack",{headers:request.headers}),env,async()=>({finish:async()=>{}}));
 return worker.fetch(request,env,ctx);
}};
