import {expect} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import type {IssueTransferPreview,IssueTransferRequest} from '../../src/server/issue-transfer-api';

export async function createIssueTransferHarness(){
 const source='p111111111111',destination='p222222222222',pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'transfer-cancel-local',alg:'RS256',use:'sig'};
 const issuer=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>Response.json({keys:[jwk]})}),file=`/tmp/issue-transfer-cancel-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,'build','tests/support/issue-transfer-privacy-http-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*','--outfile='+file],{stdout:'ignore',stderr:'pipe'});
 if(await build.exited){issuer.stop(true);throw Error(await new Response(build.stderr).text());}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'transfer-cancel',unsafeDirectSockets:[{host:'127.0.0.1',port:0}],modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:'IssueTransferPrivacyFixture',useSQLite:true},AUTHORITY:{className:'AuthorityController',useSQLite:true}},r2Buckets:{EVIDENCE_BUCKET:'transfer-cancel-real-bytes'}}]}));
 try{
  const origin=(await mf.unsafeGetDirectURL('transfer-cancel')).origin;
  const fixture=async(path:string)=>{const response=await fetch(origin+'/fixture/'+path);expect(response.status).toBe(200);return response;};
  const seed=await(await fixture('seed')).json() as {issue:{number:number;revision:number};tokens:Record<string,{secret:string;id:string}>;oauth:string};
  const sign=(subject:string)=>new SignJWT({azp:'https://fixture.example'}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);const admin=await sign('transfer-admin');
  const call=(path:string,method='GET',body?:unknown,token=admin)=>fetch(origin+path,{method,headers:{Authorization:'Bearer '+token,'CF-Connecting-IP':'198.51.100.99','content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const issuePath=(project=source,number=seed.issue.number)=>`/api/p/${project}/issues/${number}`;
  const prepare=async():Promise<IssueTransferRequest>=>{const response=await call(issuePath()+`/transfer-preview?destinationProjectId=${destination}`);expect(response.status).toBe(200);const preview=await response.json() as IssueTransferPreview;return{destinationProjectId:destination,expectedRevision:preview.source.stateRevision,requestId:crypto.randomUUID(),confirmed:true,expectedManifestDigest:preview.manifestDigest,expectedDestinationIncarnation:preview.destination.incarnation};};
  const upload=async()=>{const bytes=new Uint8Array([0,255,128,10,13,0,1]),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join(''),id=crypto.randomUUID();expect((await call(issuePath()+'/attachments','POST',{id,name:'cancel-proof.bin',sha256,size:bytes.length})).status).toBe(201);const response=await fetch(origin+issuePath()+`/attachments/${id}/content`,{method:'PUT',headers:{Authorization:'Bearer '+admin,'CF-Connecting-IP':'198.51.100.99'},body:bytes});expect(response.status).toBe(200);return{bytes,id,sha256};};
  const waitPaused=async(kind:'hook'|'read'|'write'|'finalization',target:string)=>{const deadline=Date.now()+5000;while(Date.now()<deadline){const response=await fixture(`${kind}-status?target=${target}`),status=await response.json() as {paused:string|boolean|null};if(status.paused)return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Transfer cancellation fixture did not reach its bounded pause');};
  const noPrivate=async(response:{text():Promise<string>})=>{const body=await response.text();for(const secret of ['Private transferable issue secret','Private transferable body secret','Private transferable comment secret','Private source task secret'])expect(body).not.toContain(secret);};
  return{source,destination,origin,seed,admin,sign,call,fixture,issuePath,prepare,upload,waitPaused,noPrivate,async dispose(){for(const target of ['source','destination'])for(const kind of ['hook','read','write','finalization'])await fetch(origin+`/fixture/${kind}-resume?target=${target}`).catch(()=>undefined);await mf.dispose();issuer.stop(true);}};
 }catch(error){await mf.dispose();issuer.stop(true);throw error;}
}
