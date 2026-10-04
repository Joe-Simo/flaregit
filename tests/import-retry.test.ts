import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';
test("unknown import dispatch retry preserves original operation and head after accepted history moves",async()=>{
 if(await workerdChild("tests/import-retry.test.ts"))return;
 const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"task-replay",alg:"RS256",use:"sig"};
 const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/flaregit-task-replay-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/import-retry-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
 const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"task-replay",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:"ImportRetryFixture",useSQLite:true}}}]}));
 const direct=await mf.unsafeGetDirectURL("task-replay");
 const call=(path:string,token?:string,payload?:unknown,method?:string)=>fetch(new URL(path,direct),{method:method??(payload?"POST":"GET"),headers:{Connection:"close","CF-Connecting-IP":"198.51.100.26",...(token?{Authorization:`Bearer ${token}`}:{ }),...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
 const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
 const route='/api/p/p123456789abc/import-history';
 try{await call('/fixture/seed');const owner=await session('owner');const firstResponse=await call(route,owner,{});expect(firstResponse.status).toBe(202);const first=await firstResponse.json() as {instanceId:string;head:string;status:string;workflowStatus:string;attemptGeneration:number};expect(first.status).toBe('running');expect(first.workflowStatus).toBe('unavailable');expect(first.attemptGeneration).toBe(1);
 const moved=await(await call('/fixture/move')).json() as {acceptedState:{currentCommit:string}};expect(moved.acceptedState.currentCommit).toBe('b'.repeat(40));const retryResponse=await call(route,owner,{instanceId:first.instanceId});expect(retryResponse.status).toBe(202);const retry=await retryResponse.json() as typeof first;expect(retry.instanceId).toBe(first.instanceId);expect(retry.head).toBe('a'.repeat(40));expect(retry.attemptGeneration).toBe(1);const calls=await(await call('/fixture/calls')).json() as string[];expect(calls.filter(x=>x.startsWith('create:'))).toEqual([`create:${first.instanceId}`,`create:${first.instanceId}`]);
 expect(await(await call('/fixture/dispatch')).json()).toMatchObject({id:first.instanceId,params:{expectedHead:'a'.repeat(40),attemptGeneration:1,operationId:first.instanceId}});
 expect((await call(route,owner,{instanceId:'invalid'})).status).toBe(400);const observed=await call(`${route}/${first.instanceId}`,owner);expect(observed.status).toBe(200);expect(observed.headers.get('Cache-Control')).toBe('no-store');expect(await observed.json()).toMatchObject({status:'running',workflowStatus:'unavailable',receipt:null,head:'a'.repeat(40)});
 await call('/fixture/remove-owner');expect((await call(route,owner,{instanceId:first.instanceId})).status).toBe(403);expect((await call(`${route}/${first.instanceId}`,owner)).status).toBe(403);
 }finally{await mf.dispose();issuer.stop(true);}
},30000);
