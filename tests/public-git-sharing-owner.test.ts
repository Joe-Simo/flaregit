import {expect,test} from "bun:test";
import {Miniflare,convertV4MiniflareOptions} from "miniflare";
import {workerdChild} from "./support/workerd-child";
import {PUBLIC_GIT_AUTHOR_ACKNOWLEDGEMENT,type PublicGitConsentScope} from "../src/server/public-git-consent";
test("owner consent rejects head races and can be disabled after accepted history advances",async()=>{
 if(await workerdChild("tests/public-git-sharing-owner.test.ts"))return;
 const build=await Bun.build({entrypoints:["tests/support/public-git-sharing-owner-worker.ts"],target:"browser",external:["cloudflare:workers","node:*"]});if(!build.success)throw new Error(String(build.logs));
 const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"sharing",modules:true,script:await build.outputs[0]!.text(),compatibilityDate:"2026-10-02",compatibilityFlags:["nodejs_compat"],durableObjects:{TEST:{className:"SharingOwnerFixture",useSQLite:true},REPOSITORY_CONTROLLER:{className:"SharingOwnerFixture",useSQLite:true}},queueProducers:["INTEGRATION_QUEUE"]}]}));
 const call=async(path:string,value?:unknown)=>(await mf.getWorker("sharing")).fetch(`http://fixture${path}`,value?{method:"POST",body:JSON.stringify(value)}:undefined);
 try{
  const ready=await(await call("/ready")).json() as {target:PublicGitConsentScope;publication:null};expect(ready.publication).toBeNull();expect(ready.target.commit).toBe("a".repeat(40));
  const input={enabled:true,consent:{...ready.target,confirmed:true,acknowledgement:PUBLIC_GIT_AUTHOR_ACKNOWLEDGEMENT},mutation:{expectedVersion:0,idempotencyKey:crypto.randomUUID()}};
  expect((await call("/outsider",input)).status).toBe(409);
  const enabled=await call("/decide",input);expect(enabled.status).toBe(200);const saved=await enabled.json();expect(await(await call("/decide",input)).json()).toEqual(saved);
  const advanced=await(await call("/advance")).json() as {target:unknown};expect(advanced.target).toBeNull();expect((await call("/decide",{...input,mutation:{expectedVersion:1,idempotencyKey:crypto.randomUUID()}})).status).toBe(409);
  expect((await call("/decide",{enabled:false,mutation:{expectedVersion:1,idempotencyKey:crypto.randomUUID()}})).status).toBe(200);
 }finally{await mf.dispose();}
},30000);
