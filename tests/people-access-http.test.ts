import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';
test('actual People HTTP denies revoked membership and parent token during profile await',async()=>{
 if(await workerdChild('tests/people-access-http.test.ts'))return;
 let arrived:()=>void=()=>{},release:()=>void=()=>{};
 let entry:Promise<void>,ack:Promise<void>;
 const arm=()=>{entry=new Promise<void>(resolve=>{arrived=resolve;});ack=new Promise<void>(resolve=>{release=resolve;});};arm();
 const gate=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(){arrived();await ack;return new Response('profile acknowledged');}});
 const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'people-local',alg:'RS256',use:'sig'},issuer=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/people-http-${crypto.randomUUID()}.js`,build=Bun.spawn([process.execPath,'build','tests/support/people-access-http-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*','--outfile='+file],{stdout:'ignore',stderr:'pipe'});if(await build.exited)throw Error(await new Response(build.stderr).text());
 const script=await Bun.file(file).text();await Bun.file(file).delete();const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'people-http',unsafeDirectSockets:[{host:'127.0.0.1'}],modules:true,script,bindings:{FIXTURE_GATE:gate.url.origin,FIXTURE_ISSUER:issuer.url.origin},compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{REPOSITORY_CONTROLLER:{className:'PeopleAccessFixture',useSQLite:true}}}]}));
 try{const direct=await mf.unsafeGetDirectURL('people-http'),call=(path:string,token?:string)=>fetch(new URL(path,direct),{headers:{Connection:'close','CF-Connecting-IP':'198.51.100.81',...(token?{Authorization:'Bearer '+token}:{})}}),session=await new SignJWT({azp:'https://fixture.example'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject('human').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey),seed=await call('/fixture/seed'),{token,tokenId}=await seed.json() as {token:string;tokenId:string},path='/api/p/p123456abcdef/people';
 const baseline=await call(path,session);expect(baseline.status).toBe(200);const dto=await baseline.json() as {humans:Array<{id:string;name:string}>};expect(dto.humans.length).toBe(2);expect(dto.humans.every(person=>/^[a-f0-9]{64}$/.test(person.id))).toBe(true);expect(dto.humans.map(person=>person.id)).not.toContain('human');
 await call('/fixture/arm');const pending=call(path,session);await entry!;expect((await call('/fixture/remove')).status).toBe(200);release();const denied=await pending;expect(denied.status).toBe(403);expect(await denied.text()).not.toContain('humans');
 await call('/fixture/rejoin');arm();const tokenPending=call(path,token);await entry!;expect((await call('/fixture/revoke?id='+encodeURIComponent(tokenId))).status).toBe(200);release();const revoked=await tokenPending;expect(revoked.status).toBe(401);expect(await revoked.text()).not.toContain('humans');
 }finally{release();await mf.dispose();gate.stop(true);issuer.stop(true);}
},30000);
