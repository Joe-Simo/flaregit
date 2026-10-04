import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {generateKeyPair,exportJWK,SignJWT} from "jose";
import {workerdChild} from "./support/workerd-child";

test("actual task POST replays lost acknowledgments without providers and preserves creator authority",async()=>{
 if(await workerdChild("tests/task-creation-replay-http.test.ts"))return;
 const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"task-replay",alg:"RS256",use:"sig"};
 const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/flaregit-task-replay-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/task-creation-replay-http-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
 const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"task-replay",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:"TaskReplayFixture",useSQLite:true}}}]}));
 const direct=await mf.unsafeGetDirectURL("task-replay");
 const call=(path:string,token?:string,payload?:unknown)=>fetch(new URL(path,direct),{method:payload?"POST":"GET",headers:{Connection:"close","CF-Connecting-IP":"198.51.100.26",...(token?{Authorization:`Bearer ${token}`}:{ }),...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
 const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
 const snapshot=async()=>await(await call("/fixture/snapshot")).json() as Record<string,unknown>;
 const route="/api/p/p123456789abc/tasks",body={taskId:"working",goal:"Preserve saved work"};
 try{
  const bootstrap=await call("/fixture/bootstrap");if(!bootstrap.ok)throw new Error(await bootstrap.text());const fixture=await bootstrap.json() as {actor:string;collision:string};
  const [creator,collision,owner]=await Promise.all([session(fixture.actor),session(fixture.collision),session("owner")]);
  const cloneResponse=await call("/api/p/p123456789abc/clone",creator,{});expect(cloneResponse.status).toBe(200);const clone=await cloneResponse.json() as {remote:string;token:string;expiresInSeconds:number;command:string};expect(clone.token).toMatch(/^fgg_/);expect(clone.expiresInSeconds).toBe(3600);expect(clone.command).toBe(`git clone ${clone.remote}`);expect(clone.command).not.toContain(clone.token);expect(clone.command).not.toMatch(/Authorization|Bearer|extraHeader/);
  const initial=await snapshot();
  const response=await call(route,creator,body);expect(response.status).toBe(200);
  const replay=await response.json() as {task:string;replayed:boolean;token:string;expiresInSeconds:number;commands:string[];remote:string;branch:string};
  expect(replay.replayed).toBe(true);expect(replay.task).toBe("working");expect(replay.token).toMatch(/^fgg_/);expect(replay.remote).toContain("/git/");expect(replay.branch).toBe("task/working");expect(replay.expiresInSeconds).toBe(3600);expect(replay.commands.join("\n")).not.toContain(replay.token);expect(replay.commands.join("\n")).not.toMatch(/fgg_|Authorization|Bearer|extraHeader/);expect(replay.commands[0]).toBe(`git clone ${replay.remote} working && cd working`);
  const after=await snapshot();const {git_capabilities:initialCapabilities,...initialState}=initial;const {git_capabilities:afterCapabilities,...afterState}=after;
  expect(afterState).toEqual(initialState);expect((afterCapabilities as unknown[]).length).toBe((initialCapabilities as unknown[]).length+1);
  const second=await call(route,creator,{...body,name:"Different display name"});expect(second.status).toBe(200);expect((await second.json() as {token:string}).token).not.toBe(replay.token);
  for(const id of ["accepted","cancelled"]){const before=await snapshot();const terminal=await call(route,creator,{...body,taskId:id});expect(terminal.status).toBe(200);const result=await terminal.json() as {terminal:boolean;replayed:boolean;commands:unknown[];token?:string;agentRunId:string};expect(result.terminal).toBe(true);expect(result.replayed).toBe(true);expect(result.commands).toEqual([]);expect(result.token).toBeUndefined();expect(result.agentRunId).toBe(`run-${id}`);expect(await snapshot()).toEqual(before);}
  for(const changed of [{goal:"Changed"},{dependsOn:"accepted"},{issue:99}]){const before=await snapshot();expect((await call(route,creator,{...body,...changed})).status).toBe(409);expect(await snapshot()).toEqual(before);}
  for(const token of [collision,owner]){const before=await snapshot();expect([403,409]).toContain((await call(route,token,body)).status);expect(await snapshot()).toEqual(before);}
  const beforeLegacy=await snapshot();expect((await call(route,creator,{...body,taskId:"legacy"})).status).toBe(409);expect(await snapshot()).toEqual(beforeLegacy);
  await call("/fixture/revoke");const revoked=await snapshot();expect([403,404]).toContain((await call(route,creator,body)).status);expect(await snapshot()).toEqual(revoked);
  await call("/fixture/restore");await call("/fixture/arm-demotion?after=2");const beforeRace=await snapshot();const raced=await call(route,creator,body);expect([403,404,409]).toContain(raced.status);
  const raceState=await snapshot();const {members:beforeRaceMembers,...beforeRaceRest}=beforeRace;const {members:raceMembers,...raceRest}=raceState;expect(raceRest).toEqual(beforeRaceRest);expect(raceMembers).not.toEqual(beforeRaceMembers);
  await call("/fixture/restore");await call("/fixture/arm-demotion?after=1");const beforeCreateRace=await snapshot();expect(await(await call("/fixture/direct-create")).json() as {created:boolean}).toEqual({created:false});
  const {members:beforeCreateMembers,...beforeCreateRest}=beforeCreateRace;const {members:afterCreateMembers,...afterCreateRest}=await snapshot();expect(afterCreateRest).toEqual(beforeCreateRest);expect(afterCreateMembers).not.toEqual(beforeCreateMembers);
  await call("/fixture/restore");await call("/fixture/seal-account");const sealed=await snapshot();expect([403,404,409]).toContain((await call(route,creator,body)).status);expect(await snapshot()).toEqual(sealed);expect(await(await call("/fixture/direct-create")).json() as {created:boolean}).toEqual({created:false});expect(await snapshot()).toEqual(sealed);
  expect(await(await call("/fixture/provider-calls")).json() as string[]).toEqual([]);
 }finally{await mf.dispose();issuer.stop(true);}
},30000);
