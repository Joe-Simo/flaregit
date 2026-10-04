import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {generateKeyPair,exportJWK,SignJWT} from "jose";
import type {FlareGitProjectState} from "../src/core/types";
import {workerdChild} from "./support/workerd-child";

test("native owner review and decision HTTP preserve authority and replay attribution",async()=>{
 if(await workerdChild("tests/review-decision-authority-http.test.ts"))return;
 const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"task-replay",alg:"RS256",use:"sig"};
 const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
 const file=`/tmp/flaregit-task-replay-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/review-decision-authority-http-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
 const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
 const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"task-replay",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{REPOSITORY_CONTROLLER:{className:"ReviewAuthorityFixture",useSQLite:true}}}]}));
 const direct=await mf.unsafeGetDirectURL("task-replay");
 const call=(path:string,token?:string,payload?:unknown)=>fetch(new URL(path,direct),{method:payload?"POST":"GET",headers:{Connection:"close","CF-Connecting-IP":"198.51.100.26",...(token?{Authorization:`Bearer ${token}`}:{ }),...(payload?{"Content-Type":"application/json"}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
 const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
 const state=async()=>await(await call("/fixture/state")).json() as FlareGitProjectState;
 const events=async()=>await(await call("/fixture/events")).json() as unknown[];
 const review=(id:string)=>`/api/p/p123456789abc/candidates/${id}/review`,decision="/api/p/p123456789abc/decisions/resolve",payload={approved:true,expectedCommit:"a".repeat(40),note:"Inspect exact candidate"};
 try{
  const tokens=await(await call("/fixture/bootstrap")).json() as {full:string;write:string};const owner=await session("owner"),member=await session("member");
  const before=await state();
  for(const invalid of [{...payload,unexpectedField:true},{...payload,expectedTarget:null},{...payload,expectedTarget:[]},{...payload,expectedTarget:{ref:"refs/tags/release",acceptedCommit:"b".repeat(40),acceptedVersion:0}},{...payload,expectedTarget:{ref:"refs/heads/main",acceptedCommit:"b".repeat(40),acceptedVersion:0.5}},{...payload,expectedTarget:{ref:"refs/heads/main",acceptedCommit:"b".repeat(40),acceptedVersion:0,extra:true}}])expect((await call(review("candidate-session"),owner,invalid)).status).toBe(400);
  expect((await call(review("candidate-session"),owner,{...payload,expectedTarget:{ref:"refs/heads/main",acceptedCommit:"b".repeat(40),acceptedVersion:0}})).status).toBe(409);
  expect(await state()).toEqual(before);expect(await events()).toEqual([]);
  expect((await call(review("candidate-session"),undefined,payload)).status).toBe(401);
  for(const credential of [member,tokens.write]){expect((await call(review("candidate-session"),credential,payload)).status).toBe(403);expect((await call(decision,credential,{decisionId:"decision-session",selectedOptionId:"one"})).status).toBe(403);}
  expect((await call(review("candidate-session"),owner,{...payload,expectedCommit:"f".repeat(40)})).status).toBe(409);
  expect((await call(decision,owner,{decisionId:"decision-session",selectedOptionId:"unknown"})).status).toBe(409);expect(await state()).toEqual(before);expect(await events()).toEqual([]);
  expect((await call(review("candidate-session"),owner,payload)).status).toBe(200);const saved=(await state()).candidates["candidate-session"]!.review!;expect(saved.actor).toEqual({userId:"owner",displayName:"Original owner",viaToken:false});expect(saved.at).toBeTruthy();
  await call("/fixture/rename");expect((await call(review("candidate-session"),owner,payload)).status).toBe(200);expect((await state()).candidates["candidate-session"]!.review).toEqual(saved);const delivered=await events();expect(delivered[0]).toEqual(delivered[1]);
  const unchanged=await state(),count=(await events()).length;for(const changed of [{...payload,note:"Changed note"},{...payload,approved:false}])expect((await call(review("candidate-session"),owner,changed)).status).toBe(409);expect(await state()).toEqual(unchanged);expect((await events()).length).toBe(count);
  expect((await call(review("candidate-token"),tokens.full,payload)).status).toBe(200);expect((await state()).candidates["candidate-token"]!.review?.actor?.viaToken).toBe(true);
  const beforeQueue=(await events()).length;
  expect((await call(decision,owner,{decisionId:"decision-session",selectedOptionId:"one"})).status).toBe(200);const chosen=(await state()).decisions["decision-session"]!;expect(chosen.resolvedBy?.viaToken).toBe(false);expect(chosen.resolvedAt).toBeTruthy();
  expect((await call(decision,owner,{decisionId:"decision-session",selectedOptionId:"one"})).status).toBe(200);expect((await state()).decisions["decision-session"]).toEqual(chosen);expect((await events()).length).toBe(beforeQueue+2);const decisionEvents=(await events()).slice(beforeQueue);expect(decisionEvents[0]).toEqual(decisionEvents[1]);expect((await call(decision,owner,{decisionId:"decision-session",selectedOptionId:"two"})).status).toBe(409);
  expect((await call(decision,tokens.full,{decisionId:"decision-token",selectedOptionId:"one"})).status).toBe(200);expect((await state()).decisions["decision-token"]?.resolvedBy?.viaToken).toBe(true);
  await call("/fixture/queue-fail");const queueBefore=(await events()).length;const failedDelivery=await call(decision,owner,{decisionId:"decision-session",selectedOptionId:"one"});expect(failedDelivery.status).toBe(500);const retainedDecision=(await state()).decisions["decision-session"]!;expect((await call(decision,owner,{decisionId:"decision-session",selectedOptionId:"one"})).status).toBe(200);expect((await state()).decisions["decision-session"]).toEqual(retainedDecision);const replayedQueue=(await events()).slice(queueBefore);expect(replayedQueue).toHaveLength(2);expect(replayedQueue[0]).toEqual(replayedQueue[1]);
  const prepared=await(await call("/fixture/prepare")).json() as {ok:boolean};expect(prepared.ok).toBe(true);expect(await(await call("/fixture/authorize")).json() as boolean).toBe(true);const preserved=await state();await call("/fixture/demote");expect(await(await call("/fixture/authorize")).json() as boolean).toBe(false);expect(await state()).toEqual(preserved);await call("/fixture/complete");expect((await state()).candidates["candidate-session"]?.status).toBe("accepted");expect((await state()).acceptedState.currentCommit).toBe("a".repeat(40));await call("/fixture/restore");const legacy=await(await call("/fixture/legacy-approval")).json() as {ok:boolean};expect(legacy.ok).toBe(false);
  for(const hook of ["profile","lifecycle"])for(const operation of ["review","decision"]){const old=await state(),oldEvents=(await events()).length;await call(`/fixture/arm?hook=${hook}&effect=demote&after=${hook==="profile"?1:2}`);expect((await call(operation==="review"?review("candidate-race"):decision,owner,operation==="review"?payload:{decisionId:"decision-race",selectedOptionId:"one"})).status).toBe(409);expect(await state()).toEqual(old);expect((await events()).length).toBe(oldEvents);await call("/fixture/restore");}
  for(const operation of ["review","decision"]){const old=await state(),oldEvents=(await events()).length;await call("/fixture/arm?hook=profile&effect=seal");expect((await call(operation==="review"?review("candidate-race"):decision,owner,operation==="review"?payload:{decisionId:"decision-race",selectedOptionId:"one"})).status).toBe(409);expect(await state()).toEqual(old);expect((await events()).length).toBe(oldEvents);await call("/fixture/restore-account");}
  for(const operation of ["review","decision"]){const old=await state(),oldEvents=(await events()).length;await call("/fixture/arm?hook=profile&effect=revoke");expect((await call(operation==="review"?review("candidate-race"):decision,tokens.full,operation==="review"?payload:{decisionId:"decision-race",selectedOptionId:"one"})).status).toBe(401);expect(await state()).toEqual(old);expect((await events()).length).toBe(oldEvents);await call("/fixture/restore-full-token");}
  const old=await state(),oldEvents=(await events()).length;await call("/fixture/arm?hook=profile&effect=delete");expect((await call(decision,owner,{decisionId:"decision-race",selectedOptionId:"one"})).status).toBe(409);expect(await state()).toEqual(old);expect((await events()).length).toBe(oldEvents);
 }finally{await mf.dispose();issuer.stop(true);}
},30000);
