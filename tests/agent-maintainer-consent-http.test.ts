import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
test('native maintainer lineage cannot resume after creator consent revocation and regrant',async()=>{
 if(await workerdChild('tests/agent-maintainer-consent-http.test.ts'))return;
 const output=`/tmp/flaregit-agent-authority-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,'build','tests/support/agent-native-authority-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*',`--outfile=${output}`],{stdout:'ignore',stderr:'pipe'});let script:string;
 try{if(await build.exited!==0)throw Error(await new Response(build.stderr).text());script=await Bun.file(output).text();}finally{if(await Bun.file(output).exists())await Bun.file(output).delete();}
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'agent-authority',modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{REPOSITORY_CONTROLLER:{className:'AgentAuthorityFixture',useSQLite:true}}}]}));
 try{const api=await mf.getWorker('agent-authority');const call=(path:string,body?:unknown)=>api.fetch(`http://test${path}`,{method:'POST',...(body?{body:JSON.stringify(body)}:{})});
 expect((await call('/seed-maintainer')).status).toBe(200);expect((await call('/claim')).status).toBe(200);
 const attempt={workflowId:'run',runId:'run',taskId:'task',phase:'proposal',attemptId:crypto.randomUUID(),nativeId:crypto.randomUUID()};
 const begun=await call('/begin',attempt);expect(begun.status).toBe(200);expect(await begun.json()).toMatchObject({maintainerWriteSource:{creatorId:'creator',revision:1}});
 expect((await call('/proposal')).status).toBe(200);
 expect((await call('/consent',{enabled:false,expectedRevision:1})).status).toBe(200);
 expect((await call('/consent',{enabled:true,expectedRevision:2})).status).toBe(200);
 expect((await call('/proposal')).status).toBe(409);
 expect((await call('/credential',{attemptId:attempt.attemptId,id:crypto.randomUUID(),scope:'read',expiry:Date.now()+300000})).status).toBe(409);
 }finally{await mf.dispose();}
},30000);
