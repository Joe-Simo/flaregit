import {createHash} from 'node:crypto';
import {z} from 'zod';
import {archiveIdentitySchema,type ArchiveIdentity} from '../core/metadata-archive';
import {MetadataArchiveError} from './metadata-archive';
export const archiveReleaseProofSchema=z.object({id:z.uuid(),sha256:z.string().regex(/^[a-f0-9]{64}$/),source:archiveIdentitySchema}).strict();
export function metadataReleaseDigest(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export type ArchiveReleaseProof=z.infer<typeof archiveReleaseProofSchema>;
/** Server-internal, short-lived receipts; canonical visibility snapshots never leave the DO. */
export class MetadataArchiveReleases{
 constructor(private storage:DurableObjectStorage){storage.sql.exec('CREATE TABLE IF NOT EXISTS metadata_archive_read_releases(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,sha256 TEXT NOT NULL,source TEXT NOT NULL,include_history INTEGER NOT NULL,visibility TEXT NOT NULL,expires_at INTEGER NOT NULL)');}
 prepare(userId:string,sha256:string,source:ArchiveIdentity,includeHistory:boolean,visibility:string):ArchiveReleaseProof{
  this.storage.sql.exec('DELETE FROM metadata_archive_read_releases WHERE expires_at<=?',Date.now());
  // A per-reader cap keeps one member from exhausting the shared release capacity.
  if(this.storage.sql.exec<{count:number}>('SELECT COUNT(*) AS count FROM metadata_archive_read_releases WHERE user_id=?',userId).toArray()[0]!.count>=5)throw new MetadataArchiveError('Too many pending archive releases; retry shortly',429);
  if(this.storage.sql.exec<{count:number}>('SELECT COUNT(*) AS count FROM metadata_archive_read_releases').toArray()[0]!.count>=100)throw new MetadataArchiveError('Archive release capacity reached; retry later',429);
  const proof=archiveReleaseProofSchema.parse({id:crypto.randomUUID(),sha256,source});
  this.storage.sql.exec('INSERT INTO metadata_archive_read_releases VALUES(?,?,?,?,?,?,?)',proof.id,userId,sha256,JSON.stringify(source),Number(includeHistory),createHash('sha256').update(visibility).digest('hex'),Date.now()+60000);return proof;
 }
 release(userId:string,value:unknown,source:ArchiveIdentity,includeHistory:boolean,visibility:string):true{
  const proof=archiveReleaseProofSchema.parse(value),row=this.storage.sql.exec<{user_id:string;sha256:string;source:string;include_history:number;visibility:string;expires_at:number}>('SELECT user_id,sha256,source,include_history,visibility,expires_at FROM metadata_archive_read_releases WHERE id=?',proof.id).toArray()[0];
  if(!row||row.user_id!==userId||row.sha256!==proof.sha256||row.source!==JSON.stringify(proof.source)||row.source!==JSON.stringify(source)||row.include_history!==Number(includeHistory)||row.expires_at<=Date.now()||row.visibility!==createHash('sha256').update(visibility).digest('hex'))throw new MetadataArchiveError('Archive visibility or authenticated release scope changed',409);
  this.storage.sql.exec('DELETE FROM metadata_archive_read_releases WHERE id=?',proof.id);return true;
 }
}
