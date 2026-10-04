import {test,expect,mock} from "bun:test";
import type {Env} from "../src/server/env.js";
import type {Ledger,WorkflowOutcome} from "../src/server/durable-object.js";
import type {WorkflowStep,WorkflowEvent} from "cloudflare:workers";
import {accountKeyFor} from "../src/server/projects.js";
mock.module("cloudflare:workers",()=>({WorkflowEntrypoint:class{constructor(_ctx:unknown,public env:Env){}},DurableObject:class{}}));
const {FlareGitIntegrationWorkflow}=await import("../src/server/workflow.js");
test.each(["budget","actor-revoked","mirror-lookup"])("whole Workflow keeps accepted outcome when optional %s work fails",async(mode)=>{
 // Local control-flow fixture; the companion native test executes real journal/SQLite transitions.
 const commit="b".repeat(40),actorId="actor",accountKey=await accountKeyFor(actorId);
 let head="a".repeat(40),journal="PREPARED",active=true,vmCalls=0;
 const outcomes:WorkflowOutcome[]=[],activities:string[]=[],mirror:string[]=[];
 const candidate={id:"candidate",participatingTaskIds:["parent"],participatingCommits:{parent:"c".repeat(40)},expectedAcceptedBase:head};
 const ledger={admitIntegrationDispatch:async()=>({terminal:false,actorId}),recordIntegrationDispatchOutcome:async(_id:string,status:WorkflowOutcome)=>{outcomes.push(status);},claimLanding:async()=>({candidate}),awaitReview:async()=>{},preparePublish:async()=>({ok:true,journal:{id:"journal"}}),completePublish:async()=>{head=commit;journal="ACCEPTED";if(mode==="actor-revoked")active=false;},getState:async()=>({acceptedState:{currentCommit:head},tasks:{parent:{id:"parent",status:"accepted",currentCommit:"c".repeat(40)},child:{id:"child",status:"working",dependsOn:"parent",currentCommit:"d".repeat(40),workspace:{repoName:"saved-child"}}}}),getWorkflowRun:async()=>({actorId}),roleOf:async()=>active?"owner":null,mirrorSecret:async()=>{if(mode==="mirror-lookup")throw new Error("Synthetic mirror settings unavailable");return{target:"owner/repo",token:"synthetic-only"};},recordMirrorRun:async(_commit:string,status:string)=>{mirror.push(status);},logActivity:async(_actor:string,type:string)=>{activities.push(type);}} as unknown as Ledger;
 const env={REPOSITORY_CONTROLLER:{idFromName:(name:string)=>name,get:(name:string)=>name.startsWith("project:")?ledger:name.startsWith("account:")?{accountLifecycle:async()=>"active"}:{reserveManagedSpend:async()=>({allowed:false,reason:"global_budget"}),recordWorkflowOutcome:async()=>{}}},INTEGRATOR:{getByName:()=>{vmCalls++;throw new Error("Fixture VM must not start");}}} as unknown as Env;
 const workflow=new FlareGitIntegrationWorkflow({} as ExecutionContext,env);
 Object.assign(workflow,{composeRepairVerify:async()=>({ok:true,commit,evidenceId:"proof",branch:"main"}),casPush:async()=>({ok:true})});
 const step={do:async(_name:string,options:unknown,callback?:()=>Promise<unknown>)=>{const fn=callback??options;if(typeof fn!=="function")throw new Error("Invalid fixture step");return fn();},waitForEvent:async()=>({payload:{approved:true,by:actorId}})} as unknown as WorkflowStep;
 const result=await workflow.run({instanceId:"workflow",payload:{projectId:"p123456789abc",taskIds:["parent"],accountKey}} as WorkflowEvent<{projectId:string;taskIds:string[];accountKey:string}>,step);
 expect(result.status).toBe("accepted");expect(head).toBe(commit);expect(journal).toBe("ACCEPTED");expect(outcomes).toEqual(["started","awaiting_review","accepted","accepted"]);expect(vmCalls).toBe(0);expect(activities).toContain("stack.rebase_deferred");expect(mirror).toEqual(["deferred"]);
});

test("thrown integration reconciles only its active candidate before recording failure",async()=>{
 const outcomes:string[]=[],aborted:Array<{id:string;reason:string}>=[];
 const candidates={own:{id:"own",workflowInstanceId:"workflow",status:"composing"},other:{id:"other",workflowInstanceId:"other-workflow",status:"composing"},accepted:{id:"accepted",workflowInstanceId:"workflow",status:"accepted"},stale:{id:"stale",workflowInstanceId:"workflow",status:"stale"}};
 const ledger={admitIntegrationDispatch:async()=>({terminal:false,actorId:"actor"}),recordIntegrationDispatchOutcome:async(_id:string,status:string)=>{outcomes.push(status);},getState:async()=>({candidates}),abortPublish:async(id:string,_journal:undefined,reason:string)=>{aborted.push({id,reason});outcomes.push("candidate-failed");}} as unknown as Ledger;
 const env={REPOSITORY_CONTROLLER:{idFromName:(name:string)=>name,get:(name:string)=>name.startsWith("project:")?ledger:{recordWorkflowOutcome:async()=>{}}}} as unknown as Env;
 const workflow=new FlareGitIntegrationWorkflow({} as ExecutionContext,env);
 Object.assign(workflow,{execute:async()=>{throw new Error("sensitive-provider-detail");}});
 const step={do:async(_name:string,callback:()=>Promise<unknown>)=>callback()} as unknown as WorkflowStep;
 await expect(workflow.run({instanceId:"workflow",payload:{projectId:"p123456789abc",taskIds:["change"]}} as WorkflowEvent<{projectId:string;taskIds:string[]}>,step)).rejects.toThrow("sensitive-provider-detail");
 expect(aborted.map(item=>item.id)).toEqual(["own"]);
 expect(aborted[0]!.reason).not.toContain("sensitive-provider-detail");
 expect(outcomes).toEqual(["started","candidate-failed","failed"]);
});
