import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
test('native DO agent issuance fences workflow and withdrawn authority while retaining cleanup and deletion holds',async()=>{
 if(await workerdChild('tests/agent-native-authority.test.ts'))return;
 const output=`/tmp/flaregit-agent-authority-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,'build','tests/support/agent-native-authority-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*',`--outfile=${output}`],{stdout:'ignore',stderr:'pipe'});let script:string;
 try{if(await build.exited!==0)throw Error(await new Response(build.stderr).text());script=await Bun.file(output).text();}finally{if(await Bun.file(output).exists())await Bun.file(output).delete();}
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'agent-authority',modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{REPOSITORY_CONTROLLER:{className:'AgentAuthorityFixture',useSQLite:true}}}]}));
 try{const api=await mf.getWorker('agent-authority');const call=(path:string,body?:unknown)=>api.fetch(`http://test${path}`,{method:'POST',...(body?{body:JSON.stringify(body)}:{})});
 expect((await call('/seed')).status).toBe(200);
 const attempt={workflowId:'run',runId:'run',taskId:'task',phase:'proposal',attemptId:crypto.randomUUID(),nativeId:crypto.randomUUID()};
 expect((await call('/begin',{...attempt,workflowId:'unknown'})).status).toBe(409);
 const begun=await call('/begin',attempt);if(begun.status!==200)throw Error(await begun.text());expect(begun.status).toBe(200);
 expect((await call('/credential',{attemptId:attempt.attemptId,id:crypto.randomUUID(),scope:'write',expiry:Date.now()+300000})).status).toBe(409);
 expect(await(await call('/sweep?status=running')).json()).toEqual({stopCalls:0});
 expect(await(await call('/sweep?status=paused')).json()).toEqual({stopCalls:0});
 expect(await(await call('/sweep?status=complete')).json()).toEqual({stopCalls:1});
 for(let n=0;n<3;n++)await call('/sweep?status=complete');
 expect(await(await call('/sweep?status=complete')).json()).toEqual({stopCalls:4});
 expect(await(await call(`/recover?id=${attempt.attemptId}`)).json()).toEqual({stopped:false,credentialsComplete:true});
 expect(await(await call('/sweep?status=complete')).json()).toEqual({stopCalls:5});
 const id=crypto.randomUUID();expect((await call('/credential',{attemptId:attempt.attemptId,id,scope:'read',expiry:Date.now()+300000})).status).toBe(200);
 expect((await call('/claim')).status).toBe(200);
 await call('/withdraw');expect((await call('/proposal')).status).toBe(409);expect((await call('/credential',{attemptId:attempt.attemptId,id:crypto.randomUUID(),scope:'read',expiry:Date.now()+300000})).status).toBe(409);
 expect((await call('/record',{attemptId:attempt.attemptId,id})).status).toBe(200);
 expect((await call('/destroy')).status).toBe(409);
 }finally{await mf.dispose();}
},30000);
