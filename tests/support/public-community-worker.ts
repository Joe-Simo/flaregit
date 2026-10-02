import { DurableObject } from "cloudflare:workers";
import { RepositoryPublicCommunity,type PublicCommunityActor,type PublicCommunityPolicy } from "../../src/server/public-community";
const actors:Record<string,PublicCommunityActor>={owner:{userId:"owner-subject",accountKey:"owner-account",displayName:"Maintainer"},author:{userId:"author-subject",accountKey:"author-account",displayName:"author@example.com"},other:{userId:"other-subject",accountKey:"other-account",displayName:"Another contributor"}};
export class CommunityFixture extends DurableObject {
  override async fetch(request:Request){
    const url=new URL(request.url),ledger=new RepositoryPublicCommunity(this.ctx.storage,"repo"),actor=actors[url.searchParams.get("actor")??"author"]!;
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS issues(id INTEGER PRIMARY KEY,body TEXT);INSERT OR IGNORE INTO issues VALUES(1,'Existing private conversation')");
    try{
      if(url.pathname==="/policy")return Response.json(ledger.policy());
      if(url.pathname==="/configure"){const body=await request.json() as {policy:PublicCommunityPolicy;confirmed:boolean};return Response.json(ledger.configure(body.policy,body.confirmed,actor,actors.owner!.userId));}
      if(url.pathname==="/list")return Response.json(ledger.listPublic());
      if(url.pathname==="/post")return Response.json(ledger.createPost(actor,await request.json() as Parameters<typeof ledger.createPost>[1]));
      if(url.pathname==="/edit"){const body=await request.json() as {id:string;title:string;body:string;expectedVersion:number};return Response.json(ledger.editPost(actor,body.id,{title:body.title,body:body.body,expectedVersion:body.expectedVersion},actors.owner!.userId));}
      if(url.pathname==="/remove"){const body=await request.json() as {id:string;expectedVersion:number};ledger.removePost(actor,body.id,actors.owner!.userId,body.expectedVersion);return Response.json({removed:true});}
      if(url.pathname==="/request")return Response.json(ledger.requestContribution(actor,await request.json() as Parameters<typeof ledger.requestContribution>[1]));
      if(url.pathname==="/requests")return Response.json(ledger.requestsFor(actor,actors.owner!.userId));
      if(url.pathname==="/decide"){const body=await request.json() as {id:string;decision:"approved"|"rejected";confirmed:boolean};return Response.json(ledger.decideRequest(actor,body.id,body.decision,body.confirmed,actors.owner!.userId));}
      return new Response("Not found",{status:404});
    }catch{return new Response("Refused",{status:409});}
  }
}
export default {fetch:(request:Request,env:{TEST:DurableObjectNamespace<CommunityFixture>})=>env.TEST.getByName("repo").fetch(request)};
