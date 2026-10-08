/** Bounded, durable OCI content store. Namespaces never share unreferenced blobs. */
import { SqlKeyValue, ensureSchema, type SqlLike } from './durable-stores';
export interface OciRepository { ownerId:string; private:boolean }
export interface OciObject { data:string; mediaType:string; size:number }
export interface OciUpload { ownerId:string; repository:string; data:string; size:number; expires:number }
export interface OciStore {
 repositories:MapLike<OciRepository>; objects:MapLike<OciObject>; tags:MapLike<string>; uploads:MapLike<OciUpload>;
}
interface MapLike<T> { get(key:string):T|undefined; set(key:string,value:T):void; delete(key:string):void; entries():[string,T][] }
class MemoryMap<T> implements MapLike<T> {
 private readonly values = new Map<string,T>();
 get(key:string){return this.values.get(key);}
 set(key:string,value:T){this.values.set(key,value);}
 delete(key:string){this.values.delete(key);}
 entries():[string,T][]{return [...this.values.entries()];}
}
class SqlMap<T> extends SqlKeyValue<T> implements MapLike<T> {
 constructor(private readonly connection:SqlLike,private readonly ns:string){super(connection,ns);}
 delete(key:string){this.connection.exec('DELETE FROM kv WHERE ns = ? AND k = ?',this.ns,key);}
 entries():[string,T][]{const rows=this.connection.exec('SELECT k,v FROM kv WHERE ns = ? LIMIT 10001',this.ns).toArray() as {k:string;v:string}[];if(rows.length>10000)throw Error('OCI capacity exceeded');return rows.map(row=>[row.k,JSON.parse(row.v) as T]);}
}
export function createOciStore(sql?:SqlLike):OciStore {if(!sql)return {repositories:new MemoryMap(),objects:new MemoryMap(),tags:new MemoryMap(),uploads:new MemoryMap()};ensureSchema(sql);return {repositories:new SqlMap(sql,'ociRepositories'),objects:new SqlMap(sql,'ociObjects'),tags:new SqlMap(sql,'ociTags'),uploads:new SqlMap(sql,'ociUploads')};}
export function encodeOciBytes(bytes:Uint8Array<ArrayBuffer>):string {let text='';for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text);}
export function decodeOciBytes(data:string):Uint8Array<ArrayBuffer>{return Uint8Array.from(atob(data),c=>c.charCodeAt(0));}
export async function ociDigest(bytes:Uint8Array<ArrayBuffer>):Promise<string>{return 'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
