import {expect,test} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {issueStateMutationSchema} from '../src/server/issue-state';

const repository='p123456789abc',credential='synthetic-cli-issue-credential';
test('actual issue CLI retains UUID and original revision after uncertain delivery and refuses changed replay',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'flaregit-issue-cli-'));let revision=4,state='open',gets=0,patches=0,readOnly=false,loseNext=true,applied=0;
 const receipts=new Map<string,{payload:string;revision:number;state:string}>();
 const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  const url=new URL(request.url);if(request.headers.get('Authorization')!=='Bearer '+credential)return new Response('Unauthorized',{status:401});if(url.pathname!==`/api/p/${repository}/issues/7`)return new Response('Missing fixture',{status:404});
  if(request.method==='GET'){gets++;return Response.json({number:7,state,stateRevision:revision,canStateWrite:!readOnly});}
  if(request.method!=='PATCH')return new Response('Method not allowed',{status:405});patches++;
  if(readOnly)return new Response('Issue state is read-only',{status:403});const parsed=issueStateMutationSchema.safeParse(await request.json());if(!parsed.success)return new Response('Strict status payload required',{status:400});
  const input=parsed.data,payload=JSON.stringify(input),prior=receipts.get(input.requestId);if(prior){if(prior.payload!==payload)return new Response('The original status request cannot change',{status:409});return Response.json({replayed:true,originalState:prior.state,originalRevision:prior.revision,issue:{number:7,state,stateRevision:revision}});}
  if(input.expectedRevision!==revision)return new Response('Issue status changed',{status:409});state=input.state;revision++;applied++;receipts.set(input.requestId,{payload,revision,state});if(loseNext){loseNext=false;return new Response('Unconfirmed response',{status:503});}return Response.json({replayed:false,issue:{number:7,state,stateRevision:revision}});
 }});
 const run=async(action:string,...flags:string[])=>{
  const child=Bun.spawn([process.execPath,resolve(import.meta.dir,'../cli/flaregit.ts'),'issue',action,repository,'7',...flags],{cwd:directory,env:{PATH:process.env.PATH,FLAREGIT_API:server.url.origin,FLAREGIT_TOKEN:credential,XDG_CONFIG_HOME:directory},stdout:'pipe',stderr:'pipe'}),timer=setTimeout(()=>child.kill(),10000);
  try{const [stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);return{stdout,stderr,code};}finally{clearTimeout(timer);}
 };
 try{
  const first=await run('close');expect(first.code).not.toBe(0);expect(first.stdout).toBe('');const marker=JSON.parse(first.stderr.split('\n')[0]!) as {requestId:string;expectedRevision:number;repositoryId:string;issueNumber:number;action:string;retry:string};expect(marker).toMatchObject({repositoryId:repository,issueNumber:7,action:'close',expectedRevision:4});expect(marker.retry).toContain('--request '+marker.requestId+' --revision 4');expect(first.stderr).not.toContain(credential);expect(applied).toBe(1);expect(gets).toBe(1);
  const replay=await run('close','--request',marker.requestId,'--revision','4');expect(replay.code).toBe(0);expect(JSON.parse(replay.stdout)).toMatchObject({replayed:true,originalState:'closed',originalRevision:5});expect(gets).toBe(1);expect(applied).toBe(1);
  const changed=await run('reopen','--request',marker.requestId,'--revision','4');expect(changed.code).not.toBe(0);expect(changed.stderr).toContain('original status request cannot change');expect(applied).toBe(1);expect(gets).toBe(1);
  const missingRevision=await run('close','--request',marker.requestId);expect(missingRevision.code).not.toBe(0);expect(missingRevision.stderr).toContain('original --revision');expect(patches).toBe(3);
  readOnly=true;const denied=await run('reopen');expect(denied.code).not.toBe(0);expect(denied.stderr).toContain('read-only');expect(patches).toBe(3);expect(denied.stderr).not.toContain(credential);
  readOnly=false;const ordinary=await run('reopen');expect(ordinary.code).toBe(0);expect(JSON.parse(ordinary.stdout)).toMatchObject({replayed:false,issue:{state:'open',stateRevision:6}});expect(applied).toBe(2);
  const closed=await run('close');expect(closed.code).toBe(0);expect(JSON.parse(closed.stdout)).toMatchObject({replayed:false,issue:{state:'closed',stateRevision:7}});expect(applied).toBe(3);
 }finally{server.stop(true);await rm(directory,{recursive:true,force:true});}
},30000);

test('issue CLI preparation validates positive bounded issue numbers and exact replay flags',async()=>{
 const {prepareIssueStateCommand}=await import('../src/cli/issue-state-command');let reads=0;const read=async()=>{reads++;return{stateRevision:0,canStateWrite:true};},base={repositoryId:repository,issue:'7',action:'close' as const};
 for(const issue of ['0','-1','1.0','10000000','7/path'])await expect(prepareIssueStateCommand({...base,issue},read)).rejects.toThrow('Issue number');
 for(const revision of ['-1','9007199254740992','1.5',true] as const)await expect(prepareIssueStateCommand({...base,revision},read)).rejects.toThrow('--revision');
 for(const request of ['partial',true] as const)await expect(prepareIssueStateCommand({...base,request,revision:'0'},read)).rejects.toThrow('UUID');
 expect(reads).toBe(0);const command=await prepareIssueStateCommand(base,read);expect(command.body).toMatchObject({state:'closed',expectedRevision:0});expect(command.metadata.action).toBe('close');expect(reads).toBe(1);
});
