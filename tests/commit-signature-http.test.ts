import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';
import * as openpgp from 'openpgp';

const plain='tree '+ 'a'.repeat(40)+'\nauthor Fixture <fixture@localhost> 1700000000 +0000\ncommitter Fixture <fixture@localhost> 1700000000 +0000\n\nExact unsigned payload\n';
const malformed=plain.replace('\n\nExact','\ngpgsig not-a-signature-block\n\nExact');
const rawBase64=(raw:string)=>Buffer.from(raw).toString('base64');
function commitHash(raw:string){const bytes=Buffer.from(raw),header=Buffer.from(`commit ${bytes.length}\0`);return new Bun.CryptoHasher('sha1').update(header).update(bytes).digest('hex');}

test('commit signature HTTP binds real raw hashes to signed sessions, read PATs, current membership, keys and positive cleanup',async()=>{
 const testName='commit signature HTTP binds real raw hashes to signed sessions, read PATs, current membership, keys and positive cleanup';if(await workerdChild('tests/commit-signature-http.test.ts',testName))return;
 const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'signature-local',alg:'RS256',use:'sig'},issuer=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`${process.env.TMPDIR??'/tmp'}/commit-signature-worker-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,'build','tests/support/commit-signature-http-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*','--outfile='+file],{stdout:'ignore',stderr:'pipe'});let script:string;
 try{if(await build.exited!==0)throw Error(await new Response(build.stderr).text());script=await Bun.file(file).text();}finally{if(await Bun.file(file).exists())await Bun.file(file).delete();}
 const budgets={FIXTURE_ISSUER:issuer.url.origin,MANAGED_ACCOUNT_MONTHLY_USD_MICROS:'100000000',MANAGED_GLOBAL_MONTHLY_USD_MICROS:'100000000',MANAGED_ESSENTIAL_ACCOUNT_MONTHLY_USD_MICROS:'1000000',MANAGED_ESSENTIAL_GLOBAL_MONTHLY_USD_MICROS:'2000000',CORE_GIT_ACCOUNT_MONTHLY_USD_MICROS:'100000000',CORE_GIT_GLOBAL_MONTHLY_USD_MICROS:'100000000',REPOSITORY_READ_ACCOUNT_MONTHLY_USD_MICROS:'1000000',REPOSITORY_READ_GLOBAL_MONTHLY_USD_MICROS:'1000000'};
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'commit-signature',modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],bindings:budgets,durableObjects:{REPOSITORY_CONTROLLER:{className:'CommitSignatureHttpFixture',useSQLite:true}}}]}));
 try{
  const worker=await mf.getWorker('commit-signature'),sign=(subject:string)=>new SignJWT({azp:'https://fixture.example'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey),member=await sign('member'),owner=await sign('owner'),outsider=await sign('outsider');let project='p123456789abc',seedNumber=0;
  const fixture=(path:string,value?:unknown)=>worker.fetch(`http://fixture/fixture/${path}${path.includes('?')?'&':'?'}project=${project}`,{method:value===undefined?'GET':'POST',...(value===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})});
  const seed=async(raw=plain)=>{project=`p${(++seedNumber).toString().padStart(11,'0')}`;const reply=await fixture('seed',{rawBase64:rawBase64(raw)});expect(reply.status).toBe(200);const result=await reply.json() as {commit:string};expect(result.commit).toBe(commitHash(raw));return result.commit;};
  const call=(token:string|null,query:string,method='GET')=>worker.fetch(`http://fixture/api/p/${project}/commit-signature?${query}`,{method,headers:{'CF-Connecting-IP':'198.51.100.99',...(token?{Authorization:'Bearer '+token}:{})}});
  let commit=await seed();
  const session=await call(member,'commit='+commit);expect(session.status).toBe(200);expect(await session.json()).toMatchObject({commit,status:'unsigned',trust:'viewer-registered-keys'});expect(session.headers.get('Cache-Control')).toContain('no-store');
  const token=await(await fixture('token?actor=member')).json() as {token:string;id:string};const pat=await call(token.token,'commit='+commit);expect(pat.status).toBe(200);expect(await pat.json()).toMatchObject({commit,status:'unsigned'});
  const before=await(await fixture('stats')).json() as {commands:number;minted:number};
  for(const query of ['commit='+'0'.repeat(40),'commit='+commit+'&extra=unsupported','commit='+commit+'&commit='+commit,'commit='+commit+'&task=one&candidate=two','commit='+commit+'&input=one'])expect((await call(member,query)).status).toBe(400);
  expect((await call(owner,'commit='+commit,'POST')).status).toBe(405);expect((await call(outsider,'commit='+commit)).status).toBe(404);expect((await call(null,'commit='+commit)).status).toBe(401);
  await fixture('revoke',{actor:'member',id:token.id});expect((await call(token.token,'commit='+commit)).status).toBe(401);expect(await(await fixture('stats')).json()).toEqual(before);

  const keyPair=await openpgp.generateKey({type:'ecc',curve:'curve25519Legacy',userIDs:[{name:'Signature fixture',email:'fixture@localhost'}],format:'armored'}),privateKey=await openpgp.readPrivateKey({armoredKey:keyPair.privateKey});
  const detached=await openpgp.sign({message:await openpgp.createMessage({binary:new TextEncoder().encode(plain)}),signingKeys:privateKey,detached:true,format:'armored'});
  const signed=plain.replace('\n\nExact','\ngpgsig '+detached.trimEnd().replaceAll('\n','\n ')+'\n\nExact');
  const keyHttp=(method:string,json:unknown)=>worker.fetch('http://fixture/api/signing-keys/gpg',{method,headers:{'CF-Connecting-IP':'198.51.100.99',Authorization:'Bearer '+member,'Content-Type':'application/json'},body:JSON.stringify(json)});
  const registered=await keyHttp('POST',{key:keyPair.publicKey});expect(registered.status).toBe(200);const registeredKeys=await registered.json() as {keys:{fingerprint:string}[]};
  commit=await seed(signed);const verified=await call(member,'commit='+commit);expect(verified.status).toBe(200);expect(await verified.json()).toMatchObject({commit,status:'verified',format:'gpg',fingerprint:registeredKeys.keys[0]!.fingerprint,trust:'viewer-registered-keys'});
  expect(await(await call(owner,'commit='+commit)).json()).toMatchObject({status:'unverified',format:'gpg'});
  expect((await keyHttp('DELETE',{fingerprint:registeredKeys.keys[0]!.fingerprint})).status).toBe(200);expect(await(await call(member,'commit='+commit)).json()).toMatchObject({status:'unverified',format:'gpg'});

  commit=await seed(malformed);const invalidSignature=await call(member,'commit='+commit);expect(invalidSignature.status).toBe(200);expect(await invalidSignature.json()).toMatchObject({commit,status:'malformed'});
  await fixture('mode',{rawBase64:rawBase64(plain)});const wrongBytes=await call(member,'commit='+commit);expect(wrongBytes.status).toBe(409);expect(await wrongBytes.text()).not.toContain('verified');

  for(const effect of ['provider','member','key','key-regrant']){
   commit=await seed();if(effect.startsWith('key'))expect(await(await fixture('key?actor=member')).json()).toMatchObject({ok:true});await fixture('mode',{effect,actor:'member'});
   const denied=await call(member,'commit='+commit);expect(denied.status).toBe(409);const payload=await denied.json() as {status?:string;error?:string};expect(payload.status).toBeUndefined();expect(payload.error).toContain('not confirmed');
   if(effect==='provider')expect(await(await fixture('stats')).json()).toMatchObject({commands:0,minted:0});
  }
  for(const mode of [{stopped:false},{revoked:false}]){
   commit=await seed();await fixture('mode',mode);const denied=await call(member,'commit='+commit);expect(denied.status).toBe(409);expect(await denied.json()).toMatchObject({error:'Signature inspection or cleanup was not confirmed. Refresh the exact commit before retrying.'});
  }
  commit=await seed();const lastToken=await(await fixture('token?actor=member')).json() as {token:string;id:string};await fixture('final-trust-revoke',{actor:'member',id:lastToken.id});expect((await call(lastToken.token,'commit='+commit)).status).toBe(409);
  expect(await(await fixture('delete-during-key-parse',{armored:keyPair.publicKey})).json()).toMatchObject({refused:true,lifecycle:'deleted',keys:0});
 }finally{await mf.dispose();issuer.stop(true);}
},90000);
