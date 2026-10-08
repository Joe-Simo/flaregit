import {expect,test} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runCustomerCi,type CustomerCiInput} from '../src/cli/customer-ci';
import {executableJobs,workflowDigest} from '../src/core/ci-workflow';
import {LocalCiLedger} from '../src/cli/ci-ledger';
const workflow={name:'verify',triggers:['pull_request'],jobs:[{name:'test',matrix:{VERSION:['one','two']},steps:[{name:'snapshot',run:'test "$(cat proof.txt)" = frozen && test -z "$FLAREGIT_CONNECTION_SECRET" && test ! -e .git && echo "$VERSION"'}]}]};
function fixture(cacheTarget?:string){
 const directory=mkdtempSync(join(tmpdir(),'customer-ci-test-')),repo=join(directory,'repo');
 const git=(...args:string[])=>{const result=spawnSync('/usr/bin/git',args,{encoding:'utf8',env:{PATH:'/usr/bin:/bin',HOME:directory,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});if(result.status!==0)throw Error(result.stderr);return result.stdout.trim();};
 git('init','-q',repo);writeFileSync(join(repo,'proof.txt'),'frozen');if(cacheTarget)symlinkSync(cacheTarget,join(repo,'.ci-cache'));git('-C',repo,'add','.');git('-C',repo,'-c','user.name=Test','-c','user.email=test@example.com','commit','-qm','snapshot');
 const commit=git('-C',repo,'rev-parse','HEAD'),tree=git('-C',repo,'rev-parse','HEAD^{tree}');writeFileSync(join(repo,'proof.txt'),'dirty host checkout');
 const reports:Array<Record<string,unknown>>=[];let sequence=-1,status='queued',rejectClaim=false,loseTerminal=false;
 const input:Omit<CustomerCiInput,'approvedDigest'>={origin:'https://flaregit.example',repositoryId:'p123456789abc',serviceId:'svc_12345678-1234-1234-1234-123456789abc',candidateId:'candidate-one',checkId:'check-one',commit,secret:'service-secret-'+ 'x'.repeat(32),repoDirectory:repo,workflow,ledgerPath:join(directory,'ledger.sqlite'),allowUnisolatedTest:true,fetcher:async(_url,options)=>{
  if(options?.method==='GET')return Response.json({repositoryId:'p123456789abc',candidateId:'candidate-one',commit,tree,policyVersion:1,checks:[{id:'check-one',required:true,run:{id:'run-one',checkId:'check-one',sequence,status}}]});
  const payload=JSON.parse(String(options?.body)) as {report:Record<string,unknown>};reports.push(payload.report);
  if(rejectClaim&&payload.report.status==='running')return Response.json({kind:'rejected'});
  sequence=Number(payload.report.sequence);status=String(payload.report.status);
  if(loseTerminal&&sequence===1){loseTerminal=false;throw Error('Lost delivery receipt');}
  return Response.json({kind:'applied'});
 }};
 return{directory,input,tree,reports,setReject(){rejectClaim=true;},setLost(){loseTerminal=true;},cleanup(){rmSync(directory,{recursive:true,force:true});}};
}
test('finite dialect expands all dependency matrices and rejects cycles/control variable replacement',()=>{
 const parsed=executableJobs({...workflow,jobs:[{name:'after',needs:['test'],steps:[{name:'done',run:'true'}]},...workflow.jobs]});
 expect(parsed.jobs.map(job=>job.id)).toEqual(['test.0','test.1','after.0']);expect(parsed.jobs[2]!.dependencies).toEqual(['test.0','test.1']);
 expect(()=>executableJobs({...workflow,jobs:[{name:'test',needs:['test'],steps:[{name:'bad',run:'true'}]}]})).toThrow('cycle');
 expect(()=>executableJobs({...workflow,jobs:[{...workflow.jobs[0],matrix:{PATH:['/tmp']}}]})).toThrow('control variables');
});
test('real disposable frozen Git execution isolates matrix and credentials; local harness never attests pass',async()=>{
 const f=fixture();try{const result=await runCustomerCi({...f.input,approvedDigest:await workflowDigest(workflow)});expect(result.jobs.map(job=>job.status)).toEqual(['passed','passed']);expect(result.jobs[0]!.log).toContain('one');expect(result.jobs[1]!.log).toContain('two');expect(result.status).toBe('failed');expect(result.cleanupConfirmed).toBe(false);expect(f.reports.map(report=>report.status)).toEqual(['running','failed']);}finally{f.cleanup();}
},30000);
test('lost terminal receipt retries unchanged metadata without executing commands twice',async()=>{
 const f=fixture();try{f.setLost();const approvedDigest=await workflowDigest(workflow);await expect(runCustomerCi({...f.input,approvedDigest})).rejects.toThrow('Lost');const result=await runCustomerCi({...f.input,approvedDigest});expect(result.status).toBe('failed');expect(f.reports).toHaveLength(3);expect(f.reports[1]).toEqual(f.reports[2]);}finally{f.cleanup();}
},30000);
test('failed dependency skips child execution and records terminal failure',async()=>{
 const f=fixture();try{const definition={name:'failure',triggers:['push'],jobs:[{name:'fail',steps:[{name:'exit',run:'exit 2'}]},{name:'dependent',needs:['fail'],steps:[{name:'never',run:'echo should-not-run'}]}]};const result=await runCustomerCi({...f.input,workflow:definition,approvedDigest:await workflowDigest(definition)});expect(result.jobs.every(job=>job.status==='failed')).toBe(true);expect(result.jobs.find(job=>job.id==='dependent.0')!.log).toContain('dependency');}finally{f.cleanup();}
},30000);
test('timeout kills real shell; abort cancels queued work and reports cancellation',async()=>{
 const f=fixture();try{const definition={name:'timeout',triggers:['push'],jobs:[{name:'wait',steps:[{name:'wait',run:'sleep 10',timeoutMs:30}]}]};const result=await runCustomerCi({...f.input,workflow:definition,approvedDigest:await workflowDigest(definition)});expect(result.jobs[0]!.status).toBe('failed');}finally{f.cleanup();}
 const next=fixture();try{const signal=AbortSignal.abort();const result=await runCustomerCi({...next.input,signal,approvedDigest:await workflowDigest(workflow)});expect(result.status).toBe('cancelled');expect(result.jobs.every(job=>job.status==='cancelled')).toBe(true);}finally{next.cleanup();}
},30000);
test('rejected provider execution claim performs no jobs; digest and unsupported host fail before service dispatch',async()=>{
 const f=fixture();try{f.setReject();await expect(runCustomerCi({...f.input,approvedDigest:await workflowDigest(workflow)})).rejects.toThrow('rejected execution claim');const ledger=new LocalCiLedger(f.input.ledgerPath);try{expect(ledger.jobs('run-one').every(job=>job.status==='queued')).toBe(true);}finally{ledger.close();}
 await expect(runCustomerCi({...f.input,approvedDigest:'wrong'})).rejects.toThrow('owner-approved');if(process.platform!=='linux'||process.getuid?.()!==0)await expect(runCustomerCi({...f.input,approvedDigest:await workflowDigest(workflow),allowUnisolatedTest:false})).rejects.toThrow('requires Linux');}finally{f.cleanup();}
},30000);
const isolatedHost=process.platform==='linux'&&process.getuid?.()===0;
test.skipIf(!isolatedHost)('Linux UID runner attests exact tree only after daemonized descendants are confirmed dead',async()=>{
 const f=fixture();try{
  const definition={name:'isolated',triggers:['pull_request'],jobs:[{name:'check',steps:[{name:'isolate',run:'set -e; test "$(id -u)" -ne 0; test "$(cat proof.txt)" = frozen; test -z "$FLAREGIT_CONNECTION_SECRET"; sleep 600 >/dev/null 2>&1 &'}]}]};
  const result=await runCustomerCi({...f.input,allowUnisolatedTest:false,workflow:definition,approvedDigest:await workflowDigest(definition)});
  expect(result.status).toBe('passed');expect(result.cleanupConfirmed).toBe(true);expect(result.jobs[0]!.cleanupConfirmed).toBe(true);expect(result.reported).toBe(true);
 }finally{f.cleanup();}
},30000);

test('cache restore refuses contributor symlinks before privileged copies',async()=>{
 const f=fixture(tmpdir());try{
  const definition={name:'cache',triggers:['push'],jobs:[{name:'check',cache:{key:'deps',path:'.ci-cache'},steps:[{name:'never',run:'echo should-not-run'}]}]},approvedDigest=await workflowDigest(definition),key=new Bun.CryptoHasher('sha256').update(`${f.input.repositoryId}:${f.tree}:${approvedDigest}:deps:{}`).digest('hex'),cacheDirectory=join(f.directory,'cache');
  mkdirSync(join(cacheDirectory,key),{recursive:true});writeFileSync(join(cacheDirectory,key,'proof'),'cached');
  const result=await runCustomerCi({...f.input,workflow:definition,approvedDigest,cacheDirectory});expect(result.jobs[0]!.status).toBe('failed');expect(result.jobs[0]!.log).toContain('ordinary files');
 }finally{f.cleanup();}
},30000);

test('resume skips an already finished job and executes only its queued dependent',async()=>{
 const f=fixture();try{
  const definition={name:'resume',triggers:['push'],jobs:[{name:'finished',steps:[{name:'never-replay',run:'exit 99'}]},{name:'queued',needs:['finished'],steps:[{name:'snapshot',run:'test "$(cat proof.txt)" = frozen && echo queued-job-ran'}]}]},approvedDigest=await workflowDigest(definition);
  const ledger=new LocalCiLedger(f.input.ledgerPath);try{ledger.initialize({repositoryId:f.input.repositoryId,candidateId:f.input.candidateId,commit:f.input.commit,tree:f.tree,policyVersion:1,runId:'run-one',checkId:f.input.checkId,workflowDigest:approvedDigest},executableJobs(definition).jobs);ledger.finish('run-one','finished.0','passed','Original finished receipt',true);}finally{ledger.close();}
  const result=await runCustomerCi({...f.input,workflow:definition,approvedDigest});expect(result.jobs.map(job=>job.status)).toEqual(['passed','passed']);expect(result.jobs[0]!.log).toBe('Original finished receipt');expect(result.jobs[1]!.log).toContain('queued-job-ran');expect(result.status).toBe('failed');
 }finally{f.cleanup();}
},30000);
test('resume refuses a persisted running claim and leaves queued work untouched',async()=>{
 const f=fixture();try{
  const approvedDigest=await workflowDigest(workflow),ledger=new LocalCiLedger(f.input.ledgerPath);try{ledger.initialize({repositoryId:f.input.repositoryId,candidateId:f.input.candidateId,commit:f.input.commit,tree:f.tree,policyVersion:1,runId:'run-one',checkId:f.input.checkId,workflowDigest:approvedDigest},executableJobs(workflow).jobs);expect(ledger.claim('run-one','test.0')).toBe(true);}finally{ledger.close();}
  await expect(runCustomerCi({...f.input,approvedDigest})).rejects.toThrow('cleanup inspection');const saved=new LocalCiLedger(f.input.ledgerPath);try{expect(saved.jobs('run-one').map(job=>job.status)).toEqual(['running','queued']);}finally{saved.close();}expect(f.reports).toEqual([]);
 }finally{f.cleanup();}
},30000);
