import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,existsSync,cpSync,lstatSync,readdirSync,realpathSync,chmodSync} from 'node:fs';
import {join,resolve,sep,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {executableJobs,workflowDigest,type ExecutableJob} from '../core/ci-workflow';
import {createExecutionBoundary,executionEnv} from '../core/verification/execution';
import {redactSecrets} from '../agents/prompt';
import {readServiceCandidate,sendServiceReport} from './report';
import {LocalCiLedger,type LocalCiScope} from './ci-ledger';
const git=(directory:string,...args:string[])=>{const result=spawnSync('/usr/bin/git',['-C',directory,...args],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_NO_REPLACE_OBJECTS:'1'}});if(result.status!==0)throw Error('Exact CI Git snapshot is unavailable');return result.stdout.trim();};
function canonicalTarget(path:string):string{const target=resolve(path);return existsSync(target)?realpathSync(target):join(canonicalTarget(dirname(target)),basename(target));}
function checkedCache(path:string){let bytes=0,files=0;const walk=(entry:string)=>{const stat=lstatSync(entry);if(stat.isSymbolicLink()||!stat.isDirectory()&&!stat.isFile())throw Error('Cache only accepts ordinary files and directories');if(++files>2000||(bytes+=stat.size)>10_000_000)throw Error('Cache exceeds local capacity');if(stat.isDirectory())for(const name of readdirSync(entry))walk(join(entry,name));};walk(path);}
export interface CustomerCiInput {origin:string;repositoryId:string;candidateId:string;serviceId:string;checkId:string;commit:string;secret:string;repoDirectory:string;workflow:unknown;approvedDigest:string;ledgerPath:string;cacheDirectory?:string;signal?:AbortSignal;/** Never produces a passing provider attestation. Explicit local test harness only. */allowUnisolatedTest?:boolean;fetcher?:Parameters<typeof readServiceCandidate>[0]['fetcher']}
/** Runs on the customer's machine, never the trusted publisher. Owner-approved commands do not receive service credentials or host environment. */
export async function runCustomerCi(input:CustomerCiInput){
 const {jobs}=executableJobs(input.workflow),digest=await workflowDigest(input.workflow);
 if(input.approvedDigest!==digest)throw Error('Workflow needs the exact owner-approved digest');
 if(jobs.some(job=>job.secrets.length))throw Error('This runner dialect grants no workflow secrets, including fork jobs');
 if(!input.allowUnisolatedTest&&(process.platform!=='linux'||process.getuid?.()!==0))throw Error('Customer runner requires Linux UID isolation; this platform cannot attest CI');
 if(input.allowUnisolatedTest&&process.env.NODE_ENV!=='test')throw Error('Unisolated execution is restricted to the explicit local test harness');
 const repoDirectory=realpathSync(input.repoDirectory),cacheDirectory=input.cacheDirectory?canonicalTarget(input.cacheDirectory):undefined;
 for(const target of [canonicalTarget(input.ledgerPath),...(cacheDirectory?[cacheDirectory]:[])])if(target===repoDirectory||target.startsWith(repoDirectory+sep))throw Error('Runner state and caches must remain outside contributor checkout');
 const snapshot=await readServiceCandidate(input),selected=snapshot.checks.find(check=>check.id===input.checkId)?.run;
 if(!selected)throw Error('An exact selected check run is required');
 const scope:LocalCiScope={repositoryId:input.repositoryId,candidateId:input.candidateId,commit:snapshot.commit,tree:snapshot.tree,policyVersion:snapshot.policyVersion,runId:selected.id,checkId:input.checkId,workflowDigest:digest};
 const ledger=new LocalCiLedger(input.ledgerPath);ledger.initialize(scope,jobs);
 let reported=false;
 const report=async(status:'running'|'passed'|'failed'|'cancelled',sequence:number,summary:string)=>{const current=await readServiceCandidate(input),run=current.checks.find(check=>check.id===input.checkId)?.run;if(current.tree!==scope.tree||current.policyVersion!==scope.policyVersion||run?.id!==scope.runId)throw Error('Current candidate, policy or selected run changed');return sendServiceReport({...input,eventId:`${scope.runId}:ci:${sequence}`,report:{type:'check',candidateId:scope.candidateId,commit:scope.commit,tree:scope.tree,checkId:scope.checkId,runId:scope.runId,policyVersion:scope.policyVersion,sequence,status,summary}});};
 const onAbort=()=>ledger.cancel(scope.runId);input.signal?.addEventListener('abort',onAbort,{once:true});
 try{
  const existing=ledger.jobs(scope.runId),complete=existing.every(job=>['passed','failed','cancelled','interrupted'].includes(job.status));
  if(existing.some(job=>job.status==='running'))throw Error('Saved running job requires cleanup inspection; never replay an interrupted claim');
  if(!complete&&(!['queued','running'].includes(selected.status)||selected.sequence>0))throw Error('Terminal provider runs cannot dispatch new work');
  if(input.signal?.aborted)ledger.cancel(scope.runId);
  if(!complete&&selected.sequence===-1){const receipt=await report('running',0,`Owner-approved workflow ${digest}; customer-owned Linux runner`);if(receipt.kind==='rejected')throw Error('Provider rejected execution claim');}
  for(const job of complete?[]:jobs){
   const previous=ledger.jobs(scope.runId),blocked=job.dependencies.some(id=>previous.find(item=>item.id===id)?.status!=='passed');
   if(ledger.cancelled(scope.runId))break;
   if(blocked){ledger.finish(scope.runId,job.id,'failed','Skipped because a dependency did not pass',true);continue;}
   if(!ledger.claim(scope.runId,job.id)){if(ledger.cancelled(scope.runId))break;throw Error('Job scheduling claim was not confirmed');}
   const result=await executeJob(input,scope,job,repoDirectory,cacheDirectory,()=>ledger.cancelled(scope.runId));
   ledger.finish(scope.runId,job.id,result.cancelled?'cancelled':result.passed?'passed':'failed',result.log,result.cleanupConfirmed);
  }
  const records=ledger.jobs(scope.runId),cleanupConfirmed=records.every(job=>job.cleanupConfirmed),passed=records.every(job=>job.status==='passed')&&cleanupConfirmed&&!input.allowUnisolatedTest;
  const cancelled=ledger.cancelled(scope.runId),terminal=ledger.saveTerminal(scope.runId,{status:cancelled?'cancelled':passed?'passed':'failed',summary:JSON.stringify({workflowDigest:digest,runner:input.allowUnisolatedTest?'unisolated-local-test':'customer-owned-linux-uid',cleanupConfirmed,testHarness:input.allowUnisolatedTest===true,jobs:records.length,passed:records.filter(job=>job.status==='passed').length,logDigest:await cacheDigest(JSON.stringify(records))})}),status=terminal.status;
  const receipt=await report(status,1,terminal.summary);reported=receipt.kind!=='rejected';
  return{scope,status,cleanupConfirmed,reported,jobs:records,receipt};
 }finally{input.signal?.removeEventListener('abort',onAbort);ledger.close();}
}
async function executeJob(input:CustomerCiInput,scope:LocalCiScope,job:ExecutableJob,repoDirectory:string,cacheDirectory:string|undefined,cancelled:()=>boolean){
 const work=mkdtempSync(join(tmpdir(),`flaregit-ci-${scope.runId.replace(/[^A-Za-z0-9]/g,'').slice(0,16)}-`)),checkout=join(work,'checkout'),home=join(work,'home');mkdirSync(home);let boundary:ReturnType<typeof createExecutionBoundary>|undefined;let passed=true,log='',wasCancelled=false,cleanupConfirmed=false;
 try{
  const clone=spawnSync('/usr/bin/git',['clone','--quiet','--no-local','--no-hardlinks','--',repoDirectory,checkout],{env:{PATH:'/usr/bin:/bin',HOME:home,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'},encoding:'utf8'});if(clone.status!==0)throw Error('Disposable CI clone failed');
  git(checkout,'checkout','--quiet','--detach',scope.commit);if(git(checkout,'rev-parse','HEAD')!==scope.commit||git(checkout,'rev-parse','HEAD^{tree}')!==scope.tree)throw Error('CI snapshot differs from frozen commit/tree');rmSync(join(checkout,'.git'),{recursive:true,force:true});
  const key=job.cache?await cacheDigest(`${scope.repositoryId}:${scope.tree}:${scope.workflowDigest}:${job.cache.key}:${JSON.stringify(job.environment)}`):null;
  const cached=key&&cacheDirectory?join(cacheDirectory,key):undefined;
  if(cached&&existsSync(cached)){checkedCache(cached);try{lstatSync(join(checkout,'.ci-cache'));checkedCache(join(checkout,'.ci-cache'));}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}cpSync(cached,join(checkout,'.ci-cache'),{recursive:true});log+='Cache restored for exact tree/workflow/matrix\n';}
  boundary=createExecutionBoundary(work,[checkout,home]);
  for(const step of job.steps){if(cancelled()||input.signal?.aborted){wasCancelled=true;passed=false;break;}const invocation=boundary.command('/usr/bin/env',[...Object.entries(job.environment).map(([key,value])=>`${key}=${value}`),'/bin/sh','-c',step.run]);const result=await runStep(invocation,checkout,executionEnv(home),step.timeoutMs,input.signal,cancelled);log+=`${step.name}: ${result.passed?'passed':'failed'}\n${result.log}\n`;if(!result.passed){passed=false;wasCancelled=result.cancelled;break;}}
  boundary.dispose();cleanupConfirmed=boundary.isolated;boundary=undefined;
  if(passed&&cached&&existsSync(join(checkout,'.ci-cache'))){checkedCache(join(checkout,'.ci-cache'));mkdirSync(cacheDirectory!,{recursive:true,mode:0o700});chmodSync(cacheDirectory!,0o700);if(!existsSync(cached))cpSync(join(checkout,'.ci-cache'),cached,{recursive:true});}
 }catch(error){passed=false;log+=redactSecrets(error instanceof Error?error.message:String(error));}
 finally{try{if(boundary){boundary.dispose();cleanupConfirmed=boundary.isolated;}}catch{cleanupConfirmed=false;passed=false;log+='\nProcess cleanup could not be confirmed';}if(cleanupConfirmed||input.allowUnisolatedTest)rmSync(work,{recursive:true,force:true});else log+='\nWorkspace retained pending confirmed cleanup';}
 return{passed,log:redactSecrets(log).replaceAll(input.secret,'[redacted]').slice(-16000),cancelled:wasCancelled,cleanupConfirmed};
}
async function cacheDigest(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
async function runStep(invocation:{executable:string;args:string[]},cwd:string,env:NodeJS.ProcessEnv,timeoutMs:number,signal:AbortSignal|undefined,cancelled:()=>boolean){return new Promise<{passed:boolean;log:string;cancelled:boolean}>(resolveResult=>{let log='',terminated=false,settled=false;const child=spawn(invocation.executable,invocation.args,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});const stop=()=>{terminated=true;if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};const capture=(bytes:Buffer)=>{log=(log+bytes.toString()).slice(-16000);};child.stdout.on('data',capture);child.stderr.on('data',capture);const timeout=setTimeout(stop,timeoutMs),poll=setInterval(()=>{if(cancelled())stop();},50);signal?.addEventListener('abort',stop,{once:true});const finish=(passed:boolean,error?:string)=>{if(settled)return;settled=true;clearTimeout(timeout);clearInterval(poll);signal?.removeEventListener('abort',stop);if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{}resolveResult({passed,log:redactSecrets(error??log),cancelled:terminated&&(signal?.aborted===true||cancelled())});};child.on('close',code=>finish(code===0&&!terminated));child.on('error',error=>finish(false,error.message));if(signal?.aborted||cancelled())stop();});}
