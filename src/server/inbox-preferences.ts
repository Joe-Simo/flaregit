import {z} from 'zod';
export const inboxPreferenceUpdate=z.object({mode:z.enum(['watching','unsubscribed','muted']),expectedVersion:z.number().int().nonnegative()}).strict();
export type InboxDeliveryMode=z.infer<typeof inboxPreferenceUpdate>['mode'];
export interface InboxPreference {readonly projectId:string;readonly mode:InboxDeliveryMode;readonly version:number}
const projectId=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,100}$/);
/** Repository delivery preferences do not mutate existing inbox rows or represent thread subscriptions. */
export class InboxPreferences {
 constructor(private readonly storage:DurableObjectStorage){storage.sql.exec('CREATE TABLE IF NOT EXISTS inbox_preferences(project_id TEXT PRIMARY KEY,mode TEXT NOT NULL,version INTEGER NOT NULL)');}
 read(id:string):InboxPreference{projectId.parse(id);const row=this.storage.sql.exec<{mode:InboxDeliveryMode;version:number}>('SELECT mode,version FROM inbox_preferences WHERE project_id=?',id).toArray()[0];return Object.freeze({projectId:id,mode:row?.mode??'watching',version:row?.version??0});}
 update(id:string,input:unknown):InboxPreference{const parsed=inboxPreferenceUpdate.parse(input);return this.storage.transactionSync(()=>{const previous=this.read(id);if(previous.version!==parsed.expectedVersion)throw Error('Notification preference changed; reload before saving');const next={projectId:id,mode:parsed.mode,version:previous.version+1};this.storage.sql.exec('INSERT INTO inbox_preferences VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET mode=excluded.mode,version=excluded.version',id,next.mode,next.version);return Object.freeze(next);});}
 allows(id:string,kind:'direct'|'activity'):boolean{const {mode}=this.read(id);return mode==='watching'||mode==='unsubscribed'&&kind==='direct';}
}
