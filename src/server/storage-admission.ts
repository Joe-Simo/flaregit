import { z } from "zod";
const nameSchema=z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const ownerSchema=z.string().min(1).max(200).regex(/^[A-Za-z0-9:_-]+$/);
const slotsSchema=z.number().int().nonnegative().max(1_000_000);
export const ARTIFACT_MAX_GB=1;
export const ARTIFACT_GB_MONTH_USD_MICROS=500_000;
export type ArtifactKind="canonical"|"workspace"|"import"|"temporary"|"existing";
export interface StorageAdmissionPolicy { globalSlots:number|null;accountSlots:number|null }
export type StorageReservation={allowed:true;existing:boolean}|{allowed:false;reason:"inventory_unverified"|"unconfigured"|"global_capacity"|"account_capacity"};
/** Conservative repository-count envelope, NOT observed bytes or an invoice.
 * Every named repository reserves the provider's full 1 GB maximum. No assumption
 * about fork deduplication, compressed packs, or deletion garbage collection. */
export class ArtifactStorageAdmission {
 constructor(private readonly storage:DurableObjectStorage){
  storage.sql.exec("CREATE TABLE IF NOT EXISTS artifact_storage_inventory(id INTEGER PRIMARY KEY,namespace TEXT NOT NULL,verified_at TEXT NOT NULL)");
  storage.sql.exec("CREATE TABLE IF NOT EXISTS artifact_storage_reservations(name TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,deleted_at TEXT)");
  storage.sql.exec("CREATE TABLE IF NOT EXISTS artifact_storage_projects(name TEXT PRIMARY KEY,project_id TEXT NOT NULL)");
  storage.sql.exec("CREATE TABLE IF NOT EXISTS artifact_storage_day_names(day TEXT NOT NULL,name TEXT NOT NULL,owner TEXT NOT NULL,PRIMARY KEY(day,name))");
  storage.sql.exec("CREATE TABLE IF NOT EXISTS artifact_storage_daily_peak(day TEXT NOT NULL,owner TEXT NOT NULL,slots INTEGER NOT NULL,PRIMARY KEY(day,owner))");
 }
 private day(now:Date){if(!Number.isFinite(now.getTime()))throw new Error("Invalid storage time");return now.toISOString().slice(0,10);}
 private active(owner?:string):number{return this.storage.sql.exec<{n:number}>(owner?"SELECT COUNT(*) AS n FROM artifact_storage_reservations WHERE state='reserved' AND owner=?":"SELECT COUNT(*) AS n FROM artifact_storage_reservations WHERE state='reserved'",...(owner?[owner]:[])).toArray()[0]?.n??0;}
 private peak(now:Date){const day=this.day(now);this.storage.sql.exec("INSERT OR IGNORE INTO artifact_storage_day_names SELECT ?,name,owner FROM artifact_storage_reservations WHERE state='reserved'",day);const owners=this.storage.sql.exec<{owner:string;n:number}>("SELECT owner,COUNT(*) AS n FROM artifact_storage_day_names WHERE day=? GROUP BY owner",day).toArray();const all=this.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM artifact_storage_day_names WHERE day=?",day).toArray()[0]?.n??0;for(const row of [{owner:"*",n:all},...owners])this.storage.sql.exec("INSERT INTO artifact_storage_daily_peak(day,owner,slots) VALUES(?,?,?) ON CONFLICT(day,owner) DO UPDATE SET slots=MAX(slots,excluded.slots)",day,row.owner,row.n);}
 private dayLiability(now:Date,owner?:string){this.peak(now);return this.storage.sql.exec<{n:number}>(owner?"SELECT COUNT(*) AS n FROM artifact_storage_day_names WHERE day=? AND owner=?":"SELECT COUNT(*) AS n FROM artifact_storage_day_names WHERE day=?",this.day(now),...(owner?[owner]:[])).toArray()[0]?.n??0;}
 /** Trusted control plane must verify current repository ownership before calling. */
 claimVerifiedExisting(name:string,owner:string,kind:ArtifactKind,confirmed:boolean,now=new Date()):void{
  nameSchema.parse(name);ownerSchema.parse(owner);if(confirmed!==true)throw new Error("Existing artifact ownership is unverified");
  this.storage.transactionSync(()=>{const row=this.storage.sql.exec<{owner:string;kind:string;state:string}>("SELECT owner,kind,state FROM artifact_storage_reservations WHERE name=?",name).toArray()[0];if(!row||row.state!=="reserved")throw new Error("Existing reservation missing");if(row.owner===owner&&row.kind===kind)return;if(row.owner!=="operator-existing"||row.kind!=="existing")throw new Error("Existing artifact ownership changed");this.storage.sql.exec("UPDATE artifact_storage_reservations SET owner=?,kind=? WHERE name=?",owner,kind,name);this.storage.sql.exec("UPDATE artifact_storage_day_names SET owner=? WHERE name=? AND day=?",owner,name,this.day(now));this.peak(now);});
 }

 /** Caller supplies a COMPLETE, stable provider listing. Missing names never release
  * earlier reservations: imports may still be pending and deletion may be uncertain. */
 reconcileCompleteInventory(namespace:string,names:readonly string[],now=new Date()):void{
  nameSchema.parse(namespace);if(names.length>100_000||new Set(names).size!==names.length)throw new Error("Invalid complete inventory");for(const name of names)nameSchema.parse(name);
  this.storage.transactionSync(()=>{const existing=this.storage.sql.exec<{namespace:string}>("SELECT namespace FROM artifact_storage_inventory WHERE id=1").toArray()[0];if(existing&&existing.namespace!==namespace)throw new Error("Storage namespace changed");for(const name of names){const row=this.storage.sql.exec<{state:string}>("SELECT state FROM artifact_storage_reservations WHERE name=?",name).toArray()[0];if(row?.state==="deleted")throw new Error("Deleted artifact reappeared; reconcile ownership explicitly");if(!row)this.storage.sql.exec("INSERT INTO artifact_storage_reservations VALUES(?,?,'existing','reserved',?,NULL)",name,"operator-existing",now.toISOString());}this.storage.sql.exec("INSERT INTO artifact_storage_inventory VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET verified_at=excluded.verified_at",namespace,now.toISOString());this.peak(now);});
 }
 associateProject(name:string,projectId:string):void{nameSchema.parse(name);nameSchema.parse(projectId);const existing=this.storage.sql.exec<{project_id:string}>("SELECT project_id FROM artifact_storage_projects WHERE name=?",name).toArray()[0];if(existing&&existing.project_id!==projectId)throw new Error("Artifact project changed");this.storage.sql.exec("INSERT OR IGNORE INTO artifact_storage_projects VALUES(?,?)",name,projectId);}
 ownerManifest(owner:string):Array<{name:string;state:string;projectId:string|null}>{ownerSchema.parse(owner);return this.storage.sql.exec<{name:string;state:string;projectId:string|null}>("SELECT r.name,r.state,p.project_id AS projectId FROM artifact_storage_reservations r LEFT JOIN artifact_storage_projects p ON r.name=p.name WHERE r.owner=? ORDER BY r.name",owner).toArray();}
 projectManifest(projectId:string):Array<{name:string;state:string}>{nameSchema.parse(projectId);return this.storage.sql.exec<{name:string;state:string}>("SELECT r.name,r.state FROM artifact_storage_reservations r JOIN artifact_storage_projects p ON r.name=p.name WHERE p.project_id=? ORDER BY r.name",projectId).toArray();}
 reserve(name:string,owner:string,kind:ArtifactKind,policy:StorageAdmissionPolicy,now=new Date()):StorageReservation{
  nameSchema.parse(name);ownerSchema.parse(owner);z.enum(["canonical","workspace","import","temporary","existing"]).parse(kind);this.day(now);
  return this.storage.transactionSync(()=>{
   if(!this.storage.sql.exec("SELECT id FROM artifact_storage_inventory WHERE id=1").toArray().length)return {allowed:false,reason:"inventory_unverified"};
   const existing=this.storage.sql.exec<{owner:string;kind:string;state:string}>("SELECT owner,kind,state FROM artifact_storage_reservations WHERE name=?",name).toArray()[0];
   if(existing){if(existing.owner!==owner||existing.kind!==kind||existing.state!=="reserved")throw new Error("Artifact reservation identity changed");this.peak(now);return {allowed:true,existing:true};}
   if(policy.globalSlots===null||policy.accountSlots===null)return {allowed:false,reason:"unconfigured"};
   const global=slotsSchema.parse(policy.globalSlots),account=slotsSchema.parse(policy.accountSlots);
   if(this.dayLiability(now)+1>global)return {allowed:false,reason:"global_capacity"};if(this.dayLiability(now,owner)+1>account)return {allowed:false,reason:"account_capacity"};
   this.storage.sql.exec("INSERT INTO artifact_storage_reservations VALUES(?,?,?,'reserved',?,NULL)",name,owner,kind,now.toISOString());this.peak(now);return {allowed:true,existing:false};
  });
 }
 /** Call ONLY after confirmed provider deletion, never on timeout or absence from listing. */
 recordConfirmedDeletion(name:string,confirmed:boolean,now=new Date()):void{
  nameSchema.parse(name);if(confirmed!==true)throw new Error("Provider deletion is unconfirmed");this.day(now);
  this.storage.transactionSync(()=>{this.peak(now);this.storage.sql.exec("UPDATE artifact_storage_reservations SET state='deleted',deleted_at=? WHERE name=? AND state='reserved'",now.toISOString(),name);});
 }
 capacity(owner:string,namespace:string|undefined,policy:StorageAdmissionPolicy,now=new Date()){
  ownerSchema.parse(owner);const row=this.storage.sql.exec<{namespace:string;verified_at:string}>("SELECT namespace,verified_at FROM artifact_storage_inventory WHERE id=1").toArray()[0],matches=!!row&&row.namespace===namespace&&Number.isFinite(Date.parse(row.verified_at));
  const globalUsed=matches?this.dayLiability(now):null,accountUsed=matches?this.dayLiability(now,owner):null;
  const limits={global:policy.globalSlots===null?null:slotsSchema.parse(policy.globalSlots),account:policy.accountSlots===null?null:slotsSchema.parse(policy.accountSlots)};
  const availability=limits.global===null||limits.account===null?'unconfigured' as const:limits.global===0||limits.account===0?'full' as const:!matches?'unknown' as const:globalUsed!>=limits.global||accountUsed!>=limits.account?'full' as const:'available' as const;
  return{source:'recorded-ledger' as const,basis:'daily_named_repository_envelope' as const,reservationCreated:false as const,providerVerified:false as const,inventory:matches?'recorded' as const:'unknown' as const,verifiedAt:matches?row.verified_at:null,checkedAt:now.toISOString(),availability,global:{used:globalUsed,limit:limits.global},account:{used:accountUsed,limit:limits.account}};
 }
 snapshot(now=new Date()){
  this.peak(now);return {basis:"provider_maximum_per_named_repository" as const,verified:this.storage.sql.exec("SELECT id FROM artifact_storage_inventory WHERE id=1").toArray().length===1,activeSlots:this.active(),maximumGb:this.active()*ARTIFACT_MAX_GB,dailyPeaks:this.storage.sql.exec<{day:string;owner:string;slots:number}>("SELECT day,owner,slots FROM artifact_storage_daily_peak ORDER BY day,owner").toArray(),reservations:this.storage.sql.exec<{name:string;owner:string;kind:ArtifactKind;state:"reserved"|"deleted"}>("SELECT name,owner,kind,state FROM artifact_storage_reservations ORDER BY name").toArray()};
 }
}
