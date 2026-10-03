import {Database} from "bun:sqlite";
import {expect,test} from "bun:test";
import {PreviewStorageLedger} from "../src/server/preview-storage";
import {createPreviewStorageManifest,publishPreviewStorageManifest} from "../src/server/preview-storage-upload";
const identity={projectId:"p123456789abc",incarnation:"11111111-1111-4111-8111-111111111111",commit:"a".repeat(40),accountKey:"b".repeat(12)};
function fixture(){const db=new Database(":memory:");const storage={sql:{exec(query:string,...bindings:Array<string|number|null>){const rows=db.query(query).all(...bindings);return{toArray:()=>rows,one:()=>rows[0]};}},transactionSync<T>(callback:()=>T):T{return db.transaction(callback)();}};return{db,ledger:new PreviewStorageLedger(storage as unknown as DurableObjectStorage)};}
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
 await expect(publishPreviewStorageManifest(m,{prefix:"builds/test",reserve:async value=>ledger.reserve(value,{globalBytes:3,accountBytes:3}),authorize:async()=>{},getFile:async()=>bytes,bucket:{head:async()=>null,put:async()=>{puts++;throw new Error("Response lost after storage accepted write");}}})).rejects.toThrow();
 expect(puts).toBe(1);expect(db.query("SELECT SUM(bytes) AS n FROM preview_storage_reservations").get()).toEqual({n:3});
 expect(()=>ledger.reserve(awaitManifestForType(),{globalBytes:3,accountBytes:3})).toThrow("identity changed");
});
