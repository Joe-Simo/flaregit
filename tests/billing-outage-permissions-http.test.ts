import {expect,test} from 'bun:test';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
test('optional account billing outage does not block authorized repository read/review or grant denied access',async()=>{
 if(await workerdChild('tests/billing-outage-permissions-http.test.ts'))return;
 const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'billing-outage',alg:'RS256',use:'sig'},issuer=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({keys:[jwk]})});
 const build=await Bun.build({entrypoints:['tests/support/billing-outage-permissions-worker.ts'],target:'browser',external:['cloudflare:workers','node:*']});if(!build.success){issuer.stop(true);throw Error(build.logs.join('\n'));}
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'billing-outage',unsafeDirectSockets:[{host:'127.0.0.1'}],modules:true,script:await build.outputs[0]!.text(),compatibilityDate:'2026-10-04',compatibilityFlags:['nodejs_compat'],bindings:{FIXTURE_ISSUER:issuer.url.origin,CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS:'2000000',CORE_GIT_GLOBAL_MONTHLY_USD_MICROS:'2000000',REPOSITORY_READ_ACCOUNT_MONTHLY_USD_MICROS:'1000000',REPOSITORY_READ_GLOBAL_MONTHLY_USD_MICROS:'1000000'},durableObjects:{REPOSITORY_CONTROLLER:{className:'BillingOutageFixture',useSQLite:true}}}]}));
 try{const direct=await mf.unsafeGetDirectURL('billing-outage'),call=(path:string,token?:string,body?:unknown)=>fetch(new URL(path,direct),{method:body?'POST':'GET',headers:{Connection:'close','CF-Connecting-IP':'198.51.100.27',...(token?{Authorization:`Bearer ${token}`}:{ }),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}),session=(user:string)=>new SignJWT({azp:'https://fixture.example'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(user).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
  expect((await call('/fixture/bootstrap')).status).toBe(200);const owner=await session('owner'),member=await session('member'),outsider=await session('outsider');
  expect((await call('/api/billing',owner)).status).toBe(500);expect(await(await call('/fixture/billing-count')).json() as number).toBe(1);
  const read='/api/p/p123456789abc/blob?path=readme.md',review='/api/p/p123456789abc/candidates/candidate-session/review',decision={approved:true,expectedCommit:'a'.repeat(40)};
  const authorized=await call(read,member);if(!authorized.ok)throw Error(await authorized.text());expect(authorized.status).toBe(200);expect(await authorized.text()).toContain('synthetic private repository contents');const beforeDenied=await(await call('/fixture/read-count')).json() as number;
  expect((await call(read)).status).toBe(401);expect((await call(read,outsider)).status).toBe(404);expect(await(await call('/fixture/read-count')).json() as number).toBe(beforeDenied);
  expect((await call(review,member,decision)).status).toBe(403);expect((await call(review,outsider,decision)).status).toBe(404);expect((await call(review,undefined,decision)).status).toBe(401);
  const approved=await call(review,owner,decision);expect(approved.status).toBe(200);expect(await approved.json()).toMatchObject({recorded:true,approved:true});expect(await(await call('/fixture/billing-count')).json() as number).toBe(1);
 }finally{await mf.dispose();issuer.stop(true);}
},30000);
