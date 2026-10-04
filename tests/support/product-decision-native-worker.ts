import {AcceptedTargetFixture} from './accepted-target-binding-worker';
import type {Env} from '../../src/server/env';
import type {Requirement} from '../../src/core/types';
export class ProductDecisionFixture extends AcceptedTargetFixture {
 override async fetch(request:Request){const url=new URL(request.url);try{
  if(url.pathname==='/requirements'){const input=await request.json() as {taskId:string;choice:string;output:boolean;patch?:Record<string,unknown>};const state=await this.getState(),task=state.tasks[input.taskId]!;const requirement:Requirement={id:input.choice,title:input.choice,description:'Exact conflicting behavior',version:1,status:'approved',assertions:[{id:`assert-${input.choice}`,description:'Same input, competing output',input:{tickets:1},expectedOutput:input.output}],originTaskId:task.id,approvedAt:'2026-10-04',...(input.patch?{policyPatch:input.patch}:{})};task.requirements=[requirement];this.ctx.storage.sql.exec('UPDATE project SET doc=? WHERE id=1',JSON.stringify(state));await this.getState();return Response.json({saved:true});}
  if(url.pathname==='/change-input'){const state=await this.getState();state.tasks[url.searchParams.get('id')!]!.currentCommit='d'.repeat(40);this.ctx.storage.sql.exec('UPDATE project SET doc=? WHERE id=1',JSON.stringify(state));await this.getState();return Response.json({changed:true});}
  if(url.pathname==='/resolve'){const input=await request.json() as {decisionId:string;optionId:string};return Response.json(await this.resolveDecision(input.decisionId,input.optionId,{userId:'owner',displayName:'Owner',viaToken:false},undefined,Date.now()+60000));}
  return super.fetch(request);
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Fixture failure'},{status:409});}}
}
export default {fetch(request:Request,env:Env){const url=new URL(request.url);return (env.REPOSITORY_CONTROLLER.getByName(url.searchParams.get('name')??'decision-scope') as unknown as ProductDecisionFixture).fetch(request);}};
