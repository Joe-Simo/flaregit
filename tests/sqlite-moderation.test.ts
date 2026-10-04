import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
import type {PublicationModerationDecision,PublicationModerationState} from '../src/server/publication-moderation';
const decision=(action:'suppress'|'lift',expectedVersion:number,key:string)=>({action,confirmed:true,reason:'Reviewed impersonation report',reportId:'report-one',expectedVersion,idempotencyKey:key});
test('native moderation decisions preserve identity, CAS, history and atomic rollback',async()=>{
 if(await workerdChild('tests/sqlite-moderation.test.ts'))return;
 const build=await Bun.build({entrypoints:['tests/support/sqlite-moderation-worker.ts'],target:'browser',external:['cloudflare:workers','node:crypto']});if(!build.success)throw new Error(String(build.logs));
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'moderation-test',modules:true,script:await build.outputs[0]!.text(),compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{TEST:{className:'ModerationFixture',useSQLite:true}},queueProducers:['INTEGRATION_QUEUE']}]}));
 const request=async(path:string,body?:unknown)=>(await mf.getWorker('moderation-test')).fetch(`http://test${path}`,body?{method:'POST',body:JSON.stringify(body)}:undefined);
 try{
 const input=decision('suppress',0,'suppress-one');const saved=await(await request('/ledger',input)).json() as PublicationModerationDecision;
 expect(saved).toMatchObject({operatorAccountKey:'exact-account',version:1,suppressed:true});
 expect(await(await request('/ledger',input)).json()).toEqual(saved);
 expect((await request('/ledger?operator=different-account',input)).status).toBe(409);
 expect((await request('/ledger',{...input,reason:'Changed reason'})).status).toBe(409);
 expect((await request('/ledger',decision('lift',0,'stale-one'))).status).toBe(409);
 expect((await request('/ledger?fail=true',decision('lift',1,'rollback-one'))).status).toBe(409);
 const rolledBack=await(await request('/ledger-state')).json() as {state:PublicationModerationState;history:PublicationModerationDecision[]};expect(rolledBack.state.version).toBe(1);expect(rolledBack.history).toEqual([saved]);
 const lifted=await(await request('/ledger',decision('lift',1,'rollback-one'))).json() as PublicationModerationDecision;expect(lifted).toMatchObject({version:2,suppressed:false});
 expect((await(await request('/ledger-state')).json() as typeof rolledBack).history).toEqual([lifted,saved]);
 const project={projectId:'test',projectName:'Test',canonicalRepoName:'test',policyVersion:1,verificationPolicy:{},decisions:{},evidence:{},acceptedState:{currentCommit:'a'.repeat(40),buildDigest:'build',activeRequirements:[],history:[]},tasks:{},candidates:{},journal:[]};
 await request('/seed',project);const initial=await(await request('/repo-public')).json() as {grant:{version:number}|null;rows:Array<{version:number}>};expect(initial.grant?.version).toBe(1);
 const repoInput=decision('suppress',0,'repo-suppress');expect((await request('/repo-moderate',repoInput)).status).toBe(200);
 const suppressed=await(await request('/repo-state')).json() as typeof initial;expect(suppressed.grant).toBeNull();expect(suppressed.rows[0]?.version).toBe(2);
 expect((await request('/repo-public')).status).toBe(409);await request('/repo-moderate',repoInput);expect((await(await request('/repo-state')).json() as typeof initial).rows[0]?.version).toBe(2);
 expect((await request('/repo-moderate',decision('lift',1,'repo-lift'))).status).toBe(200);expect((await(await request('/repo-state')).json() as typeof initial).rows[0]?.version).toBe(3);
 await request('/profile-save');await request('/profile-public?version=1');await request('/profile-moderate',decision('suppress',0,'profile-suppress'));
 const profile=await(await request('/profile-state')).json() as {version:number;moderation:PublicationModerationState};expect(profile.version).toBe(3);expect(profile.moderation.suppressed).toBe(true);
 expect((await request('/profile-public?version=3')).status).toBe(409);
 await request('/profile-moderate',decision('lift',1,'profile-lift'));expect((await(await request('/profile-state')).json() as typeof profile).version).toBe(4);
 expect((await request('/profile-public?version=4')).status).toBe(200);
 }finally{await mf.dispose();}
},30000);
