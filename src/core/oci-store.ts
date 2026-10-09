/** Bounded, durable OCI content store. Namespaces never share unreferenced blobs. */
import { SqlKeyValue, ensureSchema, type SqlLike } from './durable-stores';
export interface OciRepository { ownerId:string; private:boolean }
export interface OciObject { data:string; mediaType:string; manifestMediaType?:string; size:number }
export interface OciUpload { ownerId:string; repository:string; data:string; size:number; expires:number }
export interface OciStore {
 repositories:MapLike<OciRepository>; objects:MapLike<OciObject>; tags:MapLike<string>; uploads:MapLike<OciUpload>;
}
export const OCI_CATALOG_ROW_LIMIT=9000;
export const OCI_UPLOAD_ROW_LIMIT=32;
export class OciCapacityError extends Error {constructor(){super('OCI row admission capacity reached');}}
interface MapLike<T> { get(key:string):T|undefined; set(key:string,value:T):void; delete(key:string):void; entries():[string,T][] }
class MemoryMap<T> implements MapLike<T> {
 private readonly values = new Map<string,T>();
 constructor(private readonly limit:number){}
 get(key:string){return this.values.get(key);}
 set(key:string,value:T){if(!this.values.has(key)&&this.values.size>=this.limit)throw new OciCapacityError();this.values.set(key,value);}
 delete(key:string){this.values.delete(key);}
 entries():[string,T][]{return [...this.values.entries()];}
}
class SqlMap<T> extends SqlKeyValue<T> implements MapLike<T> {
 constructor(private readonly connection:SqlLike,private readonly ns:string,private readonly limit:number){super(connection,ns);}
 override set(key:string,value:T){
  this.connection.exec('INSERT INTO kv(ns,k,v) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM kv WHERE ns=?)<? OR EXISTS(SELECT 1 FROM kv WHERE ns=? AND k=?) ON CONFLICT(ns,k) DO UPDATE SET v=excluded.v',this.ns,key,JSON.stringify(value),this.ns,this.limit,this.ns,key);
  if(!this.connection.exec('SELECT k FROM kv WHERE ns=? AND k=?',this.ns,key).toArray().length)throw new OciCapacityError();
 }
 delete(key:string){this.connection.exec('DELETE FROM kv WHERE ns = ? AND k = ?',this.ns,key);}
 entries():[string,T][]{const rows=this.connection.exec('SELECT k,v FROM kv WHERE ns = ? LIMIT ?',this.ns,this.limit+1).toArray() as {k:string;v:string}[];if(rows.length>this.limit)throw new OciCapacityError();return rows.map(row=>[row.k,JSON.parse(row.v) as T]);}
}
export function createOciStore(sql?:SqlLike):OciStore {if(!sql)return {repositories:new MemoryMap(OCI_CATALOG_ROW_LIMIT),objects:new MemoryMap(OCI_CATALOG_ROW_LIMIT),tags:new MemoryMap(OCI_CATALOG_ROW_LIMIT),uploads:new MemoryMap(OCI_UPLOAD_ROW_LIMIT)};ensureSchema(sql);return {repositories:new SqlMap(sql,'ociRepositories',OCI_CATALOG_ROW_LIMIT),objects:new SqlMap(sql,'ociObjects',OCI_CATALOG_ROW_LIMIT),tags:new SqlMap(sql,'ociTags',OCI_CATALOG_ROW_LIMIT),uploads:new SqlMap(sql,'ociUploads',OCI_UPLOAD_ROW_LIMIT)};}
export function encodeOciBytes(bytes:Uint8Array<ArrayBuffer>):string {let text='';for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text);}
export function decodeOciBytes(data:string):Uint8Array<ArrayBuffer>{return Uint8Array.from(atob(data),c=>c.charCodeAt(0));}
export async function ociDigest(bytes:Uint8Array<ArrayBuffer>):Promise<string>{return 'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
