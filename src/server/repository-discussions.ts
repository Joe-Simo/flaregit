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
}
export interface DiscussionTopic extends DiscussionEntry {
    replyCount: number;
}
export class RepositoryDiscussions {
    constructor(private storage: DurableObjectStorage, private readonly publicOnly = true) { this.exec("CREATE TABLE IF NOT EXISTS repository_discussion_entries(id TEXT PRIMARY KEY,topic_id TEXT NOT NULL,author_id TEXT NOT NULL,doc TEXT NOT NULL); CREATE TABLE IF NOT EXISTS repository_discussion_receipts(actor_id TEXT NOT NULL,event_key TEXT NOT NULL,payload TEXT NOT NULL,entry_id TEXT NOT NULL,PRIMARY KEY(actor_id,event_key)); CREATE INDEX IF NOT EXISTS repository_discussion_topic ON repository_discussion_entries(topic_id);"); }
    private exec<T extends Record<string,SqlStorageValue> = Record<string,SqlStorageValue>>(query:string,...bindings:SqlStorageValue[]):SqlStorageCursor<T>{return this.storage.sql.exec<T>(query.replaceAll("repository_discussion_",this.publicOnly?"repository_public_discussion_":"repository_private_discussion_"),...bindings);}
    private row(id: string) { return this.exec<{
        author_id: string;
        doc: string;
    }>("SELECT author_id,doc FROM repository_discussion_entries WHERE id=?", id).toArray()[0]; }
    private projection(doc: string): DiscussionEntry { const value = JSON.parse(doc) as DiscussionEntry; return value.removed ? { ...value, title: "Removed", body: "", author: "Contributor" } : value; }
    list(input: {
        category?: string;
        q?: string;
        sort?: string;
    } = {}) { const query = discussionQuerySchema.parse(input); const rows = this.exec<{
        doc: string;
        reply_count: number;
    }>("SELECT t.doc,(SELECT COUNT(*) FROM repository_discussion_entries r WHERE r.topic_id=t.id AND r.id!=r.topic_id AND json_extract(r.doc,'$.removed')=0) AS reply_count FROM repository_discussion_entries t WHERE t.id=t.topic_id AND json_extract(t.doc,'$.removed')=0 ORDER BY json_extract(t.doc,'$.createdAt') DESC,t.id DESC LIMIT 1000").toArray(); const topics = rows.map(r => ({ ...this.projection(r.doc), replyCount: r.reply_count })).filter(t => (!query.category || t.category === query.category) && (!query.q || `${t.title} ${t.body}`.toLowerCase().includes(query.q.toLowerCase()))); if (query.sort === "top")
        topics.sort((a, b) => b.replyCount - a.replyCount || b.createdAt.localeCompare(a.createdAt)); return { categories: DISCUSSION_CATEGORIES, topics: topics.slice(0, 100), scope: "Latest 100 matching topics from up to 1000 retained topics" }; }
    topic(id: string) { const row = this.row(id); if (!row)
        return null; const topic = this.projection(row.doc); if (topic.topicId !== id)
        return null; return { topic, replies: this.exec<{
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
        throw new Error("Topic reply capacity reached"); const id = `discussion_${crypto.randomUUID()}`, now = new Date().toISOString(); const entry: DiscussionEntry = { id, topicId: topicId ?? id, category: parent?.category ?? topicValue?.category ?? "general", title: topicValue?.title ?? "", body: value.body, author: name, version: 1, createdAt: now, updatedAt: now, removed: false, locked: false, resolved: false }; this.exec("INSERT INTO repository_discussion_entries VALUES(?,?,?,?)", id, entry.topicId, actor.userId, JSON.stringify(entry)); this.exec("INSERT INTO repository_discussion_receipts VALUES(?,?,?,?)", actor.userId, value.idempotencyKey, payload, id); return entry; }); }
    control(actor: PublicCommunityActor, id: string, input: unknown, owner: boolean) {
      const value=z.object({expectedVersion:z.number().int().positive(),locked:z.boolean().optional(),resolved:z.boolean().optional()}).strict().refine(v=>v.locked!==undefined||v.resolved!==undefined).parse(input);
      return this.storage.transactionSync(()=>{
        const row=this.row(id);if(!row)throw new Error("Discussion unavailable");const old=this.projection(row.doc);
        if(old.topicId!==id||old.removed||old.version!==value.expectedVersion)throw new Error("Discussion changed; reload");
        if(value.locked!==undefined&&!owner)throw new Error("Only maintainer can lock discussions");
        if(value.resolved!==undefined&&!owner&&row.author_id!==actor.userId)throw new Error("Only author or maintainer can resolve discussion");
        const next={...old,...(value.locked!==undefined?{locked:value.locked}:{}),...(value.resolved!==undefined?{resolved:value.resolved}:{}),version:old.version+1,updatedAt:new Date().toISOString()};
        this.exec("UPDATE repository_discussion_entries SET doc=? WHERE id=?",JSON.stringify(next),id);return next;
      });
    }
    permissions(actor: PublicCommunityActor, topicId: string, moderator: boolean) { actorName(actor); const entries = this.exec<{
        id: string;
        author_id: string;
        doc: string;
    }>("SELECT id,author_id,doc FROM repository_discussion_entries WHERE topic_id=? LIMIT 201", topicId).toArray().map(row => { const item = this.projection(row.doc); return { id: row.id, canEdit: !item.removed && row.author_id === actor.userId, canRemove: !item.removed && (row.author_id === actor.userId || moderator), canResolve: !item.removed && item.id === item.topicId && (row.author_id === actor.userId || moderator), canLock: !item.removed && item.id === item.topicId && moderator }; }); return { entries, moderator }; }
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
