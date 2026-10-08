import {DurableObject} from "cloudflare:workers";
import {RepositoryDeployments,type AcceptedDeploymentTarget,type DeploymentReport,type DeploymentArtifact} from "../../src/server/deployments";
export class DeploymentFixture extends DurableObject{
  override async fetch(request:Request){const ledger=new RepositoryDeployments(this.ctx.storage,"repo");this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS fixture_outbox(id TEXT PRIMARY KEY,payload TEXT)");const path=new URL(request.url).pathname;try{
    if(path==="/request"){const input=await request.json() as{target:AcceptedDeploymentTarget;service:string;environment:string;key:string;actor:string;artifact?:DeploymentArtifact};return Response.json(ledger.request(input.target,input.service,input.environment,input.key,input.actor,event=>{this.ctx.storage.sql.exec("INSERT INTO fixture_outbox VALUES(?,?)",event.id,JSON.stringify(event));},undefined,input.artifact));}
    if(path==="/environment"){const input=await request.json() as{ id:string;name:string;requireApproval:boolean;revision:number};return Response.json(ledger.configureEnvironment({id:input.id,name:input.name,requireApproval:input.requireApproval},input.revision));}
    if(path==="/approve"){const input=await request.json() as{target:AcceptedDeploymentTarget;artifact:Omit<DeploymentArtifact,"approvalId">;actor:string};return Response.json({approvalId:ledger.approve(input.target,input.artifact,input.actor)});}
    if(path==="/report"){const input=await request.json() as{report:DeploymentReport;service:string};return Response.json(ledger.apply(input.report,input.service));}
    if(path==="/snapshot")return Response.json({deployments:ledger.list(),events:this.ctx.storage.sql.exec("SELECT payload FROM fixture_outbox").toArray()});
    if(path==="/fail"){this.ctx.storage.sql.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON fixture_outbox BEGIN SELECT RAISE(ABORT,'synthetic outbox failure'); END");return Response.json({ok:true});}
    if(path==="/recover"){this.ctx.storage.sql.exec("DROP TRIGGER fail_outbox");return Response.json({ok:true});}
    return new Response("Not found",{status:404});
  }catch{return new Response("Refused",{status:409});}}
}
export default{fetch:(request:Request,env:{TEST:DurableObjectNamespace<DeploymentFixture>})=>env.TEST.getByName(new URL(request.url).searchParams.get("namespace")??"repo").fetch(request)};
