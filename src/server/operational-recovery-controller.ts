import {DurableObject} from 'cloudflare:workers';
import {z} from 'zod';
import type {Env} from './env';
import {restoreOperationalBackup,type SignedOperationalBackup,type BackupScope} from './operational-backup';

/** Separate SQL namespace with no repository, credential, workflow, or publication RPCs.
 * Restored provider authority remains inert evidence; this object never executes it.
 */
export class OperationalRecoveryController extends DurableObject<Env>{
 async restore(backup:SignedOperationalBackup,scope:BackupScope){
  const authorize=()=>{if(!this.env.OPERATIONAL_BACKUP_KEY||!this.env.OPERATIONAL_RECOVERY_GIT)throw Error('Isolated recovery configuration unavailable');};authorize();
  let clone:{cloneId:string;head:string|null;objectsHash:string;canonicalRepository:string;isolated:true}|undefined;
  const receipt=await restoreOperationalBackup(this.ctx.storage,backup,this.env.OPERATIONAL_BACKUP_KEY!,scope,async()=>{
   const response=await this.env.OPERATIONAL_RECOVERY_GIT!.fetch('https://isolated-recovery.internal/clone',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:1,scope,mode:'isolated-read-only',publish:false})});
   if(!response.ok)return false;
   clone=z.object({cloneId:z.string().min(1).max(256),head:z.string().regex(/^[a-f0-9]{40,64}$/).nullable(),objectsHash:z.string().regex(/^[a-f0-9]{64}$/),isolated:z.literal(true),canonicalRepository:z.string()}).strict().parse(await response.json());
   return clone.head===scope.head&&clone.canonicalRepository===scope.canonicalRepository;
  },authorize);
  return {...receipt,nativeClone:clone};
 }
}
