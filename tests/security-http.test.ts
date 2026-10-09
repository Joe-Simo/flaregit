import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';

test('real security HTTP routes keep reports private, enforce current revision, persist triage and reject revoked delayed import',async()=>{
 if(await workerdChild('tests/security-http.test.ts'))return;
 const keys=await generateKeyPair('RS256'),jwk={...await exportJWK(keys.publicKey),kid:'security-auth',alg:'RS256',use:'sig'},issuer=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({keys:[jwk]})});let mf:Miniflare|undefined;
 try{
 const build=await Bun.build({entrypoints:['tests/support/security-http-worker.ts'],target:'browser',external:['cloudflare:workers','node:*']});if(!build.success)throw Error(String(build.logs));
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'security-http',unsafeDirectSockets:[{host:'127.0.0.1'}],modules:true,script:await build.outputs[0]!.text(),compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:'SecurityHttpFixture',useSQLite:true}}}]}));
 const origin=await mf.unsafeGetDirectURL('security-http');
 const session=await new SignJWT({azp:'https://fixture.example'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject('owner').setIssuedAt().setExpirationTime(Math.floor(Date.now()/1000)+120).sign(keys.privateKey);
 const call=(path:string,credential?:string,method='GET',value?:unknown)=>fetch(new URL(path,origin),{method,headers:{Connection:'close',...(credential?{Authorization:`Bearer ${credential}`}:{})},...(value?{body:JSON.stringify(value)}:{})});
 expect((await call('/fixture/seed')).status).toBe(200);
 const path='/api/p/p123456789abc/security/reports';expect((await call(path)).status).toBe(401);expect((await call('/api/public/p/p123456789abc/security/reports')).status).not.toBe(200);
 const sarif={version:'2.1.0',runs:[{tool:{driver:{name:'Semgrep'}},invocations:[{executionSuccessful:true}],results:[{ruleId:'benign-fixture',message:{text:'DO_NOT_STORE_SECRET'},locations:[{physicalLocation:{artifactLocation:{uri:'src/example.ts'},region:{startLine:1}}}]}]}]};
 const input={expectedVersion:0,commit:'a'.repeat(40),tree:'b'.repeat(40),analysisKey:'semgrep/full',coverage:'Benign fixture',sarif};
 expect((await call(path,session,'POST',{...input,commit:'c'.repeat(40)})).status).toBe(409);
 const imported=await call(path,session,'POST',input);expect(imported.status).toBe(200);const state=await imported.json() as {version:number;alerts:Array<{id:string;state:string;events:unknown[]}>};expect(state.version).toBe(1);expect(JSON.stringify(state)).not.toContain('DO_NOT_STORE_SECRET');
 const id=state.alerts[0]!.id;const triaged=await call(`/api/p/p123456789abc/security/alerts/${id}`,session,'PATCH',{expectedVersion:1,state:'dismissed',reason:'Verified benign fixture'});expect(triaged.status).toBe(200);
 const stored=await(await call(path,session)).json() as typeof state;expect(stored.alerts[0]).toMatchObject({state:'dismissed'});expect(stored.alerts[0]!.events).toHaveLength(2);
 const token=await(await call('/fixture/token')).json() as {secret:string;id:string};const initial=(await(await call('/fixture/roles')).json() as {count:number}).count;
 let finish:()=>void=()=>{};const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode(' '));finish=()=>{controller.enqueue(new TextEncoder().encode(JSON.stringify({...input,expectedVersion:2})));controller.close();};}});
 const pending=fetch(new URL(path,origin),{method:'POST',headers:{Connection:'close',Authorization:`Bearer ${token.secret}`,'Content-Type':'application/json'},body:stream});
 let entered=false;for(let attempt=0;attempt<100;attempt++){if((await(await call('/fixture/roles')).json() as {count:number}).count>initial){entered=true;break;}await Bun.sleep(20);}if(!entered){finish();throw Error(`Delayed import never authorized: ${await(await pending).text()}`);}
 await call('/fixture/revoke?id='+token.id);finish();expect((await pending).status).toBe(403);expect((await(await call(path,session)).json() as typeof state).version).toBe(2);
 }finally{await mf?.dispose();issuer.stop(true);}
},30000);
