import {WorkflowEntrypoint,type WorkflowEvent,type WorkflowStep} from "cloudflare:workers";
import {accountKeyFor} from "../../src/server/projects";
import {RepositoryController} from "../../src/server/durable-object";
import {handleQueueBatch} from "../../src/server/queue";
import type {Env,QueueMessage} from "../../src/server/env";
import type {IntegrationParams} from "../../src/server/workflow";
const projectId="p123456789abc";
let unavailable=false,lostAck=true,creates=0;
export class QueueReplayLedger extends RepositoryController{
 async seed(){await this.initialize({projectId,projectName:"Synthetic queue replay",canonicalRepoName:"fixture",head:"a".repeat(40),verificationPolicy:{},ownerId:"owner"});await this.addMember("initiator","member");for(const id of ["change-one","change-two"])await this.createTask({id,goal:"Synthetic execution only",contributor:{id:"owner",name:"Fixture",type:"human"},baseCommit:"a".repeat(40),currentCommit:"a".repeat(40),allowedScope:[],status:"ready",requirements:[],workspace:{repoName:"fixture",remote:"https://fixture.invalid",branch:`task/${id}`},checkpoints:[],createdAt:"2026-10-03",updatedAt:"2026-10-03"},"owner");for(const id of ["queue-lost-ack","queue-unavailable","queue-retired","queue-withdrawn","queue-sealed"])await this.registerWorkflow(id,"integration",undefined,"initiator");this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS fixture_executions(id TEXT PRIMARY KEY,executions INTEGER NOT NULL,simulated_models INTEGER NOT NULL,simulated_vms INTEGER NOT NULL)");}
 countExecution(id:string){this.ctx.storage.sql.exec("INSERT INTO fixture_executions VALUES(?,1,1,1) ON CONFLICT(id) DO UPDATE SET executions=executions+1,simulated_models=simulated_models+1,simulated_vms=simulated_vms+1",id);}
 stats(){return this.ctx.storage.sql.exec("SELECT * FROM fixture_executions ORDER BY id").toArray();}
}
/** Real emulator Workflow; downstream model and VM counters are explicitly synthetic. */
export class QueueReplayWorkflow extends WorkflowEntrypoint<Env,IntegrationParams>{override async run(event:WorkflowEvent<IntegrationParams>,step:WorkflowStep){const ledger=this.env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`) as unknown as QueueReplayLedger;await step.do("synthetic-execution",async()=>{await ledger.recordIntegrationDispatchOutcome(event.instanceId,"started");await ledger.countExecution(event.instanceId);});await step.waitForEvent("release-fixture",{type:"release",timeout:"1 minute"});await step.do("saved-terminal",async()=>ledger.recordIntegrationDispatchOutcome(event.instanceId,"completed"));return{synthetic:true};}}
type TestEnv=Omit<Env,"REPOSITORY_CONTROLLER">&{REPOSITORY_CONTROLLER:DurableObjectNamespace<QueueReplayLedger>};
export default{async fetch(request:Request,env:TestEnv){const url=new URL(request.url),ledger=env.REPOSITORY_CONTROLLER.getByName(`project:${projectId}`);
 if(url.pathname==="/seed"){await ledger.seed();return new Response("ok");}
 if(url.pathname==="/unavailable"){unavailable=url.searchParams.get("value")==="true";return new Response("ok");}
 if(url.pathname==="/stats")return Response.json({creates,rows:await ledger.stats()});
 if(url.pathname==="/admit-withdrawn"){await ledger.admitIntegrationDispatch("queue-withdrawn",["change-one"]);await ledger.removeMember("initiator");return new Response("ok");}
 if(url.pathname==="/restore-owner"){await ledger.addMember("initiator","member");return new Response("ok");}
 if(url.pathname==="/seal"){await ledger.admitIntegrationDispatch("queue-sealed",["change-one"]);await (env.REPOSITORY_CONTROLLER.getByName(`account:${await accountKeyFor("initiator")}`)).beginAccountDeletion();return new Response("ok");}
 if(url.pathname==="/delete-repository"){await ledger.beginRepositoryDeletion();return new Response("ok");}
 if(url.pathname==="/terminal"){await ledger.admitIntegrationDispatch("queue-retired",["change-one"]);await ledger.recordIntegrationDispatchOutcome("queue-retired","completed");return new Response("ok");}
 if(url.pathname==="/status")return Response.json(await(await env.INTEGRATION_WORKFLOW.get("queue-lost-ack")).status());
 if(url.pathname==="/release"){await(await env.INTEGRATION_WORKFLOW.get("queue-lost-ack")).sendEvent({type:"release",payload:{}});return new Response("ok");}
 if(url.pathname==="/provider-delete"){await(await env.INTEGRATION_WORKFLOW.get("queue-lost-ack")).delete();return new Response("ok");}
 if(url.pathname==="/deliver"){const body=await request.json() as QueueMessage;let ack=0,retry=0;const workflow={createBatch:async(options:WorkflowInstanceCreateOptions<IntegrationParams>[])=>{creates++;if(unavailable)throw new Error("Synthetic provider unavailable");const result=await env.INTEGRATION_WORKFLOW.createBatch(options);if(lostAck){lostAck=false;throw new Error("Synthetic acknowledgment lost after creation");}return result;}};await handleQueueBatch({messages:[{body,ack:()=>{ack++;},retry:()=>{retry++;}}]} as unknown as MessageBatch<QueueMessage>,{...env,INTEGRATION_WORKFLOW:workflow} as unknown as Env);return Response.json({ack,retry});}
 return new Response("missing",{status:404});
}};
