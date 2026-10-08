import worker from '../../src/server/worker';
import {RepositoryController} from '../../src/server/durable-object';
import {accountOf,accountKeyFor} from '../../src/server/projects';
import type {Env} from '../../src/server/env';

export class InboxPrivacyFixture extends RepositoryController {
  async seed() {
    await this.initialize({projectId:'p123456789abc',projectName:'Lifecycle fixture',canonicalRepoName:'synthetic-only',head:'a'.repeat(40),verificationPolicy:{kind:'git-integrity'},ownerId:'owner'});
    await this.addMember('member','member');
  }
}

export default {
  async fetch(request: Request, env: Env & {FIXTURE_ISSUER: string}, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if(url.pathname==='/fixture/deliver'){
      const account=accountOf(env,await accountKeyFor('member'));
      await account.addInbox({projectId:'p123456789abc',projectName:'Private repository',kind:'activity',type:'work.changed',title:'New activity'});
      await account.addInbox({projectId:'p123456789abc',projectName:'Private repository',kind:'direct',type:'review.requested',title:'New direct request'});
      return Response.json({delivered:true});
    }
    if (url.pathname === '/fixture/revoke') {
      await (env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as InboxPrivacyFixture).removeMember('member');
      return Response.json({revoked:true});
    }
    if (url.pathname === '/fixture/seed') {
      await (env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as InboxPrivacyFixture).seed();
      const account=accountOf(env,await accountKeyFor('member'));
      await account.addInbox({projectId:'p123456789abc',projectName:'Private repository',kind:'direct',type:'review.requested',title:'Private issue title'});
      const key=await accountKeyFor('member'),readToken='fgt_'+key+'_'+'n'.repeat(32);await account.createApiToken('member','Synthetic notification token',readToken,{scope:'read',repo:'p123456789abc'});
      return Response.json({seeded: true,readToken});
    }
    return worker.fetch(request, {
      ...env,
      CLERK_ISSUER: env.FIXTURE_ISSUER,
      CLERK_AUTHORIZED_PARTIES: 'https://fixture.example',
      API_LIMITER: {limit: async () => ({success: true})},
      LOOKUP_LIMITER: {limit: async () => ({success: true})},
    } as unknown as Env, ctx);
  },
};
