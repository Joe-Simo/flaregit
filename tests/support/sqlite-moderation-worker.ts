import { PublicationFixture } from './sqlite-publication-worker';
import { PublicationModeration } from '../../src/server/publication-moderation';
export class ModerationFixture extends PublicationFixture {
  ledger(input: unknown, operator: string, fail: boolean) { return new PublicationModeration(this.ctx.storage).moderate('repository','ledger',input,operator,()=>{if(fail)throw new Error('Synthetic callback failure');}); }
  ledgerState(){const ledger=new PublicationModeration(this.ctx.storage);return {state:ledger.state('repository','ledger'),history:ledger.history('repository','ledger')};}
}
export default {async fetch(request:Request,env:{TEST:DurableObjectNamespace<ModerationFixture>}){const url=new URL(request.url);const stub=env.TEST.getByName(url.searchParams.get('name')??'test');try{
 if(url.pathname==='/seed'){await stub.seed(await request.json() as Parameters<typeof stub.seed>[0],'test-holder');await stub.addMember('owner','owner');return Response.json({ok:true});}
 if(url.pathname==='/ledger')return Response.json(await stub.ledger(await request.json(),url.searchParams.get('operator')??'exact-account',url.searchParams.get('fail')==='true'));
 if(url.pathname==='/ledger-state')return Response.json(await stub.ledgerState());
 if(url.pathname==='/repo-moderate')return Response.json(await stub.moderateRepository(await request.json(),'operator-account'));
 if(url.pathname==='/repo-public'){await stub.setRepositoryVisibility('public',true,'owner');return Response.json(await stub.visibilitySnapshot());}
 if(url.pathname==='/repo-state')return Response.json(await stub.visibilitySnapshot());
 if(url.pathname==='/profile-save'){await stub.setProfile({handle:'maintainer',displayName:'Maintainer',bio:'',joinedAt:'2026-10-02'});return Response.json(await stub.publicProfileState());}
 if(url.pathname==='/profile-public'){await stub.setPublicProfileVisibility('public',true,'owner',Number(url.searchParams.get('version')));return Response.json(await stub.publicProfileState());}
 if(url.pathname==='/profile-moderate')return Response.json(await stub.moderateProfile('owner',await request.json(),'operator-account'));
 if(url.pathname==='/profile-state')return Response.json(await stub.publicProfileState());
 return new Response('Unknown fixture route',{status:404});
 }catch(error){return Response.json({error:String(error)},{status:409});}}};
