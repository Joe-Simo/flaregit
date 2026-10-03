import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {generateKeyPair,exportJWK,SignJWT} from "jose";
import {workerdChild} from "./support/workerd-child";
import {accountKeyFor} from "../src/server/projects";
import type {ReportRow} from "../src/server/durable-object";

test("native report HTTP and SQL preserve oldest backlog, immutable operator attribution and idempotent closure",async()=>{
  if(await workerdChild("tests/reports-accountability.test.ts"))return;
  const pair=await generateKeyPair("RS256"),jwk={...await exportJWK(pair.publicKey),kid:"reports-fixture",alg:"RS256",use:"sig"};
  const issuer=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>Response.json({keys:[jwk]})});
  const file=`/tmp/flaregit-reports-${crypto.randomUUID()}.js`;
  const build=Bun.spawn([process.execPath,"build","tests/support/reports-accountability-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
  const[error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0){issuer.stop(true);throw new Error(error);}
  const script=await Bun.file(file).text();await Bun.file(file).delete();
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"reports-api",unsafeDirectSockets:[{host:"127.0.0.1"}],modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],bindings:{FIXTURE_ISSUER:issuer.url.origin},durableObjects:{TEST:{className:"ReportsRepository",useSQLite:true}}}]}));
  const directUrl=await mf.unsafeGetDirectURL("reports-api");
  const call=(path:string,method="GET",body?:unknown,token?:string)=>fetch(new URL(path,directUrl),{method,headers:{Connection:"close","CF-Connecting-IP":"198.51.100.25",...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const session=(subject:string)=>new SignJWT({azp:"https://fixture.example"}).setProtectedHeader({alg:"RS256",kid:jwk.kid}).setIssuer(issuer.url.origin).setSubject(subject).setIssuedAt().setExpirationTime("5m").sign(pair.privateKey);
  try{
    const tokens=await(await call("/fixture/bootstrap")).json() as Record<string,string>;
    const [one,two,outsider]=await Promise.all([session("operator-one"),session("operator-two"),session("outsider")]);
    expect((await call("/api/operator/reports")).status).toBe(401);
    expect((await call("/api/operator/reports","GET",undefined,tokens["operator-one"])).status).toBe(404);
    expect((await call("/api/operator/reports","GET",undefined,outsider)).status).toBe(404);
    const queue=await(await call("/api/operator/reports","GET",undefined,one)).json() as ReportRow[];
    expect(queue).toHaveLength(200);expect(queue[0]?.id).toBe("rpt_seed-000");expect(queue.at(-1)?.id).toBe("rpt_seed-199");
    const own=await(await call("/api/reports","GET",undefined,tokens.reporter)).json() as ReportRow[];
    expect(own).toHaveLength(200);expect(own[0]?.id).toBe("rpt_seed-204");expect(own.at(-1)?.id).toBe("rpt_seed-005");
    expect(await(await call("/api/reports","GET",undefined,tokens.outsider)).json() as ReportRow[]).toEqual([]);
    const route="/api/operator/reports/rpt_seed-000/resolve";
    expect((await call(route,"POST",{resolution:"Forged token closure"},tokens["operator-one"])).status).toBe(404);
    expect((await call(route,"POST",{resolution:"Forged outsider closure",operatorAccountKey:await accountKeyFor("operator-one")},outsider)).status).toBe(404);
    const competing=await Promise.all([call(route,"POST",{resolution:"First operator decision",expectedStatus:"open"},one),call(route,"POST",{resolution:"Second operator decision",expectedStatus:"open"},two)]);
    expect(competing.map(response=>response.status).sort()).toEqual([200,409]);
    const winnerIndex=competing.findIndex(response=>response.status===200),winner=await competing[winnerIndex]!.json() as ReportRow;
    const winnerSubject=winnerIndex===0?"operator-one":"operator-two",winnerToken=winnerIndex===0?one:two;
    expect(winner.resolved_by).toBe(await accountKeyFor(winnerSubject));expect(winner.resolved_at).toBeTruthy();
    await call("/fixture/rename","POST",{userId:winnerSubject});
    const retried=await call(route,"POST",{resolution:winner.resolution,expectedStatus:"open"},winnerToken);expect(retried.status).toBe(200);expect(await retried.json() as ReportRow).toEqual(winner);
    expect((await call(route,"POST",{resolution:"Changed decision"},winnerToken)).status).toBe(409);
    expect((await call(route,"POST",{resolution:winner.resolution},winnerIndex===0?two:one)).status).toBe(409);
    const resolved=await(await call("/api/operator/reports?status=resolved","GET",undefined,one)).json() as ReportRow[];expect(resolved.find(row=>row.id===winner.id)).toEqual(winner);
    expect((await call("/api/operator/reports/rpt_unknown/resolve","POST",{resolution:"Unknown report"},one)).status).toBe(404);
  }finally{await mf.dispose();issuer.stop(true);}
},30000);
