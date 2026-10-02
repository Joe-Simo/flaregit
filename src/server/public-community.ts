import { z } from "zod";
import { redactSecrets } from "../agents/prompt.js";

export const PUBLIC_COMMUNITY_SCOPES = ["discussions", "issues", "contribution-requests"] as const;
export type PublicCommunityScope = typeof PUBLIC_COMMUNITY_SCOPES[number];
/** Actor identity and ownerId are supplied by authenticated server membership,
 * never request JSON. Public projections omit subjects, account keys and emails.
 */
export interface PublicCommunityActor { userId: string; accountKey: string; displayName: string }
export interface PublicCommunityPolicy { enabled: boolean; scopes: PublicCommunityScope[] }
export interface PublicPost { id: string; scope: "discussions" | "issues"; title: string; body: string; author: string; version: number; createdAt: string; updatedAt: string }
export interface ContributionRequest { id: string; requesterUserId: string; requesterAccountKey: string; requesterName: string; purpose: string; status: "requested" | "approved" | "rejected"; privateContextAcknowledged: boolean; createdAt: string; updatedAt: string }
const policySchema = z.object({ enabled: z.boolean(), scopes: z.array(z.enum(PUBLIC_COMMUNITY_SCOPES)).max(3).refine((scopes) => new Set(scopes).size === scopes.length) }).strict();
const key = z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/);
const title = z.string().trim().min(1).max(200);
const body = z.string().trim().min(1).max(8000);
const postSchema = z.object({ scope: z.enum(["discussions", "issues"]), title, body, idempotencyKey: key }).strict();
const requestSchema = z.object({ purpose: z.string().trim().min(10).max(2000), idempotencyKey: key }).strict();
export function safeContent(...values: string[]): void {
  for (const value of values) {
    if (redactSecrets(value) !== value) throw new Error("Remove credentials before publishing community content");
    for (const match of value.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      try {
        // Prose and Markdown can end a URL with punctuation outside the link.
        let raw = match[0].replace(/[)},.;]+$/, "");
        if (raw.endsWith("]") && !/^https?:\/\/\[[^\]]+\]$/i.test(raw)) raw = raw.slice(0, -1);
        decodeURIComponent(raw); // malformed percent escapes must not evade inspection
        const url = new URL(raw);
        if (url.username || url.password || redactSecrets(decodeURIComponent(url.pathname)) !== decodeURIComponent(url.pathname)) throw new Error("Credential URL");
        for (const [key, queryValue] of url.searchParams) {
          if (/(?:^|[_-])(?:token|signature|sig|secret|password|passwd|api[_-]?key|authorization|credential|jwt)(?:$|[_-])/i.test(key) || redactSecrets(queryValue) !== queryValue) throw new Error("Credential query");
        }
        if (redactSecrets(decodeURIComponent(url.hash)) !== decodeURIComponent(url.hash)) throw new Error("Credential fragment");
      } catch {
        throw new Error("Remove credential-bearing or malformed URLs before publishing community content");
      }
    }
  }
}
export function actorName(actor: PublicCommunityActor): string {
  if (!actor.userId || !actor.accountKey || typeof actor.displayName !== "string") throw new Error("Verified actor is required");
  const name = actor.displayName.trim().slice(0, 80);
  return !name || /[\x00-\x1f<>@]/.test(name) || redactSecrets(name) !== name ? "Contributor" : name;
}

/** Entirely separate public tables. Existing private issues, comments, tasks and
 * conversation history cannot be exposed by enabling these scopes.
 */
export class RepositoryPublicCommunity {
  constructor(private readonly storage: DurableObjectStorage, readonly repositoryId: string) {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS public_community_policy(id INTEGER PRIMARY KEY CHECK(id=1),doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS public_community_posts(id TEXT PRIMARY KEY,author_id TEXT NOT NULL,doc TEXT NOT NULL,removed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS public_contribution_requests(id TEXT PRIMARY KEY,requester_id TEXT NOT NULL,doc TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS public_community_receipts(actor_id TEXT NOT NULL,event_key TEXT NOT NULL,payload TEXT NOT NULL,record_id TEXT NOT NULL,kind TEXT NOT NULL,PRIMARY KEY(actor_id,event_key));`);
  }
  policy(): PublicCommunityPolicy { const row = this.storage.sql.exec<{ doc: string }>("SELECT doc FROM public_community_policy WHERE id=1").toArray()[0]; return row ? JSON.parse(row.doc) as PublicCommunityPolicy : { enabled: false, scopes: [] }; }
  configure(input: PublicCommunityPolicy, confirmed: boolean, actor: PublicCommunityActor, ownerId: string): PublicCommunityPolicy {
    const value = policySchema.parse(input); actorName(actor);
    if (actor.userId !== ownerId || (value.enabled && confirmed !== true)) throw new Error("Explicit owner confirmation is required for public community scopes");
    this.storage.sql.exec("INSERT INTO public_community_policy VALUES(1,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc", JSON.stringify(value)); return value;
  }
  private scope(scope: PublicCommunityScope) { const policy = this.policy(); if (!policy.enabled || !policy.scopes.includes(scope)) throw new Error("Public community scope is disabled"); }
  private receipt(actorId: string, eventKey: string, payload: string, kind: string): string | null {
    const row = this.storage.sql.exec<{ payload: string; record_id: string; kind: string }>("SELECT payload,record_id,kind FROM public_community_receipts WHERE actor_id=? AND event_key=?", actorId,eventKey).toArray()[0];
    if (!row) return null;
    if (row.payload !== payload || row.kind !== kind) throw new Error("Idempotency key already belongs to different content");
    return row.record_id;
  }
  createPost(actor: PublicCommunityActor, input: z.input<typeof postSchema>): PublicPost {
    const value = postSchema.parse(input), author = actorName(actor); safeContent(value.title,value.body);
    return this.storage.transactionSync(() => {
      this.scope(value.scope);
      const payload = JSON.stringify({ scope:value.scope,title:value.title,body:value.body });
      const previous = this.receipt(actor.userId,value.idempotencyKey,payload,"post");
      if (previous) { const row = this.storage.sql.exec<{ doc:string;removed:number }>("SELECT doc,removed FROM public_community_posts WHERE id=?",previous).toArray()[0]; if (!row || row.removed) throw new Error("Post was removed; replay cannot republish it"); return JSON.parse(row.doc) as PublicPost; }
      if (this.storage.sql.exec<{ n:number }>("SELECT COUNT(*) AS n FROM public_community_posts").toArray()[0]!.n >= 1000) throw new Error("Public post limit reached");
      const now = new Date().toISOString(), post: PublicPost = { id:`post_${crypto.randomUUID()}`,scope:value.scope,title:value.title,body:value.body,author,version:1,createdAt:now,updatedAt:now };
      this.storage.sql.exec("INSERT INTO public_community_posts VALUES(?,?,?,0)",post.id,actor.userId,JSON.stringify(post));
      this.storage.sql.exec("INSERT INTO public_community_receipts VALUES(?,?,?,?,?)",actor.userId,value.idempotencyKey,payload,post.id,"post"); return post;
    });
  }
  listPublic(): PublicPost[] {
    const policy = this.policy(); if (!policy.enabled) return [];
    return this.storage.sql.exec<{doc:string}>("SELECT doc FROM public_community_posts WHERE removed=0 ORDER BY id").toArray().map(row=>{const post=JSON.parse(row.doc) as PublicPost;return {...post,version:post.version??1};}).filter(post=>policy.scopes.includes(post.scope));
  }
  editPost(actor: PublicCommunityActor, postId: string, input: { title:string;body:string;expectedVersion:number }, ownerId: string): PublicPost {
    actorName(actor); const value = z.object({title,body,expectedVersion:z.number().int().positive()}).strict().parse(input); safeContent(value.title,value.body);
    return this.storage.transactionSync(() => {
      const row = this.storage.sql.exec<{author_id:string;doc:string;removed:number}>("SELECT author_id,doc,removed FROM public_community_posts WHERE id=?",postId).toArray()[0];
      if (!row || row.removed || (row.author_id!==actor.userId && actor.userId!==ownerId)) throw new Error("Post editing is limited to its author or repository owner");
      const old = JSON.parse(row.doc) as PublicPost; this.scope(old.scope);
      if((old.version??1)!==value.expectedVersion)throw new Error("Post changed; reload before editing");
      const next = {...old,title:value.title,body:value.body,version:value.expectedVersion+1,updatedAt:new Date().toISOString()}; this.storage.sql.exec("UPDATE public_community_posts SET doc=? WHERE id=?",JSON.stringify(next),postId); return next;
    });
  }
  removePost(actor: PublicCommunityActor, postId: string, ownerId: string, expectedVersion: number): void {
    actorName(actor); z.number().int().positive().parse(expectedVersion);
    this.storage.transactionSync(()=>{
      const row = this.storage.sql.exec<{author_id:string;doc:string;removed:number}>("SELECT author_id,doc,removed FROM public_community_posts WHERE id=?",postId).toArray()[0];
      if (!row || (row.author_id!==actor.userId && actor.userId!==ownerId)) throw new Error("Post removal is limited to its author or repository owner");
      const post=JSON.parse(row.doc) as PublicPost,version=post.version??1;
      if(row.removed&&version===expectedVersion+1)return;
      if(row.removed||version!==expectedVersion)throw new Error("Post changed; reload before removal");
      this.storage.sql.exec("UPDATE public_community_posts SET removed=1,doc=? WHERE id=?",JSON.stringify({...post,version:version+1,updatedAt:new Date().toISOString()}),postId);
    });
  }
  requestContribution(actor: PublicCommunityActor,input:z.input<typeof requestSchema>): ContributionRequest {
    const value=requestSchema.parse(input),name=actorName(actor);safeContent(value.purpose);
    return this.storage.transactionSync(()=>{
      this.scope("contribution-requests");const payload=JSON.stringify({purpose:value.purpose});const previous=this.receipt(actor.userId,value.idempotencyKey,payload,"request");
      if(previous)return JSON.parse(this.storage.sql.exec<{doc:string}>("SELECT doc FROM public_contribution_requests WHERE id=?",previous).toArray()[0]!.doc) as ContributionRequest;
      if(this.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM public_contribution_requests").toArray()[0]!.n>=1000)throw new Error("Contribution request limit reached");
      const now=new Date().toISOString(),request:ContributionRequest={id:`request_${crypto.randomUUID()}`,requesterUserId:actor.userId,requesterAccountKey:actor.accountKey,requesterName:name,purpose:value.purpose,status:"requested",privateContextAcknowledged:false,createdAt:now,updatedAt:now};
      this.storage.sql.exec("INSERT INTO public_contribution_requests VALUES(?,?,?)",request.id,actor.userId,JSON.stringify(request));this.storage.sql.exec("INSERT INTO public_community_receipts VALUES(?,?,?,?,?)",actor.userId,value.idempotencyKey,payload,request.id,"request");return request;
    });
  }
  requestsFor(actor:PublicCommunityActor,ownerId:string):ContributionRequest[]{actorName(actor);return this.storage.sql.exec<{requester_id:string;doc:string}>("SELECT requester_id,doc FROM public_contribution_requests ORDER BY id").toArray().filter(row=>actor.userId===ownerId||row.requester_id===actor.userId).map(row=>JSON.parse(row.doc) as ContributionRequest);}
  decideRequest(actor:PublicCommunityActor,requestId:string,decision:"approved"|"rejected",confirmedPrivateAccess:boolean,ownerId:string):ContributionRequest{
    actorName(actor);if(actor.userId!==ownerId||!["approved","rejected"].includes(decision)||(decision==="approved"&&confirmedPrivateAccess!==true))throw new Error("Owner approval must explicitly acknowledge access to private repository context");
    return this.storage.transactionSync(()=>{this.scope("contribution-requests");const row=this.storage.sql.exec<{doc:string}>("SELECT doc FROM public_contribution_requests WHERE id=?",requestId).toArray()[0];if(!row)throw new Error("Unknown contribution request");const previous=JSON.parse(row.doc) as ContributionRequest;if(previous.status!=="requested"){if(previous.status!==decision)throw new Error("Request already decided");return previous;}const next={...previous,status:decision,privateContextAcknowledged:decision==="approved",updatedAt:new Date().toISOString()};this.storage.sql.exec("UPDATE public_contribution_requests SET doc=? WHERE id=?",JSON.stringify(next),requestId);return next;});
  }
}
