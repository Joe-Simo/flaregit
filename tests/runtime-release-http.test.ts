import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test,expect} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
import type {RepositoryController} from '../src/server/durable-object';

test('actual runtime HTTP release metadata honors stored token authentication and account lifecycle without repository scope fencing',async()=>{
 if(await workerdChild('tests/runtime-release-http.test.ts'))return;
 const output=join(tmpdir(),`runtime-release-http-${crypto.randomUUID()}.js`),build=Bun.spawn([process.execPath,'build','tests/support/scoped-public-token-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*',`--outfile=${output}`],{stdout:'ignore',stderr:'pipe'});let script:string;try{const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code)throw Error(error);script=await Bun.file(output).text();}finally{if(await Bun.file(output).exists())await Bun.file(output).delete();}
 const workerVersion=crypto.randomUUID(),sourceVersion='a'.repeat(40),metadataTag='private-metadata-tag-must-not-appear';
 const mf=new Miniflare(convertV4MiniflareOptions({workers:['identified','unset'].map(kind=>({name:`runtime-${kind}`,modules:true,script,compatibilityDate:'2026-10-04',compatibilityFlags:['nodejs_compat'],unsafeDirectSockets:[{host:'127.0.0.1'}],bindings:{CLERK_ISSUER:'https://local-auth.invalid',CLERK_AUTHORIZED_PARTIES:'https://local-fixture.invalid',...(kind==='identified'?{CF_VERSION_METADATA:{id:workerVersion,tag:metadataTag,timestamp:'private-binding-timestamp'},FLAREGIT_SOURCE_VERSION:sourceVersion}:{})},durableObjects:{REPOSITORY_CONTROLLER:{className:'ScopedAccountFixture',useSQLite:true}}}))}));
 try{for(const kind of ['identified','unset']){const name=`runtime-${kind}`,base=await mf.unsafeGetDirectURL(name),call=async(path:string,method='GET',token?:string,pin?:Record<string,string>)=>{const response=await fetch(new URL(path,base),{method,headers:{Connection:'close',...pin,...(token?{Authorization:`Bearer ${token}`}:{})}}),body=await response.text();return{status:response.status,headers:response.headers,body};};
 const tokens=JSON.parse((await call('/fixture')).body) as Record<string,string>;const full=tokens.full;if(!full)throw Error('Stored full token fixture missing');const accountKey=full.split('_')[1];if(!accountKey)throw Error('Stored account key missing');const namespace=await mf.getDurableObjectNamespace('REPOSITORY_CONTROLLER',name),account=namespace.get(namespace.idFromName(`account:${accountKey}`)) as unknown as Pick<RepositoryController,'createApiToken'>,readAll=`fgt_${accountKey}_${'r'.repeat(32)}`;await account.createApiToken('scoped-user','runtime-read-all',readAll,{scope:'read'});
 expect((await call('/api/runtime')).status).toBe(401);for(const token of [tokens.pinned,full,readAll]){if(!token)throw Error('Required stored token missing');const release=await call('/api/runtime','GET',token);expect(release.status).toBe(200);expect(JSON.parse(release.body)).toEqual(kind==='identified'?{workerVersion,sourceVersion,releaseIdentified:true}:{workerVersion:null,sourceVersion:null,releaseIdentified:false});expect(release.headers.get('Cache-Control')).toBe('no-store');expect(release.headers.get('X-Content-Type-Options')).toBe('nosniff');expect(release.body).not.toContain(metadataTag);expect(release.body).not.toContain('private-binding-timestamp');expect(release.body).not.toContain(token);expect(release.body).not.toContain('fgt_');expect((await call('/api/runtime','POST',token)).status).toBe(405);}
 const correctPin={'X-FlareGit-Expected-Worker-Version':workerVersion,'X-FlareGit-Expected-Source-Version':sourceVersion};
 expect((await call('/api/runtime','GET',full,correctPin)).status).toBe(kind==='identified'?200:409);
 expect((await call('/api/account','DELETE',full,{...correctPin,'X-FlareGit-Expected-Source-Version':'b'.repeat(40)})).status).toBe(409);
 expect((await call('/api/runtime','GET',full)).status).toBe(200);
 expect((await call('/deleting')).status).toBe(200);expect((await call('/api/runtime','GET',full)).status).toBe(403);expect((await call('/api/runtime','GET',tokens.pinned)).status).toBe(403);
 }}finally{await mf.dispose();}
},30000);
