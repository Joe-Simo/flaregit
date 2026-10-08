import {z} from 'zod';
export const threadSubjectSchema=z.string().regex(/^(?:issue:[1-9][0-9]{0,6}|change:[a-z0-9][a-z0-9-]{2,100}|candidate:[a-z0-9_-]{3,60})$/);
export const threadPreferenceUpdate=z.object({mode:z.enum(['subscribed','unsubscribed','muted']),expectedVersion:z.number().int().nonnegative().safe()}).strict();
export type ThreadMode=z.infer<typeof threadPreferenceUpdate>['mode'];
export interface ThreadPreference{subject:string;mode:ThreadMode;version:number}
export type ThreadNotification={incarnation:string;comment_id:number;actor_id:string;subject:string;preference_version:number}
/** Only private canonical threads. Source comments and preferences share the
 * repository transaction; delivery retries retain the exact original source. */
export class ThreadNotifications{
 constructor(private readonly storage:Pick<DurableObjectStorage,'sql'|'transactionSync'>){
  storage.sql.exec('CREATE TABLE IF NOT EXISTS thread_preferences(incarnation TEXT NOT NULL,subject TEXT NOT NULL,actor_id TEXT NOT NULL,mode TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(incarnation,subject,actor_id)); CREATE TABLE IF NOT EXISTS thread_notification_outbox(incarnation TEXT NOT NULL,comment_id INTEGER NOT NULL,actor_id TEXT NOT NULL,subject TEXT NOT NULL,preference_version INTEGER NOT NULL,PRIMARY KEY(incarnation,comment_id,actor_id))');
 }
 read(incarnation:string,subject:string,userId:string):ThreadPreference{
  z.uuid().parse(incarnation);threadSubjectSchema.parse(subject);z.string().min(1).max(256).parse(userId);
  const row=this.storage.sql.exec<{mode:ThreadMode;version:number}>('SELECT mode,version FROM thread_preferences WHERE incarnation=? AND subject=? AND actor_id=?',incarnation,subject,userId).toArray()[0];
  return{subject,mode:row?.mode??'unsubscribed',version:row?.version??0};
 }
 update(incarnation:string,subject:string,userId:string,input:unknown,authorize:()=>void):ThreadPreference{
  const value=threadPreferenceUpdate.parse(input);
  return this.storage.transactionSync(()=>{authorize();const current=this.read(incarnation,subject,userId);if(current.version!==value.expectedVersion)throw Error('Thread preference changed; reload before saving');if(current.version===0&&this.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM thread_preferences').one().n>=10000)throw Error('Thread preference capacity reached');if(current.version>=10000)throw Error('Thread preference version capacity reached');const next={subject,mode:value.mode,version:current.version+1};this.storage.sql.exec('INSERT INTO thread_preferences VALUES(?,?,?,?,?) ON CONFLICT(incarnation,subject,actor_id) DO UPDATE SET mode=excluded.mode,version=excluded.version',incarnation,subject,userId,next.mode,next.version);return next;});
 }
 stage(incarnation:string,subject:string,commentId:number,authorId?:string){
  z.uuid().parse(incarnation);threadSubjectSchema.parse(subject);z.number().int().positive().safe().parse(commentId);
  const recipients=this.storage.sql.exec<{actor_id:string;version:number}>('SELECT actor_id,version FROM thread_preferences WHERE incarnation=? AND subject=? AND mode=\'subscribed\' AND actor_id!=? LIMIT 1001',incarnation,subject,authorId??'').toArray();
  if(recipients.length>1000||this.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM thread_notification_outbox').one().n+recipients.length>10000)throw Error('Thread notification capacity reached');
  for(const recipient of recipients)this.storage.sql.exec('INSERT OR IGNORE INTO thread_notification_outbox VALUES(?,?,?,?,?)',incarnation,commentId,recipient.actor_id,subject,recipient.version);
 }
 pending():ThreadNotification[]{return this.storage.sql.exec<ThreadNotification>('SELECT * FROM thread_notification_outbox ORDER BY rowid LIMIT 25').toArray();}
 available(item:ThreadNotification){const preference=this.read(item.incarnation,item.subject,item.actor_id);return preference.mode==='subscribed'&&preference.version===item.preference_version&&this.storage.sql.exec('SELECT 1 FROM comments WHERE id=? AND subject=?',item.comment_id,item.subject).toArray().length===1;}
 acknowledge(item:ThreadNotification){this.storage.sql.exec('DELETE FROM thread_notification_outbox WHERE incarnation=? AND comment_id=? AND actor_id=?',item.incarnation,item.comment_id,item.actor_id);}
 hasPending(){return this.storage.sql.exec('SELECT 1 FROM thread_notification_outbox LIMIT 1').toArray().length>0;}
}
