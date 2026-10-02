import { expect, test } from "bun:test";
import { claimNativeCompute } from "../src/server/native-compute.js";
import type { Env } from "../src/server/env.js";
function fixture(expired:boolean,stopFails=false){
  let active=true,stops=0;
  const global={claimNativeCompute:async()=>active?null:"fresh-token",nativeComputeStatus:async()=>({active:true,token:"old-token",sandboxName:"native-old-token",deadline:Date.now()+(expired?-1:1200000)}),finishNativeCompute:async(_key:string,token:string)=>{expect(token).toBe("old-token");active=false;}};
  const env={REPOSITORY_CONTROLLER:{idFromName:()=>"global",get:()=>global},INTEGRATOR:{getByName:(name:string)=>{expect(name).toBe("native-old-token");return{destroy:async()=>{stops++;if(stopFails)throw new Error("provider unavailable");},lifetimeStatus:async()=>({state:"stopped"})};}}} as unknown as Env;
  return{env,stops:()=>stops,active:()=>active};
}
test("live native claim remains pending and is never stolen",async()=>{const f=fixture(false);expect(await claimNativeCompute(f.env,"build-key")).toBeNull();expect(f.stops()).toBe(0);});
test("expired native claim recovers only after trusted exact VM stop",async()=>{const f=fixture(true);expect(await claimNativeCompute(f.env,"build-key")).toBe("fresh-token");expect(f.stops()).toBe(1);});
test("unknown provider stop keeps expired claim locked",async()=>{const f=fixture(true,true);await expect(claimNativeCompute(f.env,"build-key")).rejects.toThrow("provider unavailable");expect(f.active()).toBe(true);});
