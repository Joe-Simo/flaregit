import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {workerdChild} from "./support/workerd-child";
import type {PublicPost,ContributionRequest} from "../src/server/public-community";

test("public community SQL opt-in separates private history, binds authors and guards private-access decisions",async()=>{
  if(await workerdChild("tests/public-community.test.ts"))return;
  const bundle=`/tmp/flaregit-community-${crypto.randomUUID()}.js`;
  const build=Bun.spawn([process.execPath,"build","tests/support/public-community-worker.ts","--target=browser","--external=cloudflare:workers",`--outfile=${bundle}`],{stdout:"ignore",stderr:"pipe"});const [error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code!==0)throw new Error(error);const script=await Bun.file(bundle).text();await Bun.file(bundle).delete();
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"community",modules:true,script,compatibilityDate:"2026-10-02",durableObjects:{TEST:{className:"CommunityFixture",useSQLite:true}}}]}));
  const call=async(route:string,body?:unknown)=>(await mf.getWorker("community")).fetch(`http://test${route}`,body?{method:"POST",body:JSON.stringify(body)}:undefined);
  const post={scope:"issues",title:"New public issue",body:"Only this explicitly public conversation",idempotencyKey:"post-event-123"};
  const policy={enabled:true,scopes:["issues","discussions","contribution-requests"]};
  try{
    expect(await(await call("/policy")).json()).toEqual({enabled:false,scopes:[]});
    expect((await call("/post",post)).status).toBe(409);
    expect((await call("/configure?actor=owner",{policy,confirmed:false})).status).toBe(409);
    expect((await call("/configure",{policy,confirmed:true})).status).toBe(409);
    expect((await call("/configure?actor=owner",{policy,confirmed:true})).status).toBe(200);
    expect((await call("/post",{...post,author:"Fake maintainer"})).status).toBe(409);
    expect((await call("/post",{...post,body:"API_KEY=synthetic-credential-value"})).status).toBe(409);
    for(const body of ["See https://credential-only@example.com/run", "See https://user:pass@example.com/run", "See https://example.com/run?%61pi_key=synthetic", "See https://example.com/run?access%5Ftoken=synthetic", "See https://example.com/run?X-Amz-Signature=synthetic", "See https://example.com/%E0%A4%A", "See https://example.com/run?view=ghp_abcdefghijklmnopqrstuvwxyz"]){
      expect((await call("/post",{...post,body,idempotencyKey:"unsafe-url-fixture"})).status).toBe(409);
      expect((await call("/request",{purpose:body,idempotencyKey:"unsafe-request-fixture"})).status).toBe(409);
    }
    const safeLink={...post,body:"Read [the check](https://checks.example.com/run?step=tests&view=summary).",idempotencyKey:"safe-url-fixture"};
    expect((await call("/post",safeLink)).status).toBe(200);
    expect((await call("/post",{...post,body:"IPv6 documentation: https://[2001:db8::1]",idempotencyKey:"safe-ipv6-fixture"})).status).toBe(200);
    await Bun.sleep(5);
    const saved=await(await call("/post",post)).json() as PublicPost;
    expect((await(await call("/list")).json() as PublicPost[])[0]!.id).toBe(saved.id);
    expect(saved.author).toBe("Contributor");
    expect((await(await call("/post",post)).json() as PublicPost).id).toBe(saved.id);
    expect((await call("/post",{...post,body:"Changed event contents"})).status).toBe(409);
    const publicText=await(await call("/list")).text();expect(publicText).not.toContain("author-subject");expect(publicText).not.toContain("author-account");expect(publicText).not.toContain("author@example.com");expect(publicText).not.toContain("Existing private conversation");
    expect((await call("/edit?actor=other",{id:saved.id,expectedVersion:1,title:"Edit",body:"Unauthorized edit"})).status).toBe(409);
    expect((await call("/edit?actor=owner",{id:saved.id,expectedVersion:1,title:"Moderated",body:"Explicit moderated content"})).status).toBe(200);
    const requested=await(await call("/request",{purpose:"I would like to contribute to this repository",idempotencyKey:"request-event-123"})).json() as ContributionRequest;
    expect(requested.status).toBe("requested");expect(await(await call("/requests?actor=other")).json()).toEqual([]);
    expect((await call("/decide?actor=other",{id:requested.id,decision:"approved",confirmed:true})).status).toBe(409);
    expect((await call("/decide?actor=owner",{id:requested.id,decision:"approved",confirmed:false})).status).toBe(409);
    expect((await(await call("/decide?actor=owner",{id:requested.id,decision:"approved",confirmed:true})).json() as ContributionRequest).privateContextAcknowledged).toBe(true);
    await call("/remove?actor=owner",{id:saved.id,expectedVersion:2});expect((await call("/post",post)).status).toBe(409);
    await call("/configure?actor=owner",{policy:{enabled:false,scopes:[]},confirmed:false});expect(await(await call("/list")).json()).toEqual([]);
  }finally{await mf.dispose();}
},30000);
