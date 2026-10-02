import {DurableObject} from "cloudflare:workers";
import {ContainerLifetime} from "../../src/server/container-lifetime";
export class LifetimeFixture extends DurableObject{
 override async alarm(){const response=await this.fetch(new Request("http://fixture/expiry"));if(!response.ok)throw new Error("Synthetic provider stop still pending");}
 override async fetch(request:Request){
  this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS fixture_provider(id INTEGER PRIMARY KEY,running INTEGER,destroy_fails INTEGER,inspect_running INTEGER,alarm_fails INTEGER,now INTEGER,starts INTEGER,destroys INTEGER);INSERT OR IGNORE INTO fixture_provider VALUES(1,0,0,0,0,0,0,0)");
  const row=()=>this.ctx.storage.sql.exec<{running:number;destroy_fails:number;inspect_running:number;alarm_fails:number;now:number;starts:number;destroys:number}>("SELECT * FROM fixture_provider").toArray()[0]!;
  const clock=()=>row().now||Date.now();
  const storage={sql:this.ctx.storage.sql,setAlarm:async(at:number)=>{if(row().alarm_fails)throw new Error("Synthetic alarm failure");await this.ctx.storage.setAlarm(at);},deleteAlarm:()=>this.ctx.storage.deleteAlarm()};
  const container={get running(){return row().running===1;},destroy:async()=>{this.ctx.storage.sql.exec("UPDATE fixture_provider SET destroys=destroys+1");if(row().destroy_fails)throw new Error("Synthetic provider failure");this.ctx.storage.sql.exec("UPDATE fixture_provider SET running=0");},inspect:async()=>row().running||row().inspect_running?{image:"synthetic"}:null};
  // Reconstruct the guard each request: no memory-only lifetime state is reused.
  const lifetime=new ContainerLifetime(storage,()=>container,20*60_000,clock),url=new URL(request.url);
  try{
   if(url.pathname==="/configure"){const input=await request.json() as{now?:number;alarmFails?:boolean;destroyFails?:boolean;inspectRunning?:boolean;running?:boolean};if(input.now!==undefined)this.ctx.storage.sql.exec("UPDATE fixture_provider SET now=?",input.now);if(input.alarmFails!==undefined)this.ctx.storage.sql.exec("UPDATE fixture_provider SET alarm_fails=?",input.alarmFails?1:0);if(input.destroyFails!==undefined)this.ctx.storage.sql.exec("UPDATE fixture_provider SET destroy_fails=?",input.destroyFails?1:0);if(input.inspectRunning!==undefined)this.ctx.storage.sql.exec("UPDATE fixture_provider SET inspect_running=?",input.inspectRunning?1:0);if(input.running!==undefined)this.ctx.storage.sql.exec("UPDATE fixture_provider SET running=?",input.running?1:0);}
   if(url.pathname==="/start"){await lifetime.beforeWork();if(!container.running){const alarm=await this.ctx.storage.getAlarm();if(alarm!==lifetime.status()?.deadline)throw new Error("Start was not prearmed");this.ctx.storage.sql.exec("UPDATE fixture_provider SET running=1,starts=starts+1");}}
   if(url.pathname==="/work")await lifetime.beforeWork();
   if(url.pathname==="/stop")await lifetime.stop();
   if(url.pathname==="/expiry")await lifetime.alarm();
   return Response.json({state:lifetime.status(),alarm:await this.ctx.storage.getAlarm(),provider:row()});
  }catch{return Response.json({state:lifetime.status(),alarm:await this.ctx.storage.getAlarm(),provider:row(),error:"Lifetime guard refused operation"},{status:409});}
 }
}
export default{fetch:(request:Request,env:{TEST:DurableObjectNamespace<LifetimeFixture>})=>env.TEST.getByName(new URL(request.url).searchParams.get("name")??"container").fetch(request)};
