import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
test('native legacy preview remains readable through replacement failure without weakening incarnation or owner fences',async()=>{
 if(await workerdChild('tests/preview-legacy-preservation.test.ts'))return;
 const build=await Bun.build({entrypoints:['tests/support/preview-legacy-preservation-worker.ts'],target:'browser',external:['cloudflare:workers','node:*']});if(!build.success)throw Error('Fixture build failed');
 const script=await build.outputs[0]!.text();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:['legacy-preservation','legacy-promotion'].map(name=>({name,modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],r2Buckets:['EVIDENCE_BUCKET'],bindings:{PREVIEW_SIGNING_KEY:'synthetic-signing-key',REPOSITORY_PREVIEW_ORIGINS:JSON.stringify({abcdef123456:'https://legacy.preview.workers.dev'})},durableObjects:{REPOSITORY_CONTROLLER:{className:'LegacyPreservationFixture',useSQLite:true}}}))}));
 try{const worker=await mf.getWorker('legacy-preservation'),call=(path:string)=>worker.fetch('http://fixture'+path);const bootstrap=await(await call('/bootstrap')).json() as {link:string;incarnation:string};const asset=(suffix='')=>call('/asset?url='+encodeURIComponent(bootstrap.link+suffix));
 expect(await(await asset()).text()).toBe('immutable old build');const operation=await(await call('/begin')).json() as {generation:string};expect(await(await asset('main.js')).text()).toBe('immutable old script');
 expect((await call('/fail?generation='+operation.generation)).status).toBe(200);expect(await(await asset()).text()).toBe('immutable old build');
 await call('/incarnation?value='+crypto.randomUUID());expect((await asset()).status).toBe(404);await call('/incarnation?value='+bootstrap.incarnation);expect((await asset()).status).toBe(200);
 expect((await call('/owner-delete')).status).toBe(200);expect((await asset()).status).toBe(404);expect(await(await call('/saved-asset')).text()).toBe('immutable old build');
 const promotedWorker=await mf.getWorker('legacy-promotion'),promotedCall=(path:string)=>promotedWorker.fetch('http://fixture'+path),promotedBootstrap=await(await promotedCall('/bootstrap')).json() as {link:string};const replacement=await(await promotedCall('/begin')).json() as {generation:string};expect((await promotedCall('/asset?url='+encodeURIComponent(promotedBootstrap.link))).status).toBe(200);expect((await promotedCall('/promote?generation='+replacement.generation)).status).toBe(200);expect((await promotedCall('/asset?url='+encodeURIComponent(promotedBootstrap.link))).status).toBe(404);expect(await(await promotedCall('/saved-asset')).text()).toBe('immutable old build');
 }finally{await mf.dispose();}
},30000);
