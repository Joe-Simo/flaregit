import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {workerdChild} from "./support/workerd-child";
import type{ContainerLifetimeState}from"../src/server/container-lifetime";
interface Snapshot{state:ContainerLifetimeState|null;alarm:number|null;provider:{running:number;starts:number;destroys:number}}
test("durable container lifetime prearms before start, survives reconstruction and retries unconfirmed stops",async()=>{
 if(await workerdChild("tests/container-lifetime.test.ts"))return;
 const file=`/tmp/lifetime-${crypto.randomUUID()}.js`,build=Bun.spawn([process.execPath,"build","tests/support/container-lifetime-worker.ts","--target=browser","--external=cloudflare:workers",`--outfile=${file}`],{stdout:"ignore",stderr:"pipe"});const[error,code]=await Promise.all([new Response(build.stderr).text(),build.exited]);if(code)throw new Error(error);const script=await Bun.file(file).text();await Bun.file(file).delete();
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"lifetime",modules:true,script,compatibilityDate:"2026-10-02",durableObjects:{TEST:{className:"LifetimeFixture",useSQLite:true}}}]}));const call=async(path:string,body?:unknown)=>(await mf.getWorker("lifetime")).fetch(`http://test${path}`,body?{method:"POST",body:JSON.stringify(body)}:undefined);
 try{
  const now=Date.now();await call("/configure",{now});const first=await(await call("/start")).json() as Snapshot;expect(first.provider.starts).toBe(1);expect(first.alarm).toBe(now+20*60_000);expect(first.state?.deadline).toBe(first.alarm??undefined);
  await call("/configure",{now:now+1000});const later=await(await call("/work")).json() as Snapshot;expect(later.state?.deadline).toBe(first.state?.deadline);expect(later.alarm).toBe(first.alarm);
  await call("/configure",{destroyFails:true,now:now+20*60_000+1});expect((await call("/work")).status).toBe(409);const unconfirmed=await(await call("/snapshot")).json() as Snapshot;expect(unconfirmed.state?.state).toBe("stopping");expect(unconfirmed.state?.deadline).toBe(first.state?.deadline);expect(unconfirmed.alarm).toBe(now+20*60_000+1+30000);expect(unconfirmed.provider.running).toBe(1);
  await call("/configure",{destroyFails:false,inspectRunning:true});expect((await call("/expiry")).status).toBe(409);expect((await(await call("/snapshot")).json() as Snapshot).state?.state).toBe("stopping");
  await call("/configure",{inspectRunning:false});const stopped=await(await call("/expiry")).json() as Snapshot;expect(stopped.state?.state).toBe("stopped");expect(stopped.alarm).toBeNull();expect(stopped.provider.running).toBe(0);expect((await call("/start")).status).toBe(409);expect((await(await call("/snapshot")).json() as Snapshot).provider.starts).toBe(1);
  await call("/configure?name=prearm-fault",{now,alarmFails:true});expect((await call("/start?name=prearm-fault")).status).toBe(409);expect((await(await call("/snapshot?name=prearm-fault")).json() as Snapshot).provider.starts).toBe(0);
  await call("/configure?name=prearm-fault",{now:now+10000,alarmFails:false});const retried=await(await call("/start?name=prearm-fault")).json() as Snapshot;expect(retried.state?.deadline).toBe(now+20*60_000);
  await call("/stop?name=prearm-fault");const restarted=await(await call("/start?name=prearm-fault")).json() as Snapshot;expect(restarted.state?.deadline).toBe(retried.state?.deadline);expect(restarted.provider.starts).toBe(2);
  await call("/configure?name=sealed-race",{now});
  const dispatched=call("/hold-start?name=sealed-race");let held=false;
  for(let poll=0;poll<100;poll++){const snapshot=await(await call("/snapshot?name=sealed-race")).json() as Snapshot&{held:boolean};if(snapshot.held){held=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
  expect(held).toBe(true);
  const sealed=await(await call("/seal-stop?name=sealed-race")).json() as Snapshot;
  expect(sealed.state).toMatchObject({state:"stopped",sealed:true});expect(sealed.provider.running).toBe(0);expect(sealed.provider.starts).toBe(0);
  await call("/release?name=sealed-race");expect((await dispatched).status).toBe(409);
  expect((await call("/start?name=sealed-race")).status).toBe(409);expect((await call("/work?name=sealed-race")).status).toBe(409);
  const afterLate=await(await call("/snapshot?name=sealed-race")).json() as Snapshot;
  expect(afterLate.state).toMatchObject({state:"stopped",sealed:true});expect(afterLate.provider.starts).toBe(0);expect(afterLate.alarm).toBeNull();
  await call("/configure?name=never-started-seal",{now});await call("/seal-stop?name=never-started-seal");expect((await call("/start?name=never-started-seal")).status).toBe(409);
  await call("/configure?name=legacy",{now,running:true});expect((await call("/work?name=legacy")).status).toBe(409);expect((await(await call("/snapshot?name=legacy")).json() as Snapshot).provider.running).toBe(0);
 }finally{await mf.dispose();}
},30000);
