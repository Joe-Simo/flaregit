import { CommunityModeration } from "./community-moderation.js";
import { z } from "zod";
import { actorName, safeContent, type PublicCommunityActor } from "./public-community.js";
export const DISCUSSION_CATEGORIES = ["question", "general", "ideas", "announcements"] as const;
const content = z.string().trim().min(1).max(8000);
const publish = z.literal(true);
const eventKey = z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/);
const topicInput = z.object({ category: z.enum(DISCUSSION_CATEGORIES), title: z.string().trim().min(1).max(200), body: content, idempotencyKey: eventKey, confirmed: publish }).strict();
const replyInput = z.object({ body: content, idempotencyKey: eventKey, confirmed: publish }).strict();
const editInput = z.object({ body: content, title: z.string().trim().min(1).max(200).optional(), expectedVersion: z.number().int().positive(), confirmed: publish }).strict();
const removeInput = z.object({ expectedVersion: z.number().int().positive(), reason: z.string().trim().min(1).max(500).optional() }).strict();
export const discussionQuerySchema = z.object({ category: z.enum(DISCUSSION_CATEGORIES).optional(), q: z.string().max(200).optional(), sort: z.enum(["latest", "top"]).optional() }).strict();
export interface DiscussionEntry {
    id: string;
    topicId: string;
    category: typeof DISCUSSION_CATEGORIES[number];
    title: string;
    body: string;
    author: string;
    version: number;
    createdAt: string;
    updatedAt: string;
    removed: boolean;
    locked: boolean;
    resolved: boolean;
    moderationReason?: string;
    moderationState?: "visible" | "hidden" | "removed";
    pinned?: boolean;
    answerId?: string;
    convertedIssue?: number;
}
export interface DiscussionTopic extends DiscussionEntry {
    replyCount: number;
}
export class RepositoryDiscussions {
    activity(query: string, ids?: string[]) {
      if (query.length > 200 || (ids && (ids.length > 3 || ids.some(id => !/^discussion_[a-f0-9-]{36}$/.test(id))))) throw new Error("Invalid activity slice");
      const filter = ids ? `t.id IN (${ids.map(() => "?").join(",") || "NULL"})` : "instr(lower(json_extract(t.doc,'$.title') || ' ' || json_extract(t.doc,'$.body')),lower(?))>0";
      return this.exec<{doc:string;reply_count:number}>(`SELECT t.doc,(SELECT COUNT(*) FROM repository_discussion_entries r WHERE r.topic_id=t.id AND r.id!=r.topic_id AND json_extract(r.doc,'$.removed')=0 AND coalesce(json_extract(r.doc,'$.moderationState'),'visible')='visible') AS reply_count FROM repository_discussion_entries t WHERE t.id=t.topic_id AND json_extract(t.doc,'$.removed')=0 AND coalesce(json_extract(t.doc,'$.moderationState'),'visible')='visible' AND ${filter} ORDER BY json_extract(t.doc,'$.createdAt') DESC,t.id DESC LIMIT 3`, ...(ids ?? [query])).toArray().map(row => ({...this.projection(row.doc), body:this.projection(row.doc).body.slice(0,500),replyCount:row.reply_count}));
    }
    constructor(private storage: DurableObjectStorage, private readonly publicOnly = true) { this.exec("CREATE TABLE IF NOT EXISTS repository_discussion_entries(id TEXT PRIMARY KEY,topic_id TEXT NOT NULL,author_id TEXT NOT NULL,doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS repository_discussion_receipts(actor_id TEXT NOT NULL,event_key TEXT NOT NULL,payload TEXT NOT NULL,entry_id TEXT NOT NULL,PRIMARY KEY(actor_id,event_key)); CREATE INDEX IF NOT EXISTS repository_discussion_topic ON repository_discussion_entries(topic_id); CREATE TABLE IF NOT EXISTS repository_discussion_polls(topic_id TEXT PRIMARY KEY,doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS repository_discussion_votes(topic_id TEXT NOT NULL,actor_id TEXT NOT NULL,option TEXT NOT NULL,PRIMARY KEY(topic_id,actor_id)); CREATE TABLE IF NOT EXISTS repository_discussion_subscriptions(topic_id TEXT NOT NULL,actor_id TEXT NOT NULL,PRIMARY KEY(topic_id,actor_id)); CREATE TABLE IF NOT EXISTS repository_discussion_conversions(topic_id TEXT PRIMARY KEY,event_key TEXT NOT NULL,issue_number INTEGER NOT NULL,origin TEXT NOT NULL); CREATE TABLE IF NOT EXISTS repository_discussion_notifications(event_id TEXT NOT NULL,actor_id TEXT NOT NULL,topic_id TEXT NOT NULL,entry_id TEXT NOT NULL,PRIMARY KEY(event_id,actor_id)); CREATE TABLE IF NOT EXISTS repository_discussion_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,topic_id TEXT NOT NULL,actor_id TEXT NOT NULL,action TEXT NOT NULL,at TEXT NOT NULL);"); }
    private exec<T extends Record<string,SqlStorageValue> = Record<string,SqlStorageValue>>(query:string,...bindings:SqlStorageValue[]):SqlStorageCursor<T>{return this.storage.sql.exec<T>(query.replaceAll("repository_discussion_",this.publicOnly?"repository_public_discussion_":"repository_private_discussion_"),...bindings);}
    moderation() {return new CommunityModeration(this.storage,this.publicOnly?"repository-public-discussions":"repository-private-discussions",id=>{const row=this.row(id);if(!row)return null;return {authorId:row.author_id,available:!this.projection(row.doc).removed};},(id,state)=>{const row=this.row(id);if(!row)throw Error("Content unavailable");const item=JSON.parse(row.doc) as DiscussionEntry;this.exec("UPDATE repository_discussion_entries SET doc=? WHERE id=?",JSON.stringify({...item,moderationState:state,version:item.version+1,updatedAt:new Date().toISOString()}),id);});}
    private row(id: string) { return this.exec<{
        author_id: string;
        doc: string;
    }>("SELECT author_id,doc FROM repository_discussion_entries WHERE id=?", id).toArray()[0]; }
    private projection(doc: string): DiscussionEntry { const value = JSON.parse(doc) as DiscussionEntry,parent=value.topicId!==value.id?this.row(value.topicId):undefined,parentDoc=parent?JSON.parse(parent.doc) as DiscussionEntry:undefined; const restricted=value.removed || (value.moderationState && value.moderationState !== "visible") || parentDoc?.removed || (parentDoc?.moderationState && parentDoc.moderationState !== "visible"); return restricted ? { ...value, removed:true, title: "Removed", body: "", author: "Contributor" } : value; }
    list(input: {
        category?: string;
        q?: string;
        sort?: string;
    } = {}) { const query = discussionQuerySchema.parse(input); const rows = this.exec<{
        doc: string;
        reply_count: number;
    }>("SELECT t.doc,(SELECT COUNT(*) FROM repository_discussion_entries r WHERE r.topic_id=t.id AND r.id!=r.topic_id AND json_extract(r.doc,'$.removed')=0 AND coalesce(json_extract(r.doc,'$.moderationState'),'visible')='visible') AS reply_count FROM repository_discussion_entries t WHERE t.id=t.topic_id AND json_extract(t.doc,'$.removed')=0 AND coalesce(json_extract(t.doc,'$.moderationState'),'visible')='visible' ORDER BY json_extract(t.doc,'$.createdAt') DESC,t.id DESC LIMIT 1000").toArray(); const topics = rows.map(r => ({ ...this.projection(r.doc), replyCount: r.reply_count })).filter(t => (!query.category || t.category === query.category) && (!query.q || `${t.title} ${t.body}`.toLowerCase().includes(query.q.toLowerCase()))); if (query.sort === "top")
        topics.sort((a, b) => b.replyCount - a.replyCount || b.createdAt.localeCompare(a.createdAt)); topics.sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned))); return { categories: DISCUSSION_CATEGORIES, topics: topics.slice(0, 100), scope: "Latest 100 matching topics from up to 1000 retained topics" }; }
    topic(id: string) { const row = this.row(id); if (!row)
        return null; const topic = this.projection(row.doc); if (topic.topicId !== id)
        return null; if(topic.removed)return {topic,poll:null,replies:[]}; return { topic, poll:this.poll(id), replies: this.exec<{
            doc: string;
        }>("SELECT doc FROM repository_discussion_entries WHERE topic_id=? AND id!=topic_id ORDER BY json_extract(doc,'$.createdAt'),id LIMIT 200", id).toArray().map(r => this.projection(r.doc)) }; }
    create(actor: PublicCommunityActor, input: unknown, topicId?: string): DiscussionEntry { const topicValue = topicId ? undefined : topicInput.parse(input); const value = topicValue ?? replyInput.parse(input); const name = actorName(actor); safeContent(value.body, ...(topicValue ? [topicValue.title] : [])); return this.storage.transactionSync(() => { const payload = JSON.stringify({ topicId: topicId ?? null, ...value }); const receipt = this.exec<{
        payload: string;
        entry_id: string;
    }>("SELECT payload,entry_id FROM repository_discussion_receipts WHERE actor_id=? AND event_key=?", actor.userId, value.idempotencyKey).toArray()[0]; if (receipt) {
        if (receipt.payload !== payload)
            throw new Error("Retry key belongs to different content");
        const row = this.row(receipt.entry_id)!;
        const entry = this.projection(row.doc);
        if (entry.removed)
            throw new Error("Removed content cannot be republished by replay");
        return entry;
    } const parent=topicId?this.topic(topicId)?.topic:undefined;if(topicId&&(!parent||parent.removed||parent.locked))throw new Error("Topic unavailable"); const count = this.exec<{
        n: number;
    }>("SELECT COUNT(*) AS n FROM repository_discussion_entries WHERE id=topic_id").toArray()[0]!.n; if (!topicId && count >= 1000)
        throw new Error("Community topic capacity reached"); if (topicId && this.exec<{
        n: number;
    }>("SELECT COUNT(*) AS n FROM repository_discussion_entries WHERE topic_id=? AND id!=topic_id", topicId).toArray()[0]!.n >= 200)
        throw new Error("Topic reply capacity reached"); const id = `discussion_${crypto.randomUUID()}`, now = new Date().toISOString(); const entry: DiscussionEntry = { id, topicId: topicId ?? id, category: parent?.category ?? topicValue?.category ?? "general", title: topicValue?.title ?? "", body: value.body, author: name, version: 1, createdAt: now, updatedAt: now, removed: false, locked: false, resolved: false }; this.exec("INSERT INTO repository_discussion_entries VALUES(?,?,?,?)", id, entry.topicId, actor.userId, JSON.stringify(entry)); this.exec("INSERT INTO repository_discussion_receipts VALUES(?,?,?,?)", actor.userId, value.idempotencyKey, payload, id); if(topicId)this.exec('INSERT OR IGNORE INTO repository_discussion_notifications(event_id,actor_id,topic_id,entry_id) SELECT ?,actor_id,?,? FROM repository_discussion_subscriptions WHERE topic_id=? AND actor_id!=?',id,topicId,id,topicId,actor.userId); return entry; }); }
    pendingNotifications(){return this.exec<{event_id:string;actor_id:string;topic_id:string;entry_id:string}>('SELECT event_id,actor_id,topic_id,entry_id FROM repository_discussion_notifications ORDER BY rowid LIMIT 25').toArray();}
    acknowledgeNotification(eventId:string,actorId:string){this.exec('DELETE FROM repository_discussion_notifications WHERE event_id=? AND actor_id=?',eventId,actorId);}
    notificationAvailable(topicId:string,entryId:string,actorId:string){const topic=this.topic(topicId),entry=this.row(entryId);return Boolean(entryId!==topicId&&topic&&!topic.topic.removed&&entry&&this.projection(entry.doc).topicId===topicId&&!this.projection(entry.doc).removed&&this.exec('SELECT 1 FROM repository_discussion_subscriptions WHERE topic_id=? AND actor_id=?',topicId,actorId).toArray().length);}
    poll(id:string){const topic=this.row(id);if(!topic||this.projection(topic.doc).removed)return null;const row=this.exec<{doc:string}>('SELECT doc FROM repository_discussion_polls WHERE topic_id=?',id).toArray()[0];if(!row)return null;const poll=JSON.parse(row.doc) as {options:string[];closed:boolean;version:number};const votes=this.exec<{option:string;count:number}>('SELECT option,COUNT(*) AS count FROM repository_discussion_votes WHERE topic_id=? GROUP BY option',id).toArray();return {...poll,counts:Object.fromEntries(poll.options.map(option=>[option,votes.find(row=>row.option===option)?.count??0]))};}
    pollMutate(actor:PublicCommunityActor,id:string,input:unknown,owner:boolean){
      actorName(actor);
      const request=z.discriminatedUnion('operation',[
        z.object({operation:z.literal('create'),options:z.array(z.string().trim().min(1).max(120)).min(2).max(20).refine(values=>new Set(values).size===values.length),expectedVersion:z.number().int().positive().safe(),confirmed:z.literal(true)}).strict(),
        z.object({operation:z.literal('vote'),option:z.string().min(1).max(120)}).strict(),
        z.object({operation:z.literal('close'),expectedVersion:z.number().int().positive().safe()}).strict(),
      ]).parse(input);
      return this.storage.transactionSync(()=>{
        const row=this.row(id);if(!row)throw Error('Topic unavailable');const topic=this.projection(row.doc);if(topic.removed||topic.id!==topic.topicId)throw Error('Topic unavailable');
        const poll=this.poll(id);
        if(request.operation==='create'){
          if(!owner&&row.author_id!==actor.userId)throw Error('Only author or maintainer can create a poll');
          if(poll){if(JSON.stringify(poll.options)!==JSON.stringify(request.options))throw Error('Poll already exists with different options');return poll;}
          if(topic.locked||topic.version!==request.expectedVersion)throw Error('Topic changed');safeContent(...request.options);
          this.exec('INSERT INTO repository_discussion_polls VALUES(?,?)',id,JSON.stringify({options:request.options,closed:false,version:1}));
        }else{
          if(!poll)throw Error('Poll unavailable');
          if(request.operation==='vote'){
            if(topic.locked||poll.closed||!poll.options.includes(request.option))throw Error('Poll is closed or option unavailable');
            const exists=this.exec('SELECT 1 FROM repository_discussion_votes WHERE topic_id=? AND actor_id=?',id,actor.userId).toArray().length;
            if(!exists&&this.exec<{count:number}>('SELECT COUNT(*) AS count FROM repository_discussion_votes WHERE topic_id=?',id).toArray()[0]!.count>=10000)throw Error('Poll voter capacity reached');
            this.exec('INSERT INTO repository_discussion_votes VALUES(?,?,?) ON CONFLICT(topic_id,actor_id) DO UPDATE SET option=excluded.option',id,actor.userId,request.option);
          }else{
            if(!owner&&row.author_id!==actor.userId)throw Error('Only author or maintainer can close a poll');
            if(request.expectedVersion!==poll.version&&!(poll.closed&&request.expectedVersion===poll.version-1))throw Error('Poll changed');
            if(!poll.closed)this.exec('UPDATE repository_discussion_polls SET doc=? WHERE topic_id=?',JSON.stringify({options:poll.options,closed:true,version:poll.version+1}),id);
          }
        }
        return this.poll(id);
      });
    }
    subscribe(actor:PublicCommunityActor,id:string,input:unknown){actorName(actor);const value=z.object({subscribed:z.boolean()}).strict().parse(input);return this.storage.transactionSync(()=>{const row=this.row(id);if(!row||this.projection(row.doc).removed||this.projection(row.doc).topicId!==id)throw Error('Topic unavailable');if(value.subscribed){const existing=this.exec('SELECT 1 FROM repository_discussion_subscriptions WHERE topic_id=? AND actor_id=?',id,actor.userId).toArray().length;if(!existing&&this.exec<{count:number}>('SELECT COUNT(*) AS count FROM repository_discussion_subscriptions WHERE topic_id=?',id).toArray()[0]!.count>=10000)throw Error('Subscription capacity reached');this.exec('INSERT OR IGNORE INTO repository_discussion_subscriptions VALUES(?,?)',id,actor.userId);}else this.exec('DELETE FROM repository_discussion_subscriptions WHERE topic_id=? AND actor_id=?',id,actor.userId);return value;});}
    conversionOrigin(number:number){const row=this.exec<{origin:string}>('SELECT origin FROM repository_discussion_conversions WHERE issue_number=?',number).toArray()[0];return row?JSON.parse(row.origin) as {discussionId:string;scope:'public'|'members';author:string;createdAt:string;convertedBy:string}:null;}
    subscriptions(actor:PublicCommunityActor){actorName(actor);return {topics:this.exec<{doc:string}>(`SELECT e.doc FROM repository_discussion_subscriptions s JOIN repository_discussion_entries e ON e.id=s.topic_id WHERE s.actor_id=? AND json_extract(e.doc,'$.removed')=0 AND coalesce(json_extract(e.doc,'$.moderationState'),'visible')='visible' ORDER BY json_extract(e.doc,'$.updatedAt') DESC LIMIT 100`,actor.userId).toArray().map(row=>this.projection(row.doc))};}
    convert(actor:PublicCommunityActor,id:string,input:unknown){
      actorName(actor);const value=z.object({expectedVersion:z.number().int().positive().safe(),idempotencyKey:eventKey,confirmed:z.literal(true)}).strict().parse(input);
      return this.storage.transactionSync(()=>{
        const row=this.row(id);if(!row)throw Error('Topic unavailable');const topic=this.projection(row.doc);if(topic.removed||topic.id!==topic.topicId)throw Error('Topic unavailable');
        const existing=this.exec<{event_key:string;issue_number:number}>('SELECT event_key,issue_number FROM repository_discussion_conversions WHERE topic_id=?',id).toArray()[0];
        if(existing){if(existing.event_key!==value.idempotencyKey)throw Error('Topic already converted; refresh current issue link');return {issueNumber:existing.issue_number};}
        if(topic.version!==value.expectedVersion)throw Error('Topic changed');
        const at=new Date().toISOString(),origin={discussionId:id,scope:this.publicOnly?'public':'members',author:topic.author,createdAt:topic.createdAt,convertedBy:actorName(actor)};
        const number=this.storage.sql.exec<{number:number}>('INSERT INTO issues(title,body,author,created_at,updated_at) VALUES(?,?,?,?,?) RETURNING number',topic.title,topic.body,topic.author,at,at).toArray()[0]!.number;
        this.exec('INSERT INTO repository_discussion_conversions VALUES(?,?,?,?)',id,value.idempotencyKey,number,JSON.stringify(origin));
        this.exec('UPDATE repository_discussion_entries SET doc=? WHERE id=?',JSON.stringify({...topic,convertedIssue:number,version:topic.version+1,updatedAt:at}),id);
        return {issueNumber:number};
      });
    }
    control(actor: PublicCommunityActor, id: string, input: unknown, owner: boolean) {
      const value=z.object({expectedVersion:z.number().int().positive(),locked:z.boolean().optional(),resolved:z.boolean().optional(),pinned:z.boolean().optional(),answerId:z.string().regex(/^discussion_[a-f0-9-]{36}$/).nullable().optional()}).strict().refine(v=>v.locked!==undefined||v.resolved!==undefined||v.pinned!==undefined||v.answerId!==undefined).parse(input);
      return this.storage.transactionSync(()=>{
        const row=this.row(id);if(!row)throw new Error("Discussion unavailable");const old=this.projection(row.doc);
        if(old.topicId!==id||old.removed||old.version!==value.expectedVersion)throw new Error("Discussion changed; reload");
        if((value.locked!==undefined||value.pinned!==undefined)&&!owner)throw new Error("Only maintainer can lock discussions");
        if(value.resolved!==undefined&&!owner&&row.author_id!==actor.userId)throw new Error("Only author or maintainer can resolve discussion");
        if(value.answerId!==undefined){
          if(old.category!=='question'||!owner&&row.author_id!==actor.userId)throw Error('Only the asker or maintainer can mark a question answer');
          if(value.answerId!==null){const answer=this.row(value.answerId);if(!answer)throw Error('Answer unavailable');const reply=this.projection(answer.doc);if(reply.topicId!==id||reply.id===id||reply.removed)throw Error('Answer must be an available reply');}
        }
        const next={...old,...(value.locked!==undefined?{locked:value.locked}:{}),...(value.resolved!==undefined?{resolved:value.resolved}:{}),...(value.pinned!==undefined?{pinned:value.pinned}:{}),...(value.answerId!==undefined?{answerId:value.answerId??undefined}:{}),version:old.version+1,updatedAt:new Date().toISOString()};
        for(const action of [value.locked===undefined?undefined:value.locked?'lock':'unlock',value.pinned===undefined?undefined:value.pinned?'pin':'unpin',value.answerId===undefined?undefined:value.answerId===null?'unmark-answer':'mark-answer'].filter((action):action is string=>action!==undefined))this.exec('INSERT INTO repository_discussion_audit(topic_id,actor_id,action,at) VALUES(?,?,?,?)',id,actor.userId,action,next.updatedAt);
        this.exec("UPDATE repository_discussion_entries SET doc=? WHERE id=?",JSON.stringify(next),id);return next;
      });
    }
    permissions(actor: PublicCommunityActor, topicId: string, moderator: boolean) { actorName(actor); const entries = this.exec<{
        id: string;
        author_id: string;
        doc: string;
    }>("SELECT id,author_id,doc FROM repository_discussion_entries WHERE topic_id=? LIMIT 201", topicId).toArray().map(row => { const item = this.projection(row.doc); return { id: row.id, canEdit: !item.removed && row.author_id === actor.userId, canRemove: !item.removed && (row.author_id === actor.userId || moderator), canResolve: !item.removed && item.id === item.topicId && (row.author_id === actor.userId || moderator), canLock: !item.removed && item.id === item.topicId && moderator }; }); return { entries, moderator,subscribed:this.exec('SELECT 1 FROM repository_discussion_subscriptions WHERE topic_id=? AND actor_id=?',topicId,actor.userId).toArray().length>0,selectedOption:this.exec<{option:string}>('SELECT option FROM repository_discussion_votes WHERE topic_id=? AND actor_id=?',topicId,actor.userId).toArray()[0]?.option??null,canManagePoll:!this.topic(topicId)?.topic.removed&&(moderator||this.row(topicId)?.author_id===actor.userId),canMarkAnswer:!this.topic(topicId)?.topic.removed&&(moderator||this.row(topicId)?.author_id===actor.userId) }; }
    edit(actor: PublicCommunityActor, id: string, input: unknown) { const value = editInput.parse(input); safeContent(value.body, value.title ?? ""); return this.storage.transactionSync(() => { const row = this.row(id); if (!row || row.author_id !== actor.userId)
        throw new Error("Only the author can edit"); const old = this.projection(row.doc); if (old.removed || old.version !== value.expectedVersion)
        throw new Error("Content changed; reload"); if (old.topicId !== id && value.title !== undefined)
        throw new Error("Replies have no title"); const next = { ...old, body: value.body, title: value.title ?? old.title, version: old.version + 1, updatedAt: new Date().toISOString() }; this.exec("UPDATE repository_discussion_entries SET doc=? WHERE id=?", JSON.stringify(next), id); return next; }); }
    remove(actor: PublicCommunityActor, id: string, input: unknown, moderator: boolean) { const value = removeInput.parse(input); if (value.reason)
        safeContent(value.reason); return this.storage.transactionSync(() => { const row = this.row(id); if (!row || (row.author_id !== actor.userId && !moderator))
        throw new Error("Removal requires author or moderator"); if (row.author_id !== actor.userId && !value.reason)
        throw new Error("Moderator reason required"); const old = this.projection(row.doc); if (old.removed && old.version === value.expectedVersion + 1)
        return old; if (old.removed || old.version !== value.expectedVersion)
        throw new Error("Content changed; reload"); const next = { ...old, title: "Removed", body: "", removed: true, version: old.version + 1, updatedAt: new Date().toISOString(), ...(value.reason ? { moderationReason: value.reason } : {}) }; this.exec("UPDATE repository_discussion_entries SET doc=? WHERE id=?", JSON.stringify(next), id); return this.projection(JSON.stringify(next)); }); }
}
