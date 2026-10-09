import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {workerdChild} from './support/workerd-child';

test('issue deletion fences late private reads and rejects callers whose administrator authority changed',async()=>{
 if(await workerdChild('tests/issue-lifecycle-privacy-http.test.ts'))return;
 const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'issue-lifecycle-local',alg:'RS256',use:'sig'};
 const issuer=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({keys:[jwk]})}),file=`/tmp/issue-lifecycle-privacy-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,'build','tests/support/issue-lifecycle-privacy-http-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*','--outfile='+file],{stdout:'ignore',stderr:'pipe'});
 if(await build.exited){issuer.stop(true);throw Error(await new Response(build.stderr).text());}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'issue-lifecycle-privacy',modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:'IssueLifecyclePrivacyFixture',useSQLite:true}}}]}));
 try{
  const worker=await mf.getWorker('issue-lifecycle-privacy'),fixture=async(path:string)=>{const response=await worker.fetch('http://fixture/fixture/'+path);expect(response.status).toBe(200);return response;};
  const seeded=await(await fixture('seed')).json() as {issues:Array<{number:number;revision:number}>;tokens:Record<string,{secret:string;id:string}>};
  const [late,membership,tokenIssue,inactive,commentLate]=seeded.issues;expect(seeded.issues).toHaveLength(5);
  const sign=(subject:string)=>new SignJWT({azp:'https://fixture.example'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
  const member=await sign('member'),membershipOwner=await sign('owner-membership-race'),inactiveOwner=await sign('owner-account-race');
  const call=(token:string,number:number,method='GET',value?:unknown)=>worker.fetch(`http://fixture/api/p/p123456789abc/issues/${number}`,{method,headers:{Authorization:'Bearer '+token,'CF-Connecting-IP':'198.51.100.99','content-type':'application/json'},...(value===undefined?{}:{body:JSON.stringify(value)})});
  const deletion=(revision:number)=>({expectedRevision:revision,requestId:crypto.randomUUID(),confirmed:true});
  const active=async(number:number)=>expect(await(await fixture('audit?number='+number)).json()).toEqual({retained:1,markers:0,active:true});
  const privateAbsent=async(response:{text():Promise<string>})=>{const text=await response.text();expect(text).not.toContain('Private');expect(text).not.toContain('secret');expect(text).not.toContain('comments');expect(text).not.toContain('title');expect(text).not.toContain('body');};

  const initial=await call(member,late!.number);expect(initial.status).toBe(200);expect(await initial.json()).toMatchObject({title:'Private issue release-fence secret',comments:[{body:'Private comment release-fence secret'}]});
  await fixture('late?number='+late!.number);const withdrawn=await call(member,late!.number);expect(withdrawn.status).toBe(410);expect(await withdrawn.json()).toEqual({number:late!.number,deleted:true});
  expect(await(await fixture('audit?number='+late!.number)).json()).toEqual({retained:1,markers:1,active:false});
  const comments=(number:number)=>worker.fetch(`http://fixture/api/p/p123456789abc/comments?subject=issue:${number}&page=1`,{headers:{Authorization:'Bearer '+member,'CF-Connecting-IP':'198.51.100.99'}});
  const commentBaseline=await comments(commentLate!.number);expect(commentBaseline.status).toBe(200);expect(await commentBaseline.json()).toMatchObject({comments:[{body:'Private deletion comment secret'}],nextCursor:null,hasMore:false});
  await fixture('late-comments?number='+commentLate!.number);const lateComments=await comments(commentLate!.number);expect(lateComments.status).toBe(410);await privateAbsent(lateComments);
  expect(await(await fixture('audit?number='+commentLate!.number)).json()).toEqual({retained:1,markers:1,active:false});
  const previouslyDeleted=await comments(late!.number);expect([403,410]).toContain(previouslyDeleted.status);await privateAbsent(previouslyDeleted);


  const readDenied=await call(seeded.tokens.read!.secret,membership!.number,'DELETE',deletion(membership!.revision));expect(readDenied.status).toBe(403);await privateAbsent(readDenied);await active(membership!.number);
  const memberDenied=await call(member,membership!.number,'DELETE',deletion(membership!.revision));expect(memberDenied.status).toBe(403);await privateAbsent(memberDenied);await active(membership!.number);

  await fixture('deletion-race?mode=membership&user=owner-membership-race');const membershipDenied=await call(membershipOwner,membership!.number,'DELETE',deletion(membership!.revision));expect(membershipDenied.status).toBe(403);await privateAbsent(membershipDenied);await active(membership!.number);
  await fixture('deletion-race?mode=token&user=owner-token-race&token='+seeded.tokens.owner!.id);const tokenDenied=await call(seeded.tokens.owner!.secret,tokenIssue!.number,'DELETE',deletion(tokenIssue!.revision));expect(tokenDenied.status).toBe(401);await privateAbsent(tokenDenied);await active(tokenIssue!.number);
  await fixture('deletion-race?mode=account&user=owner-account-race');const accountDenied=await call(inactiveOwner,inactive!.number,'DELETE',deletion(inactive!.revision));expect(accountDenied.status).toBe(403);await privateAbsent(accountDenied);await active(inactive!.number);
 }finally{await mf.dispose();issuer.stop(true);}
},60000);
