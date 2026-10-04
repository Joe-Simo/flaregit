import {RepositoryController} from '../../src/server/durable-object';
import {RepositoryPreviewGenerations} from '../../src/server/preview-generations';
import {signPreview} from '../../src/server/preview-access';
import {handlePreviewAsset} from '../../src/server/preview-broker';
import {accountKeyFor} from '../../src/server/projects';
import type {Env} from '../../src/server/env';
const projectId='abcdef123456',commit='a'.repeat(40),origin='https://legacy.preview.workers.dev';
export class LegacyPreservationFixture extends RepositoryController {
 async begin(){const identity=await this.previewStorageScope(commit,'fixture-repo');return new RepositoryPreviewGenerations(this.ctx.storage).begin(identity,'owner',null,crypto.randomUUID()).record;}
 fail(generation:string){return new RepositoryPreviewGenerations(this.ctx.storage).fail(generation,'synthetic-build-failure');}
 async promote(generation:string){const ledger=new RepositoryPreviewGenerations(this.ctx.storage),identity=await this.previewStorageScope(commit,'fixture-repo');ledger.markBuilding(generation);return ledger.promote(generation,identity,'b'.repeat(64));}
 changeIncarnation(value:string){this.ctx.storage.sql.exec('UPDATE private_recovery_incarnation SET value=? WHERE id=1',value);}
}
interface FixtureEnv extends Omit<Env,'REPOSITORY_CONTROLLER'>{REPOSITORY_CONTROLLER:DurableObjectNamespace<LegacyPreservationFixture>}
export default {async fetch(request:Request,env:FixtureEnv){const url=new URL(request.url),repository=env.REPOSITORY_CONTROLLER.getByName('project:'+projectId),production=env as unknown as Env;
 if(url.pathname==='/bootstrap'){await repository.initialize({projectId,projectName:'Synthetic legacy preservation',canonicalRepoName:'fixture-repo',head:commit,ownerId:'owner',verificationPolicy:{}});const identity=await repository.previewStorageScope(commit,'fixture-repo');await env.EVIDENCE_BUCKET.put(`builds/${projectId}/${commit}/index.html`,'immutable old build');await env.EVIDENCE_BUCKET.put(`builds/${projectId}/${commit}/main.js`,'immutable old script');const {exp,sig}=await signPreview(production,projectId,commit,origin);return Response.json({incarnation:identity.incarnation,link:`${origin}/preview/${commit}/${exp}/${sig}/`});}
 if(url.pathname==='/begin')return Response.json(await repository.begin());
 if(url.pathname==='/fail')return Response.json(await repository.fail(url.searchParams.get('generation')!));
 if(url.pathname==='/promote')return Response.json(await repository.promote(url.searchParams.get('generation')!));
 if(url.pathname==='/incarnation'){await repository.changeIncarnation(url.searchParams.get('value')!);return new Response('Changed');}
 if(url.pathname==='/owner-delete'){await env.REPOSITORY_CONTROLLER.getByName('account:'+await accountKeyFor('owner')).beginAccountDeletion();return new Response('Deleted');}
 if(url.pathname==='/saved-asset')return new Response(await(await env.EVIDENCE_BUCKET.get(`builds/${projectId}/${commit}/index.html`))?.text());
 if(url.pathname==='/asset')return handlePreviewAsset(new Request(url.searchParams.get('url')!),production,projectId);
 return new Response('Not found',{status:404});
}};
