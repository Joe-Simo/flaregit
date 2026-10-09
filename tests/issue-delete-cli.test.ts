import {expect,test} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {issueDeletionSchema} from '../src/server/issue-lifecycle';

test('actual CLI deletion requires confirmation and replays original revision while authorized view strips tombstone extras',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'flaregit-issue-delete-cli-')),repository='p123456789abc',secret='synthetic-full-owner-token',readSecret='synthetic-read-token',writerSecret='synthetic-write-token';let deleted=false,gets=0,deletes=0,applied=0,loseNext=true;
 const receipts=new Map<string,{scope:string;payload:string}>();
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  const url=new URL(request.url),readOnly=request.headers.get('Authorization')==='Bearer '+readSecret,writerOnly=request.headers.get('Authorization')==='Bearer '+writerSecret;if(!readOnly&&!writerOnly&&request.headers.get('Authorization')!=='Bearer '+secret)return new Response('Unauthorized',{status:401});
  const match=new RegExp(`^/api/p/${repository}/issues/([78])$`).exec(url.pathname);if(!match)return new Response('Missing fixture',{status:404});const number=Number(match[1]);
  if(request.method==='GET'){gets++;return deleted?Response.json({number,deleted:true,title:'private deleted title',body:'private deleted body',destination:{repositoryId:'foreign',issueNumber:99}},{status:410}):Response.json({number,stateRevision:3,canStateWrite:!readOnly,canDeleteIssue:!readOnly&&!writerOnly});}
  if(request.method!=='DELETE')return new Response('Method not allowed',{status:405});deletes++;if(readOnly||writerOnly)return new Response('Administrator and full credential required',{status:403});
  const parsed=issueDeletionSchema.safeParse(await request.json());if(!parsed.success)return new Response('Exact deletion payload required',{status:400});const input=parsed.data,payload=JSON.stringify(input),prior=receipts.get(input.requestId);
  if(prior){if(prior.scope!==url.pathname||prior.payload!==payload)return new Response('The original issue removal request cannot change',{status:409});return Response.json({number,deleted:true,requestId:input.requestId,replayed:true});}
  if(deleted)return Response.json({number,deleted:true},{status:410});if(input.expectedRevision!==3)return new Response('Issue changed',{status:409});receipts.set(input.requestId,{scope:url.pathname,payload});deleted=true;applied++;if(loseNext){loseNext=false;return new Response('Unconfirmed receipt',{status:503});}return Response.json({number,deleted:true,requestId:input.requestId,replayed:false});
 }});
 const run=async(action:string,issue='7',flags:string[]=[],token=secret)=>{
  const child=Bun.spawn([process.execPath,resolve(import.meta.dir,'../cli/flaregit.ts'),'issue',action,repository,issue,...flags],{cwd:directory,env:{PATH:process.env.PATH,FLAREGIT_API:server.url.origin,FLAREGIT_TOKEN:token,XDG_CONFIG_HOME:directory},stdout:'pipe',stderr:'pipe'}),timer=setTimeout(()=>child.kill(),10000);
  try{const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return{stdout,stderr,code};}finally{clearTimeout(timer);}
 };
 try{
  const unconfirmed=await run('delete');expect(unconfirmed.code).not.toBe(0);expect(unconfirmed.stderr).toContain('--confirm');expect(gets).toBe(0);expect(deletes).toBe(0);
  const readOnly=await run('delete','7',['--confirm'],readSecret);expect(readOnly.code).not.toBe(0);expect(readOnly.stderr).toContain('read-only');expect(deletes).toBe(0);
  const writer=await run('delete','7',['--confirm'],writerSecret);expect(writer.code).not.toBe(0);expect(writer.stderr).toContain('read-only');expect(deletes).toBe(0);
  const first=await run('delete','7',['--confirm']);expect(first.code).not.toBe(0);const marker=JSON.parse(first.stderr.split('\n')[0]!) as {requestId:string;expectedRevision:number;retry:string};expect(marker.expectedRevision).toBe(3);expect(marker.retry).toContain('--confirm --request '+marker.requestId+' --revision 3');expect(first.stderr).not.toContain(secret);expect(applied).toBe(1);const originalGets=gets;
  const flags=['--confirm','--request',marker.requestId,'--revision','3'];const retry=await run('delete','7',flags);expect(retry.code).toBe(0);expect(JSON.parse(retry.stdout)).toMatchObject({number:7,deleted:true,requestId:marker.requestId,replayed:true});expect(gets).toBe(originalGets);expect(applied).toBe(1);
  expect((await run('delete','7',['--confirm','--request',marker.requestId])).code).not.toBe(0);expect(gets).toBe(originalGets);
  const changed=await run('delete','7',['--confirm','--request',marker.requestId,'--revision','4']);expect(changed.code).not.toBe(0);expect(changed.stderr).toContain('cannot change');expect((await run('delete','8',flags)).code).not.toBe(0);expect(gets).toBe(originalGets);
  expect((await run('delete','7',flags,readSecret)).code).not.toBe(0);expect(applied).toBe(1);
  for(const commandArgs of [['issue','delete','--confirm',repository,'7','--request',marker.requestId,'--revision','3'],['--confirm','issue','delete',repository,'7','--request',marker.requestId,'--revision','3']]){const positioned=Bun.spawn([process.execPath,resolve(import.meta.dir,'../cli/flaregit.ts'),...commandArgs],{cwd:directory,env:{PATH:process.env.PATH,FLAREGIT_API:server.url.origin,FLAREGIT_TOKEN:secret,XDG_CONFIG_HOME:directory},stdout:'pipe',stderr:'pipe'}),positionTimer=setTimeout(()=>positioned.kill(),10000);try{const [out,err,code]=await Promise.all([new Response(positioned.stdout).text(),new Response(positioned.stderr).text(),positioned.exited]);expect(code).toBe(0);expect(JSON.parse(out)).toMatchObject({replayed:true});expect(err).not.toContain(secret);}finally{clearTimeout(positionTimer);}}
  const view=await run('view');expect(view.code).toBe(0);expect(JSON.parse(view.stdout)).toEqual({number:7,deleted:true});expect(view.stdout).not.toContain('private');expect(view.stdout).not.toContain('foreign');expect(gets).toBe(originalGets+1);
 }finally{server.stop(true);await rm(directory,{recursive:true,force:true});}
},30000);
