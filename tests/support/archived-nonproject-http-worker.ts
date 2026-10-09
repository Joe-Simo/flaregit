import worker from '../../src/server/worker';
import {RepositoryController} from '../../src/server/durable-object';
import type {Env} from '../../src/server/env';

export class ArchivedNonprojectFixture extends RepositoryController {
  async seed() {
    await this.initialize({projectId:'p123456789abc',projectName:'Archived non-project fixture',canonicalRepoName:'synthetic-only',head:'a'.repeat(40),verificationPolicy:{kind:'git-integrity'},ownerId:'owner'});
    await this.addMember('member','member');
    await this.repositoryLifecycleTransition('archive',1,{userId:'owner',displayName:'Owner',viaToken:false},undefined,Date.now()+60000);
  }
}

export default {
  async fetch(request: Request, env: Env & {FIXTURE_ISSUER: string}, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === '/fixture/seed') {
      await (env.REPOSITORY_CONTROLLER.getByName('project:p123456789abc') as unknown as ArchivedNonprojectFixture).seed();
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
