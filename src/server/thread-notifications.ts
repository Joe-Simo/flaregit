import type {MentionRecipient} from './plain-text-mentions';
import {z} from 'zod';
export const threadSubjectSchema=z.string().regex(/^(?:issue:[1-9][0-9]{0,6}|change:[a-z0-9][a-z0-9-]{2,100}|candidate:[a-z0-9_-]{3,60})$/);
export const threadPreferenceUpdate=z.object({mode:z.enum(['subscribed','unsubscribed','muted']),expectedVersion:z.number().int().nonnegative().safe()}).strict();
export type ThreadMode=z.infer<typeof threadPreferenceUpdate>['mode'];
export interface ThreadPreference{subject:string;mode:ThreadMode;version:number}
export type ThreadNotification={incarnation:string;comment_id:number;actor_id:string;subject:string;preference_version:number;delivery_kind?:'subscription'|'mention'}
/** Only private canonical threads. Source comments and preferences share the
 * repository transaction; delivery retries retain the exact original source. */
export class ThreadNotifications{
 constructor(private readonly storage:Pick<DurableObjectStorage,'sql'|'transactionSync'>){
  storage.sql.exec('CREATE TABLE IF NOT EXISTS thread_preferences(incarnation TEXT NOT NULL,subject TEXT NOT NULL,actor_id TEXT NOT NULL,mode TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(incarnation,subject,actor_id)); CREATE TABLE IF NOT EXISTS thread_notification_outbox(incarnation TEXT NOT NULL,comment_id INTEGER NOT NULL,actor_id TEXT NOT NULL,subject TEXT NOT NULL,preference_version INTEGER NOT NULL,PRIMARY KEY(incarnation,comment_id,actor_id)); CREATE TABLE IF NOT EXISTS thread_notification_evidence(incarnation TEXT NOT NULL,comment_id INTEGER NOT NULL,actor_id TEXT NOT NULL,kind TEXT NOT NULL,handle TEXT,account_key TEXT,profile_version INTEGER,preference_version INTEGER NOT NULL,PRIMARY KEY(incarnation,comment_id,actor_id))');
  if(!storage.sql.exec<{name:string}>('PRAGMA table_info(thread_preferences)').toArray().some(column=>column.name==='last_mute_version')){storage.sql.exec('ALTER TABLE thread_preferences ADD COLUMN last_mute_version INTEGER NOT NULL DEFAULT 0');storage.sql.exec('UPDATE thread_preferences SET last_mute_version=version');}
  if(!storage.sql.exec<{name:string}>('PRAGMA table_info(thread_notification_outbox)').toArray().some(column=>column.name==='delivery_kind'))storage.sql.exec("ALTER TABLE thread_notification_outbox ADD COLUMN delivery_kind TEXT NOT NULL DEFAULT 'subscription'");
  if(!storage.sql.exec<{name:string}>('PRAGMA table_info(thread_notification_evidence)').toArray().some(column=>column.name==='authority_source'))storage.sql.exec('ALTER TABLE thread_notification_evidence ADD COLUMN authority_source TEXT');
 }
 read(incarnation:string,subject:string,userId:string):ThreadPreference{
  z.uuid().parse(incarnation);threadSubjectSchema.parse(subject);z.string().min(1).max(256).parse(userId);
  const row=this.storage.sql.exec<{mode:ThreadMode;version:number}>('SELECT mode,version FROM thread_preferences WHERE incarnation=? AND subject=? AND actor_id=?',incarnation,subject,userId).toArray()[0];
  return{subject,mode:row?.mode??'unsubscribed',version:row?.version??0};
 }
 update(incarnation:string,subject:string,userId:string,input:unknown,authorize:()=>void):ThreadPreference{
  const value=threadPreferenceUpdate.parse(input);
  return this.storage.transactionSync(()=>{authorize();const current=this.read(incarnation,subject,userId);if(current.version!==value.expectedVersion)throw Error('Thread preference changed; reload before saving');if(current.version===0&&this.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM thread_preferences').one().n>=10000)throw Error('Thread preference capacity reached');if(current.version>=10000)throw Error('Thread preference version capacity reached');const next={subject,mode:value.mode,version:current.version+1};const previousMute=this.lastMuteVersion(incarnation,subject,userId);this.storage.sql.exec('INSERT INTO thread_preferences(incarnation,subject,actor_id,mode,version,last_mute_version) VALUES(?,?,?,?,?,?) ON CONFLICT(incarnation,subject,actor_id) DO UPDATE SET mode=excluded.mode,version=excluded.version,last_mute_version=excluded.last_mute_version',incarnation,subject,userId,next.mode,next.version,next.mode==='muted'?next.version:previousMute);return next;});
 }
 stage(incarnation:string,subject:string,commentId:number,authorId?:string,mentions:readonly MentionRecipient[]=[]){
  z.uuid().parse(incarnation);threadSubjectSchema.parse(subject);z.number().int().positive().safe().parse(commentId);
  const recipients=this.storage.sql.exec<{actor_id:string;version:number}>('SELECT actor_id,version FROM thread_preferences WHERE incarnation=? AND subject=? AND mode=\'subscribed\' AND actor_id!=? LIMIT 1001',incarnation,subject,authorId??'').toArray();
  const classified=new Map(recipients.map(recipient=>[recipient.actor_id,{version:recipient.version,kind:'subscription' as 'subscription'|'mention',mention:undefined as MentionRecipient|undefined}]));
  for(const mention of mentions){if(mention.userId===authorId)continue;const preference=this.read(incarnation,subject,mention.userId);if(preference.mode!=='muted')classified.set(mention.userId,{version:preference.version,kind:'mention',mention});}
  if(classified.size>1000||this.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM thread_notification_outbox').one().n+classified.size>10000||this.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM thread_notification_evidence').one().n+classified.size>100000)throw Error('Thread notification capacity reached');
  for(const [actorId,value] of classified){
   this.storage.sql.exec('INSERT OR IGNORE INTO thread_notification_outbox(incarnation,comment_id,actor_id,subject,preference_version,delivery_kind) VALUES(?,?,?,?,?,?)',incarnation,commentId,actorId,subject,value.version,value.kind);
   this.storage.sql.exec('INSERT OR IGNORE INTO thread_notification_evidence(incarnation,comment_id,actor_id,kind,handle,account_key,profile_version,preference_version,authority_source) VALUES(?,?,?,?,?,?,?,?,?)',incarnation,commentId,actorId,value.kind,value.mention?.handle??null,value.mention?.accountKey??null,value.mention?.profileVersion??null,value.version,value.mention?.authoritySource??null);
  }
 }
 pending():ThreadNotification[]{return this.storage.sql.exec<ThreadNotification>('SELECT * FROM thread_notification_outbox ORDER BY rowid LIMIT 25').toArray();}
 private lastMuteVersion(incarnation:string,subject:string,userId:string){return this.storage.sql.exec<{last_mute_version:number}>('SELECT last_mute_version FROM thread_preferences WHERE incarnation=? AND subject=? AND actor_id=?',incarnation,subject,userId).toArray()[0]?.last_mute_version??0;}
 available(item:ThreadNotification){
  const preference=this.read(item.incarnation,item.subject,item.actor_id),evidence=this.evidence(item),kind=item.delivery_kind??'subscription';
  const allowed=kind==='mention'
   ? preference.mode!=='muted'&&preference.version>=item.preference_version&&this.lastMuteVersion(item.incarnation,item.subject,item.actor_id)<=item.preference_version&&evidence?.kind==='mention'&&evidence.preference_version===item.preference_version
   : preference.mode==='subscribed'&&preference.version===item.preference_version;
  return (!evidence||evidence.kind===kind)&&allowed&&this.storage.sql.exec('SELECT 1 FROM comments WHERE id=? AND subject=?',item.comment_id,item.subject).toArray().length===1;
 }
 evidence(item:Pick<ThreadNotification,'incarnation'|'comment_id'|'actor_id'>){return this.storage.sql.exec<{kind:'subscription'|'mention';handle:string|null;account_key:string|null;profile_version:number|null;preference_version:number;authority_source:string|null}>('SELECT kind,handle,account_key,profile_version,preference_version,authority_source FROM thread_notification_evidence WHERE incarnation=? AND comment_id=? AND actor_id=?',item.incarnation,item.comment_id,item.actor_id).toArray()[0];}
 acknowledge(item:ThreadNotification){this.storage.sql.exec('DELETE FROM thread_notification_outbox WHERE incarnation=? AND comment_id=? AND actor_id=?',item.incarnation,item.comment_id,item.actor_id);}
 hasPending(){return this.storage.sql.exec('SELECT 1 FROM thread_notification_outbox LIMIT 1').toArray().length>0;}
}
