import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {workerdChild} from "./support/workerd-child";

test("production public mutation routes authenticate stored tokens and preserve attribution/version",async()=>{
  if(await workerdChild("tests/community-api.test.ts"))return;
  const output=`/tmp/flaregit-community-api-${crypto.randomUUID()}.js`;
  const built=Bun.spawn([process.execPath,"build","tests/support/community-api-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${output}`],{stdout:"ignore",stderr:"pipe"});
  let script:string;
  try { if(await built.exited!==0)throw new Error(await new Response(built.stderr).text());script=await Bun.file(output).text(); }
  finally { if(await Bun.file(output).exists())await Bun.file(output).delete(); }
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"community-api",modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],durableObjects:{REPOSITORY_CONTROLLER:{className:"CommunityApiRepository",useSQLite:true}}}]}));
  try {
    const api=await mf.getWorker("community-api");
    const tokens=await(await api.fetch("http://test/fixture")).json() as Record<string,string>;
    const path="/api/public/abcdef123456/community/posts";
    const call=(route:string,method:string,user:string,body?:unknown)=>api.fetch(`http://test${route}`,{method,headers:{Authorization:`Bearer ${tokens[user]}`},...(body?{body:JSON.stringify(body)}:{})});
    const post=await call(path,"POST","author",{scope:"issues",title:"Public post",body:"Deliberate public content",idempotencyKey:"same-key-fixture"});
    expect(post.status).toBe(201);
    const saved=await post.json() as {id:string;version:number;author:string};
    const other=await(await call(path,"GET","other")).json() as {posts:Array<{canEdit:boolean}>;authorDisplayName:string};
    expect(other.posts[0]!.canEdit).toBe(false);expect(other.authorDisplayName).toBe("Same display name");
    expect((await call(`${path}/${saved.id}`,"PATCH","other",{title:"Spoof",body:"Other user",expectedVersion:1})).status).toBe(409);
    const changed=await call(`${path}/${saved.id}`,"PATCH","author",{title:"Corrected",body:"Author correction",expectedVersion:1});
    expect(changed.status).toBe(200);expect(await changed.json()).toMatchObject({author:saved.author,version:2});
    expect((await call(`${path}/${saved.id}`,"DELETE","author",{expectedVersion:1})).status).toBe(409);
    expect((await call(`${path}/${saved.id}`,"DELETE","author",{expectedVersion:2})).status).toBe(200);
    expect((await call(path,"POST","author",{scope:"issues",title:"Public post",body:"Deliberate public content",idempotencyKey:"same-key-fixture"})).status).toBe(409);
  } finally {await mf.dispose();}
},30000);
