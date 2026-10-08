import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';

test('signed issue GET withholds private issue and comments when read authority changes during comment lookup',async()=>{
 if(await workerdChild('tests/issue-read-privacy-http.test.ts'))return;
 const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'issue-read-local',alg:'RS256',use:'sig'};
 const issuer=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/issue-read-privacy-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,'build','tests/support/issue-read-privacy-http-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*','--outfile='+file],{stdout:'ignore',stderr:'pipe'});
 if(await build.exited){issuer.stop(true);throw Error(await new Response(build.stderr).text());}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'issue-read',modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:'IssueReadPrivacyFixture',useSQLite:true}}}]}));
 try{
  const worker=await mf.getWorker('issue-read');
  const seedResponse=await worker.fetch('http://fixture/fixture/seed');expect(seedResponse.status).toBe(200);const seed=await seedResponse.json() as {issue:number;token:string;tokenId:string};
  const sign=(subject:string)=>new SignJWT({azp:'https://fixture.example'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
  const member=await sign('member'),inactive=await sign('inactive-member');
  const read=(token:string)=>worker.fetch(`http://fixture/api/p/p123456789abc/issues/${seed.issue}`,{headers:{Authorization:'Bearer '+token,'CF-Connecting-IP':'198.51.100.99'}});
  const verifyPrivate=async(token:string)=>{const response=await read(token);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({title:'Private issue release-fence secret',body:'Private issue body release-fence secret',comments:[{body:'Private comment release-fence secret'}]});};
  const arm=async(query:string)=>expect((await worker.fetch('http://fixture/fixture/arm?'+query)).status).toBe(200);
  const verifyWithheld=async(token:string,expectedStatus:number)=>{const response=await read(token);expect(response.status).toBe(expectedStatus);const body=await response.text();expect(body).not.toContain('Private issue');expect(body).not.toContain('Private comment');expect(body).not.toContain('release-fence secret');expect(body).not.toContain('comments');expect(body).not.toContain('title');};

  await verifyPrivate(member);await verifyPrivate(seed.token);await verifyPrivate(inactive);
  await arm('mode=membership&user=member');await verifyWithheld(member,403);
  await arm(`mode=token&user=pat-member&token=${seed.tokenId}`);await verifyWithheld(seed.token,401);
  await arm('mode=account&user=inactive-member');await verifyWithheld(inactive,403);
 }finally{await mf.dispose();issuer.stop(true);}
},60000);
