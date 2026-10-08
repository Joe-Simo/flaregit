import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';

test('production metadata routes reject credentials revoked or expired while parsing delayed bodies',async()=>{
 if(await workerdChild('tests/metadata-auth-http.test.ts'))return;
 const keys=await generateKeyPair('RS256'),jwk={...await exportJWK(keys.publicKey),kid:'metadata-auth',alg:'RS256',use:'sig'},issuer=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({keys:[jwk]})});let mf:Miniflare|undefined;
 try{
 const build=await Bun.build({entrypoints:['tests/support/metadata-auth-http-worker.ts'],target:'browser',external:['cloudflare:workers','node:*']});if(!build.success)throw Error(String(build.logs));
 mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'metadata-auth',unsafeDirectSockets:[{host:'127.0.0.1'}],modules:true,script:await build.outputs[0]!.text(),compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:'MetadataAuthFixture',useSQLite:true}}}]}));
 const origin=await mf.unsafeGetDirectURL('metadata-auth');const call=(path:string,credential?:string)=>fetch(new URL(path,origin),{headers:{Connection:'close',...(credential?{Authorization:`Bearer ${credential}`}:{})}});
 expect((await call('/fixture/seed')).status).toBe(200);
 const session=(expiry:number)=>new SignJWT({azp:'https://fixture.example'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject('owner').setIssuedAt().setExpirationTime(expiry).sign(keys.privateKey);
 const delayed=async(path:string,method:string,credential:string,value:unknown,change:()=>Promise<void>)=>{
  const initial=(await(await call('/fixture/roles')).json() as {count:number}).count;
  let finish:()=>void=()=>{};const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode(' '));finish=()=>{controller.enqueue(new TextEncoder().encode(JSON.stringify(value)));controller.close();};}});
  const pending=fetch(new URL(path,origin),{method,headers:{Connection:'close',Authorization:`Bearer ${credential}`,'Content-Type':'application/json','CF-Connecting-IP':'198.51.100.21'},body:stream});
  let entered=false;for(let attempt=0;attempt<100;attempt++){if((await(await call('/fixture/roles')).json() as {count:number}).count>initial){entered=true;break;}await Bun.sleep(20);}
  if(!entered){finish();throw Error(`Request did not reach initial repository authorization: ${await(await pending).text()}`);}
  await change();finish();const response=await pending;expect(response.status).toBe(403);return response;
 };
 for(const [path,method,value] of [
  ['/api/p/p123456789abc/planning','POST',{operation:'configure',expectedVersion:0,statuses:['Todo','Done'],fieldTypes:{}}],
  ['/api/p/p123456789abc/wiki/readme','PUT',{body:'Must not save',expectedRevision:null}],
  ['/api/p/p123456789abc/wiki/readme/revert','POST',{toRevision:1,expectedRevision:1}],
 ] as const){const token=await(await call('/fixture/token')).json() as {secret:string;id:string};await delayed(path,method,token.secret,value,async()=>{await call('/fixture/revoke?id='+token.id);});}
 const expires=Math.floor(Date.now()/1000)+2,credential=await session(expires);
 await delayed('/api/p/p123456789abc/metadata-archive','POST',credential,{archive:{},sha256:'0'.repeat(64),requestId:crypto.randomUUID(),confirmed:true},async()=>{await Bun.sleep(Math.max(0,expires*1000-Date.now()+30));});
 const active=await session(Math.floor(Date.now()/1000)+60);const wiki=await call('/api/p/p123456789abc/wiki/readme',active);expect(wiki.status).toBe(404);const plan=await(await call('/api/p/p123456789abc/planning',active)).json() as {version:number};expect(plan.version).toBe(0);
 }finally{await mf?.dispose();issuer.stop(true);}
},30000);
