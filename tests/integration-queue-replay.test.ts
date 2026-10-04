import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {workerdChild} from "./support/workerd-child";
interface Stats{creates:number;rows:Array<{id:string;executions:number;simulated_models:number;simulated_vms:number}>}
test("real Workflow batch queue replay preserves one synthetic execution and durable terminal fences",async()=>{
 if(await workerdChild("tests/integration-queue-replay.test.ts"))return;
 const file=`/tmp/flaregit-queue-replay-${crypto.randomUUID()}.js`,build=Bun.spawn([process.execPath,"build","tests/support/integration-queue-replay-worker.ts","--target=browser","--external=cloudflare:workers","--external=node:*",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});const[error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code)throw new Error(error);const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"queue-replay",modules:true,script,compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],durableObjects:{REPOSITORY_CONTROLLER:{className:"QueueReplayLedger",useSQLite:true}},workflows:{INTEGRATION_WORKFLOW:{name:"queue-replay",className:"QueueReplayWorkflow"}}}]}));
 const call=async(path:string,body?:unknown)=>(await mf.getWorker("queue-replay")).fetch(`http://fixture${path}`,body?{method:"POST",body:JSON.stringify(body)}:undefined),stats=async()=>await(await call("/stats")).json() as Stats;
 const event=(eventId:string,taskIds=["change-one"])=>({type:"integration.requested",projectId:"p123456789abc",eventId,taskIds});
 try{
 expect((await call("/seed")).status).toBe(200);expect(await(await call("/deliver",event("queue-lost-ack"))).json()).toEqual({ack:0,retry:1});
 for(let count=0;count<100&&!(await stats()).rows.length;count++)await new Promise(resolve=>setTimeout(resolve,10));
 expect(await(await call("/deliver",event("queue-lost-ack"))).json()).toEqual({ack:1,retry:0});const duplicate=await stats();expect(duplicate.creates).toBe(2);expect(duplicate.rows).toEqual([{id:"queue-lost-ack",executions:1,simulated_models:1,simulated_vms:1}]);
 expect(await(await call("/deliver",event("queue-lost-ack",["change-two"]))).json()).toEqual({ack:0,retry:1});expect(await stats()).toEqual(duplicate);
 await call("/unavailable?value=true");expect(await(await call("/deliver",event("queue-unavailable"))).json()).toEqual({ack:0,retry:1});const unavailable=await stats();expect(unavailable.rows).toEqual(duplicate.rows);
 await call("/terminal");expect(await(await call("/deliver",event("queue-retired"))).json()).toEqual({ack:1,retry:0});expect(await stats()).toEqual(unavailable);await call("/unavailable?value=false");
 await call("/release");let terminal=false;for(let count=0;count<100;count++){const status=await(await call("/status")).json() as{status:string};if(status.status==="complete"){terminal=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}expect(terminal).toBe(true);
 const completed=await stats();await call("/admit-withdrawn");expect(await(await call("/deliver",event("queue-withdrawn"))).json()).toEqual({ack:0,retry:1});expect(await stats()).toEqual(completed);await call("/restore-owner");await call("/seal");expect(await(await call("/deliver",event("queue-sealed"))).json()).toEqual({ack:0,retry:1});expect(await stats()).toEqual(completed);await call("/delete-repository");expect(await(await call("/deliver",event("queue-withdrawn"))).json()).toEqual({ack:0,retry:1});expect(await stats()).toEqual(completed);await call("/provider-delete");expect(await(await call("/deliver",event("queue-lost-ack"))).json()).toEqual({ack:1,retry:0});expect(await stats()).toEqual(completed);
 }finally{await mf.dispose();}
},30000);
