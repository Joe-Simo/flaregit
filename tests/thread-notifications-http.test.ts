import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';
test('member thread preferences drive exact-source inbox delivery with lost-ack dedupe and withdrawal fences',async()=>{
 if(await workerdChild('tests/thread-notifications-http.test.ts','member thread preferences drive exact-source inbox delivery with lost-ack dedupe and withdrawal fences'))return;
 const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'thread-notifications',alg:'RS256',use:'sig'};
 const issuer=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({keys:[jwk]})});
 const built=await Bun.build({entrypoints:['tests/support/private-comments-recovery-http-worker.ts'],target:'browser',external:['cloudflare:workers','node:*']});if(!built.success)throw Error(built.logs.join('\n'));
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'thread-notifications',modules:true,script:await built.outputs[0]!.text(),compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:'CommentRecoveryFixture',useSQLite:true}}}]}));
 try{
  const worker=await mf.getWorker('thread-notifications'),call=(path:string,token?:string,method='GET',body?:unknown)=>worker.fetch('http://fixture'+path,{method,headers:{'CF-Connecting-IP':'198.51.100.27',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const session=(id:string)=>new SignJWT({azp:'https://fixture.example'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(id).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
  const tokens=await(await call('/fixture/bootstrap')).json() as Record<string,string>,owner=await session('owner'),member=await session('member');
  const preference='/api/p/p123456789abc/thread-preference?subject=change:change-one',comments='/api/p/p123456789abc/comments';
  expect((await call(preference,tokens.owner,'PUT',{mode:'subscribed',expectedVersion:0})).status).toBe(403);
  expect(await(await call(preference,owner)).json()).toMatchObject({mode:'unsubscribed',version:0});
  expect((await call(preference,owner,'PUT',{mode:'subscribed',expectedVersion:0})).status).toBe(200);
  const payload={subject:'change:change-one',body:'Private reply is not copied to inbox',idempotencyKey:crypto.randomUUID()};
  expect((await call(comments,member,'POST',payload)).status).toBe(201);expect((await call(comments,member,'POST',payload)).status).toBe(201);
  await call('/fixture/lose-inbox');await call('/fixture/flush-thread');await call('/fixture/flush-thread');
  const inbox=async()=>await(await call('/api/inbox?filter=activity',owner)).json() as {items:Array<{type:string;title:string}>};
  const delivered=(await inbox()).items.filter(row=>row.type.startsWith('thread.comment.'));expect(delivered).toHaveLength(1);expect(delivered[0]!.title).toBe('New comment in a subscribed thread');expect(JSON.stringify(delivered)).not.toContain(payload.body);
  expect((await call(preference,owner,'PUT',{mode:'muted',expectedVersion:1})).status).toBe(200);expect((await inbox()).items.filter(row=>row.type.startsWith('thread.comment.'))).toEqual([]);
  expect((await call(preference,owner,'PUT',{mode:'subscribed',expectedVersion:2})).status).toBe(200);expect((await inbox()).items.filter(row=>row.type.startsWith('thread.comment.'))).toEqual([]);
  expect((await call('/api/p/p123456789abc/thread-preference?subject=change:unknown-thread',owner)).status).toBe(409);
  expect(await(await call('/fixture/provider-calls')).json()).toEqual([]);
 }finally{await mf.dispose();issuer.stop(true);}
},60000);

test('plain-text mentions prove private member identities, dedupe with subscriptions and suppress muted or revoked sources',async()=>{
 if(await workerdChild('tests/thread-notifications-http.test.ts','plain-text mentions prove private member identities, dedupe with subscriptions and suppress muted or revoked sources'))return;
 const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'thread-mentions',alg:'RS256',use:'sig'};
 const issuer=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({keys:[jwk]})});
 const built=await Bun.build({entrypoints:['tests/support/private-comments-recovery-http-worker.ts'],target:'browser',external:['cloudflare:workers','node:*']});if(!built.success)throw Error(built.logs.join('\n'));
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'thread-mentions',modules:true,script:await built.outputs[0]!.text(),compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:'CommentRecoveryFixture',useSQLite:true}}}]}));
 try{
  const worker=await mf.getWorker('thread-mentions'),call=(path:string,token?:string,method='GET',body?:unknown)=>worker.fetch('http://fixture'+path,{method,headers:{'CF-Connecting-IP':'198.51.100.28',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const session=(id:string)=>new SignJWT({azp:'https://fixture.example'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(id).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
  await call('/fixture/bootstrap');const owner=await session('owner'),member=await session('member'),other=await session('other');
  expect((await call('/fixture/inherited-mention')).status).toBe(200);
  const preference='/api/p/p123456789abc/thread-preference?subject=change:change-one',comments='/api/p/p123456789abc/comments';
  expect((await call(preference,owner,'PUT',{mode:'subscribed',expectedVersion:0})).status).toBe(200);
  const payload={subject:'change:change-one',body:'@owner @OTHER @member person@owner.example @unknown-private-handle',idempotencyKey:crypto.randomUUID()};
  const posted=await call(comments,member,'POST',payload);expect(posted.status).toBe(201);const source=await posted.json() as {id:number};
  expect((await call(preference,other,'PUT',{mode:'subscribed',expectedVersion:0})).status).toBe(200);
  expect((await call(preference,other,'PUT',{mode:'unsubscribed',expectedVersion:1})).status).toBe(200);
  await call('/fixture/flush-thread');
  const mentions=async(token:string)=>(await(await call('/api/inbox?filter=direct',token)).json() as {items:Array<{type:string;title:string}>}).items.filter(row=>row.type.startsWith('thread.mention.'));
  expect(await mentions(owner)).toHaveLength(1);expect(await mentions(other)).toHaveLength(1);expect(await mentions(member)).toHaveLength(0);
  expect((await call(preference,owner,'PUT',{mode:'unsubscribed',expectedVersion:1})).status).toBe(200);expect(await mentions(owner)).toHaveLength(1);
  expect((await call(preference,owner,'PUT',{mode:'subscribed',expectedVersion:2})).status).toBe(200);expect(await mentions(owner)).toHaveLength(1);
  expect((await(await call('/api/inbox?filter=activity',owner)).json() as {items:Array<{type:string}>}).items.filter(row=>row.type.startsWith('thread.comment.'))).toHaveLength(0);
  expect(JSON.stringify(await mentions(other))).not.toContain(payload.body);
  await call('/fixture/change-mention-profile');expect(await mentions(owner)).toHaveLength(1);
  const pending=await call(comments,member,'POST',{subject:'change:change-one',body:'@renamed-owner pending across an identical timestamp regrant',idempotencyKey:crypto.randomUUID()});expect(pending.status).toBe(201);
  expect((await call('/fixture/regrant-identical-timestamp')).status).toBe(200);expect(await mentions(owner)).toHaveLength(0);
  await call('/fixture/flush-thread');expect(await mentions(owner)).toHaveLength(0);
  const explicitReaderPreference=await call(preference,other);expect(explicitReaderPreference.status).toBe(200);
  expect((await call(comments,member,'POST',payload)).status).toBe(201);await call('/fixture/flush-thread');expect(await mentions(other)).toHaveLength(1);
  expect((await call(preference,other,'PUT',{mode:'muted',expectedVersion:2})).status).toBe(200);expect(await mentions(other)).toHaveLength(0);
  expect((await call(preference,other,'PUT',{mode:'unsubscribed',expectedVersion:3})).status).toBe(200);expect(await mentions(other)).toHaveLength(0);
  expect((await call(preference,other,'PUT',{mode:'muted',expectedVersion:4})).status).toBe(200);
  expect((await call(comments,member,'POST',{subject:'change:change-one',body:'@other while muted',idempotencyKey:crypto.randomUUID()})).status).toBe(201);await call('/fixture/flush-thread');expect(await mentions(other)).toHaveLength(0);
  await call(`/fixture/remove?id=${source.id}`);expect(await mentions(owner)).toHaveLength(0);
  await call('/fixture/revoke-inherited-mention');expect(await mentions(other)).toHaveLength(0);
  expect(await(await call('/fixture/provider-calls')).json()).toEqual([]);
 }finally{await mf.dispose();issuer.stop(true);}
},60000);
