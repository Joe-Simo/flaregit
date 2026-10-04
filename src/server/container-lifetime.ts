export const MANAGED_CONTAINER_LIFETIME_MS=20*60_000;
export const AGENT_CONTAINER_LIFETIME_MS=5*60_000;
const RETRY_MS=30_000;
export interface ContainerLifetimeState{sealed?:true;deadline:number;firstStartedAt:number;state:"armed"|"stopping"|"stopped";lastFailure?:"stop-unconfirmed"|"alarm-unavailable"}
export interface StoppableContainer{readonly running:boolean;destroy():Promise<void>;inspect():Promise<unknown|null>}
async function bounded<T>(operation:Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Container provider response timed out")),10_000);})]);}finally{if(timer!==undefined)clearTimeout(timer);}}

/** Attempt-wide deadline, persisted before provisioning. Activity, eviction and
 * early stop/restart never grant another lifetime. Provider failures retain the
 * deadline and retry alarm rather than claiming the VM stopped or billing ended.
 */
export class ContainerLifetime{
 constructor(private readonly storage:Pick<DurableObjectStorage,"sql"|"setAlarm"|"deleteAlarm">,private readonly container:()=>StoppableContainer|undefined,private readonly lifetimeMs=MANAGED_CONTAINER_LIFETIME_MS,private readonly now=()=>Date.now()){
  storage.sql.exec("CREATE TABLE IF NOT EXISTS managed_container_lifetime(id INTEGER PRIMARY KEY CHECK(id=1),doc TEXT NOT NULL)");
  storage.sql.exec("CREATE TABLE IF NOT EXISTS managed_container_seal(id INTEGER PRIMARY KEY CHECK(id=1),sealed_at INTEGER NOT NULL)");
 }
 status():ContainerLifetimeState|null{const row=this.storage.sql.exec<{doc:string}>("SELECT doc FROM managed_container_lifetime WHERE id=1").toArray()[0];return row?{...JSON.parse(row.doc) as ContainerLifetimeState,...(this.sealed()?{sealed:true as const}:{})}:null;}
 private sealed():boolean{return this.storage.sql.exec("SELECT id FROM managed_container_seal WHERE id=1").toArray().length>0;}
 /** One-shot UUID callers seal before stop. Neither work, alarm nor eviction can undo it. */
 seal():void{
  this.storage.sql.exec("INSERT OR IGNORE INTO managed_container_seal VALUES(1,?)",this.now());
  if(!this.status()){const now=this.now();this.save({firstStartedAt:now,deadline:now,state:"stopping",sealed:true});}
 }
 /** Synchronous check directly before each native provisioning/dispatch call. */
 assertWorkAllowed():void{if(this.sealed())throw new Error("Managed container attempt is permanently sealed; use a new attempt identity");}
 private save(state:ContainerLifetimeState){this.storage.sql.exec("INSERT INTO managed_container_lifetime VALUES(1,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc",JSON.stringify(state));}
 async beforeWork():Promise<void>{
  this.assertWorkAllowed();
  let state=this.status();const container=this.container();if(!container)throw new Error("Container binding is not configured");
  if(!state){const now=this.now();state={firstStartedAt:now,deadline:container.running?now:now+this.lifetimeMs,state:container.running?"stopping":"armed"};this.save(state);}
  if(state.state==="stopping"||state.deadline<=this.now()){await this.stop();throw new Error("Managed container hard lifetime expired; recover saved work in a new attempt");}
  // Await durable prearming before a caller may invoke container.start().
  await this.storage.setAlarm(state.deadline);
  this.assertWorkAllowed();
  const current=this.status();if(current?.state==="stopping")throw new Error("Managed container stop is in progress; use a new attempt identity");
  if(state.deadline<=this.now()){await this.stop();throw new Error("Managed container hard lifetime expired before provisioning");}
  if(state.state==="stopped")this.save({...state,state:"armed",lastFailure:undefined});
 }
 async stop():Promise<void>{
  let state=this.status();if(!state){const now=this.now();state={firstStartedAt:now,deadline:now,state:"stopping"};}
  state={...state,state:"stopping"};this.save(state);
  let alarmFailed=false;
  try{await this.storage.setAlarm(this.now()+RETRY_MS);}catch{alarmFailed=true;console.error("Managed container stop retry alarm unavailable");}
  const container=this.container();
  try{
   if(!container)throw new Error("Container stop cannot be verified");
   await bounded(container.destroy());
   const observed=await bounded(container.inspect());
   if(observed!==null||container.running)throw new Error("Container stop is not confirmed");
   this.save({...state,state:"stopped",lastFailure:undefined});
  }catch{
   this.save({...state,state:"stopping",lastFailure:alarmFailed?"alarm-unavailable":"stop-unconfirmed"});
   try{await this.storage.setAlarm(this.now()+RETRY_MS);}catch{console.error("Managed container stop retry alarm unavailable");}
   console.error("Managed container stop remains unconfirmed; retry scheduled and work refused");
   throw new Error("Managed container stop could not be confirmed");
  }
  try{await this.storage.deleteAlarm();}catch{
   this.save({...state,state:"stopped",lastFailure:"alarm-unavailable"});
   console.error("Managed container stop confirmed; alarm cleanup unavailable");
   throw new Error("Managed container stopped but alarm cleanup could not be confirmed");
  }
 }
 async alarm():Promise<void>{const state=this.status();if(!state){if(this.container()?.running)await this.stop();return;}if(state.state==="stopped")return;if(state.deadline>this.now()&&state.state==="armed"){await this.storage.setAlarm(state.deadline);return;}await this.stop();}
}
