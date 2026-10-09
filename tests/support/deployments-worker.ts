import {DurableObject} from "cloudflare:workers";
import {MembershipEpochs} from "../../src/server/membership-epochs";
import {RepositoryDeployments,type AcceptedDeploymentTarget,type DeploymentReport,type DeploymentArtifact,type DeploymentArtifactParameters} from "../../src/server/deployments";
export class DeploymentFixture extends DurableObject{
  override async fetch(request:Request){this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS members(user_id TEXT PRIMARY KEY,role TEXT NOT NULL);CREATE TABLE IF NOT EXISTS fixture_init(id INTEGER PRIMARY KEY)");if(!this.ctx.storage.sql.exec("SELECT id FROM fixture_init").toArray().length){this.ctx.storage.sql.exec("INSERT INTO members VALUES(?,?)","verified-owner","owner");this.ctx.storage.sql.exec("INSERT INTO fixture_init VALUES(1)");}const epochs=new MembershipEpochs(this.ctx.storage),ledger=new RepositoryDeployments(this.ctx.storage,"repo",actor=>this.ctx.storage.sql.exec<{role:string}>("SELECT role FROM members WHERE user_id=?",actor).toArray()[0]?.role==="owner",actor=>epochs.read(actor));this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS fixture_outbox(id TEXT PRIMARY KEY,payload TEXT)");const path=new URL(request.url).pathname;try{
    if(path==="/request"){const input=await request.json() as{target:AcceptedDeploymentTarget;service:string;environment:string;key:string;actor:string;artifact?:DeploymentArtifact;artifactSelector?:DeploymentArtifactParameters};return Response.json(ledger.request(input.target,input.service,input.environment,input.key,input.actor,event=>{this.ctx.storage.sql.exec("INSERT INTO fixture_outbox VALUES(?,?)",event.id,JSON.stringify(event));},undefined,input.artifact,input.artifactSelector));}
    if(path==="/environment"){const input=await request.json() as{ id:string;name:string;requireApproval:boolean;revision:number};return Response.json(ledger.configureEnvironment({id:input.id,name:input.name,requireApproval:input.requireApproval},input.revision));}
    if(path==="/approve"){const input=await request.json() as{target:AcceptedDeploymentTarget;artifact:Omit<DeploymentArtifact,"approvalId">;actor:string};return Response.json({approvalId:ledger.approve(input.target,input.artifact,input.actor)});}
    if(path==="/revoke"){this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id=?","verified-owner");return Response.json({ok:true});}
    if(path==="/regrant"){this.ctx.storage.sql.exec("INSERT INTO members VALUES(?,?)","verified-owner","owner");return Response.json({ok:true});}
    if(path==="/legacy-approval"){const input=await request.json() as{approvalId:string};this.ctx.storage.sql.exec("DELETE FROM deployment_approval_fences WHERE id=?",input.approvalId);return Response.json({ok:true});}
    if(path==="/dispatch"){const input=await request.json() as{deploymentId:string;eventId:string};const proof=ledger.dispatchAuthority(input.deploymentId,input.eventId);return Response.json({ok:true,actors:proof.actors});}
    if(path==="/report"){const input=await request.json() as{report:DeploymentReport;service:string};return Response.json(ledger.apply(input.report,input.service));}
    if(path==="/snapshot")return Response.json({deployments:ledger.list(),events:this.ctx.storage.sql.exec("SELECT payload FROM fixture_outbox").toArray()});
    if(path==="/fail"){this.ctx.storage.sql.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON fixture_outbox BEGIN SELECT RAISE(ABORT,'synthetic outbox failure'); END");return Response.json({ok:true});}
    if(path==="/recover"){this.ctx.storage.sql.exec("DROP TRIGGER fail_outbox");return Response.json({ok:true});}
    return new Response("Not found",{status:404});
  }catch{return new Response("Refused",{status:409});}}
}
export default{fetch:(request:Request,env:{TEST:DurableObjectNamespace<DeploymentFixture>})=>env.TEST.getByName(new URL(request.url).searchParams.get("namespace")??"repo").fetch(request)};
