import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';
test('saved rebase resume HTTP preserves one dispatch identity and rejects revoked admission without providers',async()=>{
 if(await workerdChild('tests/rebase-resume-http.test.ts'))return;
 const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'resume-test',alg:'RS256',use:'sig'};
 const issuer=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/resume-http-${crypto.randomUUID()}.js`,build=Bun.spawn([process.execPath,'build','tests/support/rebase-resume-http-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*',`--outfile=${file}`],{stdout:'ignore',stderr:'pipe'});
 const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code)throw Error(error);
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'resume-http',unsafeDirectSockets:[{host:'127.0.0.1'}],modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:'RebaseResumeHttpFixture',useSQLite:true}}}]}));
 const direct=await mf.unsafeGetDirectURL('resume-http');
 const call=(path:string,token?:string,body?:unknown)=>fetch(new URL(path,direct),{method:body?'POST':'GET',headers:{Connection:'close','CF-Connecting-IP':'198.51.100.31',...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const session=(who:string)=>new SignJWT({azp:'https://fixture.example'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(who).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
 const route='/api/p/p123456789abc/rebase-applications';
 const safe=(text:string)=>{for(const hidden of ['credentialHash','actorId','userId','accountKey','original-actor','old-workflow','synthetic-server','sessionExpiresAt','requestId','nativeRunId'])expect(text).not.toContain(hidden);};
 try{
 const seed=await call('/fixture/seed');if(!seed.ok)throw Error(await seed.text());
 const seeded=await seed.json() as {id:string;writeToken:string;fullToken:string},owner=await session('owner'),member=await session('member'),endpoint=`${route}/${seeded.id}/resume`;
 const list=await call(route,owner);expect(list.status).toBe(200);const listText=await list.text();safe(listText);const version=(JSON.parse(listText) as {applications:Array<{version:number}>}).applications[0]!.version;
 const request={expectedVersion:version,idempotencyKey:crypto.randomUUID()};
 expect((await call(endpoint,undefined,request)).status).toBe(401);expect((await call(endpoint,member,request)).status).toBe(403);expect((await call(endpoint,seeded.writeToken,request)).status).toBe(403);
 expect((await call(endpoint,owner,{...request,extra:true})).status).toBe(400);expect((await call(endpoint,owner,{...request,idempotencyKey:'bad'})).status).toBe(400);
 expect(await(await call('/fixture/calls')).json() as {calls:string[];dispatches:unknown[]}).toEqual({calls:[],dispatches:[]});
 const before=await(await call('/fixture/snapshot')).json() as Record<string,unknown>;
 for(const value of ['race-role','race-account','race-project','race-token']){
 await call(`/fixture/mode?value=${value}`);const denied=await call(endpoint,value==='race-token'?seeded.fullToken:owner,{expectedVersion:version,idempotencyKey:crypto.randomUUID()});expect(denied.status).toBeGreaterThanOrEqual(400);
 expect(await(await call('/fixture/calls')).json() as {calls:string[];dispatches:unknown[]}).toEqual({calls:[],dispatches:[]});expect(await(await call('/fixture/snapshot')).json() as Record<string,unknown>).toEqual(before);
 const restored=await call('/fixture/restore');if(!restored.ok)throw Error(await restored.text());
 }
 await call('/fixture/mode?value=lost-dispatch');
 const uncertain=await call(endpoint,owner,request);expect(uncertain.status).toBe(202);expect(uncertain.headers.get('Cache-Control')).toBe('no-store');const uncertainText=await uncertain.text();safe(uncertainText);const attempt=JSON.parse(uncertainText) as {id:string;dispatch:string;generation:number};expect(attempt.dispatch).toBe('unknown');
 const retry=await call(endpoint,owner,request);expect(retry.status).toBe(202);expect(await retry.json() as typeof attempt).toEqual(attempt);
 const observedCalls=await(await call('/fixture/calls')).json() as {calls:string[];dispatches:Array<{id:string;params:{projectId:string;attemptId:string;generation:number};retention:{successRetention:string;errorRetention:string}}>};expect(observedCalls.calls).toEqual([]);expect(observedCalls.dispatches).toHaveLength(2);expect(observedCalls.dispatches[0]).toEqual(observedCalls.dispatches[1]);expect(observedCalls.dispatches[0]).toEqual({id:`rebase-resume-${attempt.id}`,params:{projectId:'p123456789abc',attemptId:attempt.id,generation:attempt.generation},retention:{successRetention:'3 days',errorRetention:'3 days'}});
 expect((await call(endpoint,owner,{...request,expectedVersion:version+1})).status).toBe(409);
 expect((await call(endpoint,owner,{...request,idempotencyKey:crypto.randomUUID()})).status).toBe(409);
 // Full access tokens authorize the same workflow; credentials stay in server rows only.
 await call('/fixture/mode?value=normal');const tokenRetry=await call(endpoint,seeded.fullToken,request);expect(tokenRetry.status).toBe(409); // same request key cannot change its actor transport
 const status=await call(endpoint,seeded.fullToken);expect(status.status).toBe(200);safe(await status.text());const statusList=await call(route,owner);safe(await statusList.text());
 const snapshot=await(await call('/fixture/snapshot')).json() as {attempts:Array<{doc:string}>;task:unknown;accepted:unknown;application:unknown};expect(snapshot.attempts).toHaveLength(1);const stored=JSON.parse(snapshot.attempts[0]!.doc) as {actor:{userId:string};application:{input:{actorId:string}}};expect(stored.actor.userId).toBe('owner');expect(stored.application.input.actorId).toBe('original-actor');for(const field of ['task','accepted','application'] as const)expect(snapshot[field]).toEqual((before as typeof snapshot)[field]);
 const second=await(await call('/fixture/second')).json() as {id:string};const full=await call(`${route}/${second.id}/resume`,seeded.fullToken,{expectedVersion:0,idempotencyKey:crypto.randomUUID()});expect(full.status).toBe(202);safe(await full.text());
 }finally{await mf.dispose();issuer.stop(true);}
},30000);
