import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";
test("legacy queue messages bind generation zero while fresh replay stays fenced", async () => {
 if(await workerdChild("tests/webhook-queue-generation.test.ts"))return;
 const file=`/tmp/flaregit-queue-generation-${crypto.randomUUID()}.js`;
 const build=Bun.spawn([process.execPath,"build","tests/support/webhook-queue-generation-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});
 if(await build.exited)throw new Error(await new Response(build.stderr).text());
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"generation",modules:true,script:await Bun.file(file).text(),compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"]}]}));
 try{const worker=await mf.getWorker("generation");for(const generation of [0,1])expect(await(await worker.fetch(`https://fixture?generation=${generation}`)).json()).toEqual({deferrals:generation===0?1:0,sends:0,acknowledgments:1,retries:0});}
 finally{await mf.dispose();await Bun.file(file).delete();}
},30000);
