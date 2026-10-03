const testWriter={begin:async()=>{},beforePut:async()=>{},settledPut:async()=>{},finish:async()=>{}};
import {Database} from "bun:sqlite";
import {expect,test} from "bun:test";
import {PreviewStorageLedger} from "../src/server/preview-storage";
import {createPreviewStorageManifest,publishPreviewStorageManifest} from "../src/server/preview-storage-upload";
const identity={projectId:"p123456789abc",incarnation:"11111111-1111-4111-8111-111111111111",commit:"a".repeat(40),accountKey:"b".repeat(12)};
function fixture(){const db=new Database(":memory:");const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){if(query.includes(";")){db.exec(query);return{toArray:()=>[],one:()=>({})};}const rows=db.query(query).all(...bindings);return{toArray:()=>rows,one:()=>rows[0]};}},transactionSync<T>(callback:()=>T):T{return db.transaction(callback)();}};return{db,ledger:new PreviewStorageLedger(storage as unknown as DurableObjectStorage)};}
const manifest=(commit=identity.commit,accountKey=identity.accountKey)=>createPreviewStorageManifest({...identity,commit,accountKey},[{path:"index.html",size:3,sha256:"c".repeat(64)}]);
test("SQLite named byte reservations atomically enforce aggregate and owner limits",async()=>{
 const {ledger}=fixture(),policy={globalBytes:6,accountBytes:3};
 const results=await Promise.all(["a","d"].map(async letter=>{try{ledger.reserve(await manifest(letter.repeat(40)),policy);return true;}catch{return false;}}));
 expect(results.filter(Boolean)).toHaveLength(1);
 ledger.reserve(await manifest("e".repeat(40),"f".repeat(12)),policy);
 expect(()=>ledger.reserve({...awaitManifestForType(),identity:{...identity,commit:"0".repeat(40)}},policy)).toThrow();
});
// Synchronous valid shape used only to test a full aggregate envelope.
function awaitManifestForType(){return{version:1 as const,identity,assets:[{path:"index.html",size:3,sha256:"c".repeat(64)}],totalBytes:3,manifestHash:"d".repeat(64)};}
test("immutable physical prefix prevents retries reallocating or rewriting another incarnation",async()=>{
 const {db,ledger}=fixture(),m=await manifest(),policy={globalBytes:3,accountBytes:3};
 ledger.reserve(m,policy);ledger.reserve(m,{globalBytes:null,accountBytes:null});
 expect(db.query("SELECT SUM(bytes) AS n FROM preview_storage_reservations").get()).toEqual({n:3});
 expect(()=>ledger.reserve({...m,identity:{...m.identity,incarnation:crypto.randomUUID()}},policy)).toThrow("identity changed");
 expect(()=>ledger.reserve({...m,manifestHash:"f".repeat(64)},policy)).toThrow("identity changed");
});
test("unknown put outcome keeps retained admission while optional publication rejects",async()=>{
 const {db,ledger}=fixture();const bytes=new Uint8Array([1,2,3]);const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join("");
 const m=await createPreviewStorageManifest(identity,[{path:"index.html",size:3,sha256:digest}]);let puts=0;
 await expect(publishPreviewStorageManifest(m,{prefix:"builds/test",writer:testWriter,reserve:async value=>ledger.reserve(value,{globalBytes:3,accountBytes:3}),authorize:async()=>{},getFile:async()=>bytes,bucket:{head:async()=>null,put:async()=>{puts++;throw new Error("Response lost after storage accepted write");}}})).rejects.toThrow();
 expect(puts).toBe(1);expect(db.query("SELECT SUM(bytes) AS n FROM preview_storage_reservations").get()).toEqual({n:3});
 expect(()=>ledger.reserve(awaitManifestForType(),{globalBytes:3,accountBytes:3})).toThrow("identity changed");
});

test("refused immutable estimate can be readmitted after allowance changes without charging",async()=>{
 const {ledger,db}=fixture(),saved=await manifest();
 expect(()=>ledger.reserve(saved,{globalBytes:2,accountBytes:2})).toThrow();ledger.rememberRefusal(saved);
 expect(ledger.readmit(identity,{globalBytes:2,accountBytes:2})).toEqual({allowed:false,reason:"storage_capacity"});
 expect(ledger.readmit(identity,{globalBytes:3,accountBytes:3})).toEqual({allowed:true});
 expect(db.query("SELECT COUNT(*) AS n FROM preview_storage_reservations").get()).toEqual({n:0});
 ledger.reserve(saved,{globalBytes:3,accountBytes:3});
 expect(db.query("SELECT SUM(bytes) AS n FROM preview_storage_reservations").get()).toEqual({n:3});
 expect(ledger.readmit(identity,{globalBytes:30,accountBytes:30}).allowed).toBe(false);
});
test("refused estimate checks current owner incarnation retirement and deletion fence",async()=>{
 const {ledger,db}=fixture(),saved=await manifest();ledger.rememberRefusal(saved);const policy={globalBytes:30,accountBytes:30};
 expect(ledger.readmit({...identity,accountKey:"f".repeat(12)},policy).allowed).toBe(false);
 expect(ledger.readmit({...identity,incarnation:"2".repeat(36)},policy).allowed).toBe(false);
 db.query("INSERT INTO preview_copy_fences VALUES(?,?)").run(identity.projectId,identity.incarnation);
 expect(ledger.readmit(identity,policy)).toEqual({allowed:false,reason:"storage_retired"});
 db.query("DELETE FROM preview_copy_fences").run();db.query("INSERT INTO preview_copy_retirements VALUES(?,?)").run(`builds/${identity.projectId}/${identity.commit}`,"confirmed-retirement");
 expect(ledger.readmit(identity,policy)).toEqual({allowed:false,reason:"storage_retired"});
});
test("restored headroom enables check but unknown admitted writes remain held",async()=>{
 const {ledger,db}=fixture(),saved=await manifest();ledger.reserve(await manifest("d".repeat(40)),{globalBytes:3,accountBytes:3});ledger.rememberRefusal(saved);
 expect(ledger.readmit(identity,{globalBytes:3,accountBytes:3}).allowed).toBe(false);
 // Test-only simulation of sibling's independently confirmed cleanup receipt.
 db.query("DELETE FROM preview_storage_reservations WHERE physical_key=?").run(`builds/${identity.projectId}/${"d".repeat(40)}`);
 expect(ledger.readmit(identity,{globalBytes:3,accountBytes:3}).allowed).toBe(true);
 ledger.reserve(saved,{globalBytes:3,accountBytes:3});ledger.rememberRefusal({...saved,totalBytes:2});
 expect(ledger.readmit(identity,{globalBytes:99,accountBytes:99}).allowed).toBe(false);
 expect(db.query("SELECT SUM(bytes) AS bytes FROM preview_storage_reservations").get()).toEqual({bytes:3});
});
