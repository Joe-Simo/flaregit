import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
test('native delegated human approvals preserve owner history authority and disappear from gates after revocation',async()=>{
 if(await workerdChild('tests/delegated-review-native.test.ts'))return;
 const output=`/tmp/flaregit-delegated-review-${crypto.randomUUID()}.js`,build=Bun.spawn([process.execPath,'build','tests/support/delegated-review-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*',`--outfile=${output}`],{stdout:'ignore',stderr:'pipe'});let script:string;
 try{if(await build.exited!==0)throw Error(await new Response(build.stderr).text());script=await Bun.file(output).text();}finally{if(await Bun.file(output).exists())await Bun.file(output).delete();}
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'delegated-review',modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{REPOSITORY_CONTROLLER:{className:'DelegatedReviewFixture',useSQLite:true}}}]}));
 try{const api=await mf.getWorker('delegated-review'),call=(path:string)=>api.fetch(`http://test${path}`,{method:'POST'});expect((await call('/seed')).status).toBe(200);
 expect((await call('/policy?actor=reviewer')).status).toBe(409);expect((await call('/policy')).status).toBe(200);expect((await call('/grant')).status).toBe(200);
 expect((await call('/review?actor=outsider')).status).toBe(409);expect((await call('/review?actor=reviewer')).status).toBe(200);
 const report=await(await call('/report?actor=reviewer')).json() as {gate:{passed:boolean};history:{reviews:unknown[]}};expect(report.gate.passed).toBe(true);expect(report.history.reviews).toHaveLength(1);
 const state=await(await call('/state')).json() as {acceptedState:{currentCommit:string};candidates:Record<string,{status:string;review?:unknown}>};expect(state.acceptedState.currentCommit).toBe('a'.repeat(40));expect(state.candidates['candidate-one']).toMatchObject({status:'awaiting_review'});expect(state.candidates['candidate-one']?.review).toBeUndefined();
 expect((await call('/revoke')).status).toBe(200);const revoked=await(await call('/report?actor=reviewer')).json() as typeof report;expect(revoked.gate.passed).toBe(false);expect(revoked.history.reviews).toHaveLength(1);
 expect((await call('/policy-two')).status).toBe(200);const obsolete=await(await call('/report?actor=reviewer')).json() as typeof report;expect(obsolete.gate.passed).toBe(false);expect(obsolete.history.reviews).toHaveLength(1);
 }finally{await mf.dispose();}
},30000);
