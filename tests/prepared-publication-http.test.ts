import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';
test('actual prepared publication HTTP returns explicit paused state and denies unauthorised intent',async()=>{
 if(await workerdChild('tests/prepared-publication-http.test.ts'))return;
 const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'replay-local',alg:'RS256',use:'sig'},issuer=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({keys:[jwk]})});
 const build=await Bun.build({entrypoints:['tests/support/prepared-publication-http-worker.ts'],target:'browser',external:['cloudflare:workers','node:*']});if(!build.success)throw Error(build.logs.map(String).join('\n'));
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'replay-http',unsafeDirectSockets:[{host:'127.0.0.1'}],modules:true,script:await build.outputs[0]!.text(),bindings:{FIXTURE_ISSUER:issuer.url.origin},compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{REPOSITORY_CONTROLLER:{className:'PreparedHttpFixture',useSQLite:true}}}]}));
 try{const direct=await mf.unsafeGetDirectURL('replay-http'),call=(path:string,token:string,body:unknown)=>fetch(new URL(path,direct),{method:'POST',headers:{Connection:'close','CF-Connecting-IP':'198.51.100.84',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)}),session=async(id:string)=>new SignJWT({azp:'https://fixture.example'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(id).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey),owner=await session('owner'),member=await session('human'),seed=await fetch(new URL('/fixture/seed',direct)),{token}=await seed.json() as {token:string},path='/api/p/p123456abcdef/candidates/candidate/prepared-publication',input={journalId:'jrnl_11111111-1111-4111-8111-111111111111',expectedCommit:'b'.repeat(40)};
 expect((await call(path,owner,{})).status).toBe(400);expect((await call(path+'?other=1',owner,input)).status).toBe(400);expect((await call(path,member,input)).status).toBe(403);expect((await call(path,token,input)).status).toBe(403);const paused=await call(path,owner,input);expect(paused.status).toBe(503);expect(await paused.text()).toContain('Your review and candidate are saved');
 }finally{await mf.dispose();issuer.stop(true);}
},30000);
