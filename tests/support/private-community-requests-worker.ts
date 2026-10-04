import { RepositoryController } from '../../src/server/durable-object';
const actor = (userId: string) => ({ userId, accountKey: `${userId}-account`, displayName: userId });
export class PrivateCommunityRequests extends RepositoryController {
 override async fetch(request: Request) {
  const path = new URL(request.url).pathname;
  try {
   if (path === '/seed') {
    await this.initialize({projectId:'abcdef123456',projectName:'Fixture',canonicalRepoName:'fixture',head:'a'.repeat(40),verificationPolicy:{},ownerId:'owner'});
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS repository_visibility(id INTEGER PRIMARY KEY,visibility TEXT,version INTEGER,confirmed_by TEXT);INSERT OR REPLACE INTO repository_visibility VALUES(1,'public',1,'owner')");
    await this.configurePublicCommunity({enabled:true,scopes:['contribution-requests']},true,actor('owner'));
    const saved = await this.requestPublicContribution(actor('contributor'),{purpose:'Contribute a documented fix',idempotencyKey:'private-history-fixture'});
    this.ctx.storage.sql.exec("UPDATE repository_visibility SET visibility='private' WHERE id=1");
    return Response.json(saved);
   }
   if(path==='/delete-fence') { this.ctx.storage.sql.exec('INSERT INTO repository_deletion VALUES(1)'); return Response.json({fenced:true}); }
   if(path==='/approve') return Response.json(await this.decidePublicContribution(actor('owner'),new URL(request.url).searchParams.get('id')!,'approved',true));
   return Response.json(await this.publicContributionRequests(actor(path.slice(1))));
  } catch(error) { return Response.json({error:error instanceof Error?error.message:'Failure'},{status:409}); }
 }
}
export default {fetch:(request:Request,env:{REPOSITORY_CONTROLLER:DurableObjectNamespace<PrivateCommunityRequests>})=>env.REPOSITORY_CONTROLLER.getByName('fixture').fetch(request)};
