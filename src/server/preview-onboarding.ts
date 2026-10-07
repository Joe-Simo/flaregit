import {z} from 'zod';
const scopeSchema=z.object({projectId:z.string().regex(/^[a-z0-9]{12,16}$/),incarnation:z.uuid(),ownerId:z.string().min(1).max(256),requestId:z.uuid()}).strict();
export type PreviewOnboardingScope=z.infer<typeof scopeSchema>;
export interface PreviewProvisioningRecord{scope:PreviewOnboardingScope;workerName:string;origin:string;phase:'reserved'|'dispatch_unknown'|'deployed'|'active'|'retired';failure:'provider_unavailable'|'registration_unavailable'|'dispatch_unconfirmed'|null}
export interface PreviewOnboardingPorts{
 /** Checks current repository owner, incarnation and platform provisioning allowance. */
 authorize(scope:PreviewOnboardingScope):Promise<void>;
 assertCurrent(scope:PreviewOnboardingScope):void;
 /** Provider read must verify exact module digest and repository/broker bindings. */
 observe(record:PreviewProvisioningRecord):Promise<'absent'|'exact'|'different'|'unknown'>;
 deploy(record:PreviewProvisioningRecord):Promise<void>;
 /** Idempotent exact exclusive registration keyed by immutable scope.requestId; replay must not create resources. */
 register(record:PreviewProvisioningRecord):Promise<void>;
}
/** Server-owned exclusive names; a caller supplies no Worker name, origin, credential or module. */
export class PreviewOnboarding{
 constructor(private readonly storage:DurableObjectStorage,private readonly subdomain:string,private readonly ports:PreviewOnboardingPorts){if(!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain))throw Error('Invalid provisioning subdomain');storage.sql.exec('CREATE TABLE IF NOT EXISTS preview_onboarding(repository TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,origin TEXT UNIQUE NOT NULL,doc TEXT NOT NULL)');}
 get(projectId:string):PreviewProvisioningRecord|null{const row=this.storage.sql.exec<{doc:string}>('SELECT doc FROM preview_onboarding WHERE repository=?',projectId).toArray()[0];return row?JSON.parse(row.doc) as PreviewProvisioningRecord:null;}
 private save(record:PreviewProvisioningRecord){this.storage.sql.exec('UPDATE preview_onboarding SET doc=? WHERE repository=?',JSON.stringify(record),record.scope.projectId);}
 private exact(scope:PreviewOnboardingScope){this.ports.assertCurrent(scope);const record=this.get(scope.projectId);if(!record||JSON.stringify(record.scope)!==JSON.stringify(scope)||record.phase==='retired')throw Error('Original preview allocation changed or retired');return record;}
 async prepare(input:PreviewOnboardingScope){const scope=scopeSchema.parse(input);await this.ports.authorize(scope);return this.storage.transactionSync(()=>{this.ports.assertCurrent(scope);const prior=this.get(scope.projectId);if(prior){this.exact(scope);return prior;}const workerName=`fg-preview-${scope.projectId}-${scope.incarnation.replaceAll('-','')}`,origin=`https://${workerName}.${this.subdomain}.workers.dev`,record:PreviewProvisioningRecord={scope,workerName,origin,phase:'reserved',failure:null};this.storage.sql.exec('INSERT INTO preview_onboarding VALUES(?,?,?,?)',scope.projectId,scope.requestId,origin,JSON.stringify(record));return record;});}
 async resume(input:PreviewOnboardingScope){const scope=scopeSchema.parse(input);await this.ports.authorize(scope);let record=this.exact(scope);if(record.phase==='active')return record;
 try{const observed=await this.ports.observe(record);await this.ports.authorize(scope);record=this.exact(scope);if(record.phase==='active')return record;if(observed==='different')throw Error('Exclusive Worker identity differs');if(observed==='unknown')return this.fail(record,'provider_unavailable');
 if(observed==='absent'){if(record.phase!=='reserved')return this.fail(record,'dispatch_unconfirmed');this.storage.transactionSync(()=>{record=this.exact(scope);if(record.phase!=='reserved')throw Error('Provisioning dispatch already claimed');record={...record,phase:'dispatch_unknown',failure:null};this.save(record);});try{await this.ports.deploy(record);}catch{return this.fail(this.exact(scope),'provider_unavailable');}await this.ports.authorize(scope);if(await this.ports.observe(record)!=='exact')return this.fail(this.exact(scope),'provider_unavailable');await this.ports.authorize(scope);}
 record=this.exact(scope);record={...record,phase:'deployed',failure:null};this.save(record);await this.ports.register(record);await this.ports.authorize(scope);record=this.exact(scope);record={...record,phase:'active',failure:null};this.save(record);return record;
 }catch(error){const current=this.exact(scope);if(current.phase==='active')return current;if(current.phase==='deployed')return this.fail(current,'registration_unavailable');throw error;}}
 private fail(record:PreviewProvisioningRecord,failure:PreviewProvisioningRecord['failure']){const current=this.exact(record.scope),next={...current,failure};this.save(next);return next;}
 retire(projectId:string){const record=this.get(projectId);if(!record)return;this.save({...record,phase:'retired',failure:null});}
 view(projectId:string){const record=this.get(projectId);return record?{status:record.phase,reason:record.failure,canRetry:record.phase!=='retired'&&record.phase!=='active'&&record.failure!=='dispatch_unconfirmed',...(record.failure==='dispatch_unconfirmed'?{nextAction:'reconcile_original_dispatch' as const}:{}),...(record.phase==='active'?{origin:record.origin}:{})}:{status:'unconfigured' as const,canRetry:false};}
}
