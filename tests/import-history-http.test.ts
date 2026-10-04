import { workerdChild } from "./support/workerd-child";
import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {generateKeyPair,exportJWK,SignJWT} from "jose";


test("native import inspection HTTP retains dispatch identity and SQL recovery",async()=>{
 if(await workerdChild('tests/import-history-http.test.ts', 'native import inspection HTTP retains dispatch identity and SQL recovery'))return;
 const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"task-replay",alg:"RS256",use:"sig"};
 const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/flaregit-task-replay-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/import-history-http-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
 const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"task-replay",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin,FREE_RUNS_PER_DAY:"100"},durableObjects:{REPOSITORY_CONTROLLER:{className:"HistoryHttpFixture",useSQLite:true},INTEGRATOR:{className:"HistoryNativeFixture",useSQLite:true}}}]}));
 const direct=await mf.unsafeGetDirectURL("task-replay");
 const call=(path:string,token?:string,payload?:unknown,method?:string)=>fetch(new URL(path,direct),{method:method??(payload?"POST":"GET"),headers:{Connection:"close","CF-Connecting-IP":"198.51.100.26",...(token?{Authorization:`Bearer ${token}`}:{ }),...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
 const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
 const route="/api/p/p123456789abc/import-history";
 type Operation={instanceId:string};type Snapshot={instanceId:string;attemptGeneration:number;authority:string;reason:string;receipt:unknown};
 const calls=async()=>await(await call('/fixture/calls')).json() as string[];
 try{
 const seed=await(await call('/fixture/seed')).json() as {token:string;tokenId:string};const owner=await session('owner'),member=await session('member');
 expect((await call(route,undefined,{})).status).toBe(401);expect((await call(route,member,{})).status).toBe(403);
 const fresh=await call(route,owner,{});expect(fresh.status).toBe(202);const freshBody=await fresh.json() as Snapshot;expect(freshBody.authority).toBe('durable-sql');expect(freshBody.attemptGeneration).toBe(1);await call('/fixture/reset');
 const operation=await(await call('/fixture/claim')).json() as Operation;
 const first=await call(route,owner,{instanceId:operation.instanceId});expect(first.status).toBe(202);const firstBody=await first.json() as Snapshot;expect(firstBody.attemptGeneration).toBe(1);expect(firstBody.authority).toBe('durable-sql');
 expect((await calls()).filter(x=>x.startsWith('create:'))).toEqual([`create:${operation.instanceId}`]);
 const second=await call(route,owner,{instanceId:operation.instanceId,expectedGeneration:1});expect(second.status).toBe(202);expect((await second.json() as Snapshot).attemptGeneration).toBe(1);expect((await calls()).filter(x=>x.startsWith('create:'))).toEqual([`create:${operation.instanceId}`,`create:${operation.instanceId}`]);
 expect((await call(route,owner,{instanceId:operation.instanceId,expectedGeneration:99})).status).toBe(409);
 await call(`/fixture/expire?id=${operation.instanceId}`);const before=(await calls()).filter(x=>x.startsWith('create:'));expect((await call(route,owner,{instanceId:operation.instanceId,expectedGeneration:1})).status).toBe(202);expect((await calls()).filter(x=>x.startsWith('create:'))).toEqual(before);
 await call(`/fixture/verified?id=${operation.instanceId}`);const read=await call(`${route}/${operation.instanceId}`,owner);expect(read.status).toBe(200);const receipt=await read.json() as Snapshot;expect(receipt.authority).toBe('durable-sql');expect(receipt.receipt).not.toBeNull();expect(await calls()).not.toContain('R2.get');expect(await calls()).not.toContain('VM');expect(await calls()).not.toContain('artifact');
 await call(`/fixture/legacy?id=${operation.instanceId}`);const legacy=await call(route,owner,{instanceId:operation.instanceId});expect(legacy.status).toBe(202);expect((await legacy.json() as Snapshot).reason).toBe('legacy_attempt_untracked');expect((await calls()).filter(x=>x.startsWith('create:'))).toEqual(before);
 await call('/fixture/reset');const predecessor=await(await call('/fixture/claim')).json() as Operation;await call(route,owner,{instanceId:predecessor.instanceId});await call(`/fixture/native-possible?id=${predecessor.instanceId}`);const oldAttempt=await(await call(`/fixture/pause-native?id=${predecessor.instanceId}`)).json() as {nativeRunId:string};await call('/fixture/drift');
 const successorRequest={predecessorId:predecessor.instanceId,expectedGeneration:1};const dispatchBefore=(await calls()).filter(value=>value.startsWith('create:')).length;
 expect((await call(route,owner,{...successorRequest,expectedGeneration:2})).status).toBe(409);expect((await call(route,owner,successorRequest)).status).toBe(409);expect((await calls()).filter(value=>value.startsWith('create:'))).toHaveLength(dispatchBefore);
 await call('/fixture/status?value=terminated');expect((await call(route,owner,successorRequest)).status).toBe(409);expect((await calls()).filter(value=>value.startsWith('create:'))).toHaveLength(dispatchBefore);await call('/fixture/native-stopped?id='+oldAttempt.nativeRunId);const oldRead=await call(`${route}/${predecessor.instanceId}`,owner);expect(oldRead.status).toBe(200);expect(await oldRead.json()).toMatchObject({scopeChanged:true,canResume:false,canStartSuccessor:true,attemptGeneration:1});
 const successor=await call(route,owner,successorRequest);expect(successor.status).toBe(202);const successorBody=await successor.json() as Snapshot&{predecessorId:string};expect(successorBody.predecessorId).toBe(predecessor.instanceId);expect(successorBody.instanceId).not.toBe(predecessor.instanceId);expect(successorBody.attemptGeneration).toBe(1);
 const repeated=await call(route,owner,successorRequest);expect(repeated.status).toBe(202);expect((await repeated.json() as Snapshot).instanceId).toBe(successorBody.instanceId);expect((await call(`${route}/${predecessor.instanceId}`,owner)).status).toBe(200);
 await call(`/fixture/revoke?id=${seed.tokenId}`);expect((await call(`${route}/${operation.instanceId}`,seed.token)).status).toBe(401);
 await call('/fixture/remove-owner');expect([403,404]).toContain((await call(`${route}/${operation.instanceId}`,owner)).status);await call('/fixture/restore-owner');
 await call('/fixture/seal');expect([403,409]).toContain((await call(`${route}/${operation.instanceId}`,owner)).status);
 }finally{await mf.dispose();issuer.stop(true);}
},30000);

test("native inspection lifecycle cleanup uses latest attempt and holds unknown shutdown",async()=>{
 if(await workerdChild('tests/import-history-http.test.ts', 'native inspection lifecycle cleanup uses latest attempt and holds unknown shutdown'))return;
 const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"task-replay",alg:"RS256",use:"sig"};
 const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/flaregit-task-replay-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/import-history-http-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
 const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"task-replay",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:"HistoryHttpFixture",useSQLite:true},INTEGRATOR:{className:"HistoryNativeFixture",useSQLite:true}}}]}));
 const direct=await mf.unsafeGetDirectURL("task-replay");
 const call=(path:string,token?:string,payload?:unknown,method?:string)=>fetch(new URL(path,direct),{method:method??(payload?"POST":"GET"),headers:{Connection:"close","CF-Connecting-IP":"198.51.100.26",...(token?{Authorization:`Bearer ${token}`}:{ }),...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
 const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
 const route='/api/p/p123456789abc';
 try{const owner=await session('owner');await call('/fixture/seed');const operation=await(await call('/fixture/claim')).json() as {instanceId:string};const latest=await(await call(`/fixture/cleanup-attempt?id=${operation.instanceId}&mode=unknown`)).json() as {workflowId:string;generation:number};expect(latest.generation).toBe(2);expect(latest.workflowId).not.toBe(operation.instanceId);
 const deletion=await call(route,owner,{},'DELETE');expect(deletion.status).toBe(202);const calls=await(await call('/fixture/calls')).json() as string[];expect(calls).toContain(`status:${latest.workflowId}`);expect(calls).not.toContain(`status:${operation.instanceId}`);expect(calls).not.toContain('Artifact.delete');expect(calls).not.toContain('R2.delete');expect(calls).not.toContain('VM');
 }finally{await mf.dispose();issuer.stop(true);}
},30000);

test("saved unallocated cleanup avoids Workflow and VM allocation",async()=>{
 if(await workerdChild('tests/import-history-http.test.ts', 'saved unallocated cleanup avoids Workflow and VM allocation'))return;
 const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"task-replay",alg:"RS256",use:"sig"};
 const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/flaregit-task-replay-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/import-history-http-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
 const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"task-replay",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:"HistoryHttpFixture",useSQLite:true},INTEGRATOR:{className:"HistoryNativeFixture",useSQLite:true}}}]}));
 const direct=await mf.unsafeGetDirectURL("task-replay");
 const call=(path:string,token?:string,payload?:unknown,method?:string)=>fetch(new URL(path,direct),{method:method??(payload?"POST":"GET"),headers:{Connection:"close","CF-Connecting-IP":"198.51.100.26",...(token?{Authorization:`Bearer ${token}`}:{ }),...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
 const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
 const route="/api/p/p123456789abc";
 try{const owner=await session('owner');await call('/fixture/seed');const operation=await(await call('/fixture/claim')).json() as {instanceId:string};const latest=await(await call(`/fixture/cleanup-attempt?id=${operation.instanceId}&mode=saved`)).json() as {workflowId:string;generation:number};await call('/fixture/status?value=unavailable');
 const deletion=await call(route,owner,{},'DELETE');expect(deletion.status).toBe(202);const calls=await(await call('/fixture/calls')).json() as string[];
 expect(calls.filter(x=>x.startsWith('status:')||x.startsWith('terminate:'))).toEqual([]);expect(calls).not.toContain('VM');
 }finally{await mf.dispose();issuer.stop(true);}
},30000);

test("account cleanup preserves unknown latest attempt",async()=>{
 if(await workerdChild('tests/import-history-http.test.ts', 'account cleanup preserves unknown latest attempt'))return;
 const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"task-replay",alg:"RS256",use:"sig"};
 const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/flaregit-task-replay-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/import-history-http-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
 const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"task-replay",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:"HistoryHttpFixture",useSQLite:true},INTEGRATOR:{className:"HistoryNativeFixture",useSQLite:true}}}]}));
 const direct=await mf.unsafeGetDirectURL("task-replay");
 const call=(path:string,token?:string,payload?:unknown,method?:string)=>fetch(new URL(path,direct),{method:method??(payload?"POST":"GET"),headers:{Connection:"close","CF-Connecting-IP":"198.51.100.26",...(token?{Authorization:`Bearer ${token}`}:{ }),...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
 const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
 const route="/api/account";
 try{const owner=await session('owner');await call('/fixture/seed');const operation=await(await call('/fixture/claim')).json() as {instanceId:string};const latest=await(await call(`/fixture/cleanup-attempt?id=${operation.instanceId}&mode=unknown`)).json() as {workflowId:string;generation:number};await call('/fixture/status?value=unavailable');
 const deletion=await call(route,owner,{confirm:"delete my account"},'DELETE');expect(deletion.status).toBe(202);const calls=await(await call('/fixture/calls')).json() as string[];
 expect(calls).toContain(`status:${latest.workflowId}`);expect(calls).not.toContain(`status:${operation.instanceId}`);expect(calls).not.toContain('Artifact.delete');expect(calls).not.toContain('R2.delete');
 }finally{await mf.dispose();issuer.stop(true);}
},30000);

test("unconfirmed native stop retains repository storage",async()=>{
 if(await workerdChild('tests/import-history-http.test.ts', 'unconfirmed native stop retains repository storage'))return;
 const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"task-replay",alg:"RS256",use:"sig"};
 const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/flaregit-task-replay-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/import-history-http-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
 const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"task-replay",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:"HistoryHttpFixture",useSQLite:true},INTEGRATOR:{className:"HistoryNativeFixture",useSQLite:true}}}]}));
 const direct=await mf.unsafeGetDirectURL("task-replay");
 const call=(path:string,token?:string,payload?:unknown,method?:string)=>fetch(new URL(path,direct),{method:method??(payload?"POST":"GET"),headers:{Connection:"close","CF-Connecting-IP":"198.51.100.26",...(token?{Authorization:`Bearer ${token}`}:{ }),...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
 const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
 const route="/api/p/p123456789abc";
 try{const owner=await session('owner');await call('/fixture/seed');const operation=await(await call('/fixture/claim')).json() as {instanceId:string};const latest=await(await call(`/fixture/cleanup-attempt?id=${operation.instanceId}&mode=native-unknown`)).json() as {workflowId:string;generation:number};await call('/fixture/status?value=running');
 const deletion=await call(route,owner,{},'DELETE');expect(deletion.status).toBe(202);const calls=await(await call('/fixture/calls')).json() as string[];
 expect(calls).toContain(`status:${latest.workflowId}`);expect(calls).not.toContain(`status:${operation.instanceId}`);expect(calls).not.toContain('Artifact.delete');expect(calls).not.toContain('R2.delete');expect(calls).toContain(`terminate:${latest.workflowId}`);
 }finally{await mf.dispose();issuer.stop(true);}
},30000);

test("protocol2 claim before begin remains deletable without allocating inspection",async()=>{
 if(await workerdChild('tests/import-history-http.test.ts', 'protocol2 claim before begin remains deletable without allocating inspection'))return;
 const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"task-replay",alg:"RS256",use:"sig"};
 const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/flaregit-task-replay-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/import-history-http-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
 const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"task-replay",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:"HistoryHttpFixture",useSQLite:true},INTEGRATOR:{className:"HistoryNativeFixture",useSQLite:true}}}]}));
 const direct=await mf.unsafeGetDirectURL("task-replay");
 const call=(path:string,token?:string,payload?:unknown,method?:string)=>fetch(new URL(path,direct),{method:method??(payload?"POST":"GET"),headers:{Connection:"close","CF-Connecting-IP":"198.51.100.26",...(token?{Authorization:`Bearer ${token}`}:{ }),...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
 const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
 const route='/api/account';
 try{const owner=await session('owner');await call('/fixture/seed');await call('/fixture/claim');const deletion=await call(route,owner,{confirm:'delete my account'},'DELETE');expect(deletion.status).toBe(202);const calls=await(await call('/fixture/calls')).json() as string[];expect(calls.filter(x=>x.startsWith('status:')||x.startsWith('terminate:'))).toEqual([]);expect(calls).not.toContain('VM');expect(calls).toContain('Artifact.delete');
 }finally{await mf.dispose();issuer.stop(true);}
},30000);

test("owner status recovers exact stopped native attempt before resuming",async()=>{
 if(await workerdChild('tests/import-history-http.test.ts', 'owner status recovers exact stopped native attempt before resuming'))return;
 const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"task-replay",alg:"RS256",use:"sig"};
 const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/flaregit-task-replay-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/import-history-http-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
 const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"task-replay",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:"HistoryHttpFixture",useSQLite:true},INTEGRATOR:{className:"HistoryNativeFixture",useSQLite:true}}}]}));
 const direct=await mf.unsafeGetDirectURL("task-replay");
 const call=(path:string,token?:string,payload?:unknown,method?:string)=>fetch(new URL(path,direct),{method:method??(payload?"POST":"GET"),headers:{Connection:"close","CF-Connecting-IP":"198.51.100.26",...(token?{Authorization:`Bearer ${token}`}:{ }),...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
 const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
 const route='/api/p/p123456789abc/import-history';
 try{const owner=await session('owner');await call('/fixture/seed');const operation=await(await call('/fixture/claim')).json() as {instanceId:string};const latest=await(await call(`/fixture/cleanup-attempt?id=${operation.instanceId}&mode=native-unknown`)).json() as {workflowId:string;nativeRunId:string;generation:number};await call(`/fixture/pause-native?id=${operation.instanceId}`);await call('/fixture/status?value=terminated');await call('/fixture/move');
 const read=async()=>{const response=await call(`${route}/${operation.instanceId}`,owner);expect(response.status).toBe(200);return await response.json() as {canResume:boolean;attemptGeneration:number;status:string};};
 expect((await read()).canResume).toBe(false);expect((await(await call('/fixture/calls')).json() as string[]).filter(x=>x.startsWith('create:'))).toEqual([]);
 await call(`/fixture/native-stopped?id=${latest.nativeRunId}`);expect((await read()).canResume).toBe(true);expect(await(await call(`/fixture/inspection?id=${operation.instanceId}`)).json()).toMatchObject({currentAttempt:{generation:2,nativeRunId:latest.nativeRunId,nativeState:'stopped'}});const getCalls=await(await call('/fixture/calls')).json() as string[];expect(getCalls.filter(x=>x.startsWith('create:'))).toEqual([]);expect(getCalls).not.toContain('VM');expect(await(await call(`/fixture/native-state?id=${latest.nativeRunId}`)).json()).toMatchObject({destroyCalls:2});
 const resumed=await call(route,owner,{instanceId:operation.instanceId,expectedGeneration:latest.generation});expect(resumed.status).toBe(202);expect(await resumed.json()).toMatchObject({attemptGeneration:3,status:'running',head:'a'.repeat(40)});const dispatch=await(await call('/fixture/dispatch')).json() as {id:string;params:{expectedHead:string}};expect(dispatch.id).not.toBe(latest.workflowId);expect(dispatch.params.expectedHead).toBe('a'.repeat(40));expect((await(await call('/fixture/move')).json() as {acceptedState:{currentCommit:string}}).acceptedState.currentCommit).toBe('b'.repeat(40));
 }finally{await mf.dispose();issuer.stop(true);}
},30000);
