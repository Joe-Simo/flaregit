import { PublicationFixture } from "./sqlite-publication-worker";
import { PrivateRecoveryOperations } from "../../src/server/private-recovery";
export class SharingOwnerFixture extends PublicationFixture {
  async ready() {
    const commit="a".repeat(40),tree="b".repeat(40),at="2026-10-03T00:00:00.000Z";
    this.ctx.storage.sql.exec("INSERT INTO project VALUES(1,?)",JSON.stringify({projectId:"abcdef123456",projectName:"Synthetic",canonicalRepoName:"synthetic",policyVersion:1,verificationPolicy:{},protectedPaths:[],decisions:{},evidence:{},acceptedBaseline:{commit,tree,acceptedAt:at},acceptedState:{currentCommit:commit,buildDigest:"synthetic",activeRequirements:[],history:[]},tasks:{},candidates:{},journal:[]}));
    await this.addMember("owner","owner");
    await this.setRepositoryVisibility("public",true,"owner");
    const ops=new PrivateRecoveryOperations(this.ctx.storage),id=crypto.randomUUID(),incarnation=ops.incarnation();
    ops.create({id,incarnation,projectId:"abcdef123456",commit,tree,journalId:"baseline",canonicalRepoName:"synthetic",ownerId:"owner",accountKey:"account",status:"ready",createdAt:at,receipt:{projectId:"abcdef123456",incarnation,commit,tree,journalId:"baseline",size:10,sha256:"c".repeat(64),objectCount:3,objectScope:"exact-accepted-reachable-closure",createdAt:at}});
    return this.publicGitSharingState("owner");
  }
}
export default { async fetch(request:Request,env:{TEST:DurableObjectNamespace<SharingOwnerFixture>;REPOSITORY_CONTROLLER:DurableObjectNamespace<SharingOwnerFixture>}) {
 const stub=env.TEST.getByName("test"),path=new URL(request.url).pathname;
 try {
  if(path==="/ready")return Response.json(await stub.ready());
  if(path==="/advance"){await stub.fixtureRecoveryHead("d".repeat(40));return Response.json(await stub.publicGitSharingState("owner"));}
  if(path==="/decide")return Response.json(await stub.decidePublicGitSharing("owner",await request.json()));
  if(path==="/outsider")return Response.json(await stub.decidePublicGitSharing("outsider",await request.json()));
  return new Response("not found",{status:404});
 }catch{return new Response("rejected",{status:409});}
} };
