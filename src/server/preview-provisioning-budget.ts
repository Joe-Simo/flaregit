import {z} from 'zod';
import type {PreviewOnboardingScope} from './preview-onboarding';
const slotSchema=z.object({scope:z.object({projectId:z.string().regex(/^[a-z0-9]{12,16}$/),incarnation:z.uuid(),ownerId:z.string().min(1).max(256),requestId:z.uuid()}).strict(),configuration:z.string().min(1).max(2000)}).strict();
/** Lifetime resource allowance: all rows, including retired assignments, remain charged. */
export class PreviewProvisioningBudget{
 constructor(private readonly storage:DurableObjectStorage){storage.sql.exec('CREATE TABLE IF NOT EXISTS preview_provisioning_slots(repository TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,doc TEXT NOT NULL)');}
 reserve(scope:PreviewOnboardingScope,configuration:string,limit:number){if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('Preview provisioning capacity disabled');const input=slotSchema.parse({scope,configuration});return this.storage.transactionSync(()=>{const prior=this.storage.sql.exec<{doc:string}>('SELECT doc FROM preview_provisioning_slots WHERE repository=?',scope.projectId).toArray()[0];if(prior){if(prior.doc!==JSON.stringify(input))throw Error('Original preview provisioning slot differs');return{reserved:true as const};}const total=this.storage.sql.exec<{total:number}>('SELECT COUNT(*) AS total FROM preview_provisioning_slots').toArray()[0]!.total;if(total>=limit)throw Error('Preview provisioning capacity exhausted');this.storage.sql.exec('INSERT INTO preview_provisioning_slots VALUES(?,?,?)',scope.projectId,scope.requestId,JSON.stringify(input));return{reserved:true as const};});}
}
