import {AcceptedTargetFixture} from './accepted-target-binding-worker';
import type {Env} from '../../src/server/env';
import type {CommittedDeploymentPin} from '../../src/server/accepted-deployment-selection';
export class AcceptedDeploymentFixture extends AcceptedTargetFixture{
 override async fetch(request:Request){const url=new URL(request.url);try{
  if(url.pathname==='/deployment-service'){const {connection}=await this.createConnection('Synthetic deployment service',['report-deployment']);await this.addWebhook('https://fixture.example.invalid/deploy',['deployment.requested']);return Response.json({id:connection.id});}
  if(url.pathname==='/deployment-target')return Response.json(await this.acceptedDeploymentTarget(url.searchParams.get('journal')!));
  if(url.pathname==='/deployment-targets')return Response.json(await this.acceptedDeploymentTargets());
  if(url.pathname==='/deployment-request'){const input=await request.json() as {journalId:string;serviceId:string;key:string;mode?:'missing'|'wrong-ref'|'wrong-tree'|'trusted'};const selected=await this.acceptedDeploymentTarget(input.journalId);if(!selected)throw Error('Accepted target unavailable');const pin:CommittedDeploymentPin={projectId:selected.selection.projectId,incarnation:selected.selection.incarnation,canonicalRepoName:selected.canonicalRepoName,ref:input.mode==='wrong-ref'?'refs/flaregit/deployments/wrong':selected.target.recoverableRef,commit:selected.target.commit,tree:input.mode==='wrong-tree'?'e'.repeat(40):selected.target.tree,verified:true};return Response.json(await this.requestDeployment(selected.target,input.serviceId,'production',input.key,'owner',input.mode==='missing'?undefined:pin));}
  if(url.pathname==='/deployment-events')return Response.json(this.ctx.storage.sql.exec<{payload:string}>("SELECT payload FROM deliveries WHERE event='deployment.requested' ORDER BY rowid").toArray().map(row=>JSON.parse(row.payload) as unknown));
  if(url.pathname==='/deployment-legacy-seed'){const input=await request.json() as {journalId:string;serviceId:string;key:string};const selected=await this.acceptedDeploymentTarget(input.journalId);if(!selected)throw Error('Primary accepted target unavailable');const {acceptedRef:_ref,acceptedRootVersion:_version,...legacy}=selected.target;const {RepositoryDeployments}=await import('../../src/server/deployments');return Response.json(new RepositoryDeployments(this.ctx.storage,(await this.getState()).projectId).request(legacy,input.serviceId,'production',input.key,'owner',()=>{}));}
  return super.fetch(request);
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Fixture failure'},{status:409});}}
}
export default{fetch(request:Request,env:Env){const url=new URL(request.url);return(env.REPOSITORY_CONTROLLER.getByName(url.searchParams.get('name')??'deployments') as unknown as AcceptedDeploymentFixture).fetch(request);}};
