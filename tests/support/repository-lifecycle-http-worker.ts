import {accountKeyFor,accountOf} from '../../src/server/projects';
import worker from '../../src/server/worker';
import {RepositoryController} from '../../src/server/durable-object';
import type {Env} from '../../src/server/env';

export class RepositoryLifecycleFixture extends RepositoryController {
  async seed() {
    await this.initialize({projectId:'p123456789abc',projectName:'Lifecycle fixture',canonicalRepoName:'synthetic-only',head:'a'.repeat(40),verificationPolicy:{kind:'git-integrity'},ownerId:'owner'});
    await this.addMember('member','member');
  }
}

export default {
  async fetch(request: Request, env: Env & {FIXTURE_ISSUER: string}, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if(url.pathname==='/fixture/revoke-member'){
      await (env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as RepositoryLifecycleFixture).removeMember('member');
      return Response.json({revoked:true});
    }
    if (url.pathname === '/fixture/owner-write-token') {
      const key=await accountKeyFor('owner'),token=`fgt_${key}_${'1'.repeat(32)}`;
      await accountOf(env,key).createApiToken('owner','Synthetic scoped writer',token,{scope:'write',repo:'p123456789abc'});
      return Response.json({token});
    }
    if (url.pathname === '/fixture/seed') {
      await (env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as RepositoryLifecycleFixture).seed();
      return Response.json({seeded: true});
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
