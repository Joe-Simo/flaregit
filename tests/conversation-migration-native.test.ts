import {expect,test} from 'bun:test';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {workerdChild} from './support/workerd-child';
test('native owner conversation migration stages before publication, recovers lost capture ACK, and exposes unclaimed source attribution',async()=>{
 if(await workerdChild('tests/conversation-migration-native.test.ts'))return;
 const output=`/tmp/flaregit-conversation-migration-${crypto.randomUUID()}.js`,build=Bun.spawn([process.execPath,'build','tests/support/conversation-migration-worker.ts','--target=browser','--external=cloudflare:workers','--external=node:*',`--outfile=${output}`],{stdout:'ignore',stderr:'pipe'});let script:string;
 try{if(await build.exited!==0)throw Error(await new Response(build.stderr).text());script=await Bun.file(output).text();}finally{if(await Bun.file(output).exists())await Bun.file(output).delete();}
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'migration-native',modules:true,script,compatibilityDate:'2026-10-02',compatibilityFlags:['nodejs_compat'],durableObjects:{REPOSITORY_CONTROLLER:{className:'ConversationMigrationFixture',useSQLite:true}}}]}));
 try{const api=await mf.getWorker('migration-native'),call=(path:string,body?:unknown)=>api.fetch(`http://test${path}`,{method:'POST',...(body?{body:JSON.stringify(body)}:{})});
 expect((await call('/seed')).status).toBe(200);expect((await call('/begin?actor=other')).status).toBe(409);const begun=await call('/begin');if(begun.status!==200)throw Error(await begun.text());expect(begun.status).toBe(200);
 await call('/budget?reason=unconfigured');expect(await(await call('/rpc-capture')).json()).toEqual({ok:false,failure:{code:'read_budget_unconfigured'}});expect(await(await call('/reads')).json()).toEqual({reads:0});
 await call('/budget?reason=account_budget');expect(await(await call('/rpc-capture')).json()).toEqual({ok:false,failure:{code:'read_budget_exhausted'}});expect(await(await call('/reads')).json()).toEqual({reads:0});await call('/budget?reason=none');
 await call('/mode?failure=rate_limited');const limited=await(await call('/rpc-capture')).json();expect(limited).toEqual({ok:false,failure:{code:'rate_limited',retryAfterSeconds:5}});expect(JSON.stringify(limited)).not.toContain('untrusted provider body');
 await call('/mode?failure=timeout');expect(await(await call('/rpc-capture')).json()).toEqual({ok:false,failure:{code:'timeout'}});
 await call('/mode?failure=none');
 const captured=await call('/capture');if(captured.status!==200)throw Error(`${await captured.text()} ${JSON.stringify(await(await call('/reads')).json())}`);expect(captured.status).toBe(200);expect(await(await call('/issues')).json()).toEqual([]);expect(await(await call('/reads')).json()).toEqual({reads:4});
 expect((await call('/capture')).status).toBe(200);expect(await(await call('/reads')).json()).toEqual({reads:4});
 const manifest=await(await call('/manifest')).json() as {manifest:{hash:string;revision:number}};const request={eventId:crypto.randomUUID(),expectedRevision:manifest.manifest.revision,manifestHash:manifest.manifest.hash};
 expect((await call('/publish?actor=other',request)).status).toBe(409);const first=await(await call('/publish',request)).json();expect(await(await call('/publish',request)).json()).toEqual(first);await call('/publish',{...request,eventId:crypto.randomUUID()});
 const issues=await(await call('/issues')).json() as Array<{author:string;importedOrigin:{identity:string;nativeUserId:null;sourceUrl:string}}>;expect(issues).toHaveLength(1);expect(issues[0]?.author).toBe('GitHub @external-person (external, unclaimed)');expect(issues[0]?.importedOrigin).toMatchObject({identity:'external-unclaimed',nativeUserId:null,sourceUrl:'https://github.com/owner/repo/issues/1'});
 const listed=await(await call('/list')).json() as {operations:Array<{publication:{phase:string}}>} ;expect(listed.operations[0]?.publication.phase).toBe('complete');
 }finally{await mf.dispose();}
},30000);
