import { DurableObject } from "cloudflare:workers";
import { RepositoryDiscussions } from "../../src/server/repository-discussions";
export class DiscussionFixture extends DurableObject {
    override async fetch(request: Request) { const url = new URL(request.url), forum = new RepositoryDiscussions(this.ctx.storage,url.searchParams.get("private")!=="true"), actor = { userId: url.searchParams.get("actor") ?? "human-subject", accountKey: "private-account-key", displayName: "Human" }; try {
        const input = request.method === "GET" ? {} : await request.json();
        const id = url.searchParams.get("id") ?? "";
        const moderation=forum.moderation(),canModerate=url.searchParams.get("moderator")==="true";
        if(url.pathname==="/report")return Response.json(moderation.report(id,actor.userId,input));
        if(url.pathname==="/moderation-inbox")return Response.json(moderation.inbox(actor.userId,canModerate));
        if(url.pathname==="/moderation-audit")return Response.json(moderation.history(actor.userId,canModerate));
        if(url.pathname==="/moderation-resolve")return Response.json(moderation.resolve(id,actor.userId,canModerate,input));
        if(url.pathname==="/moderation-appeal")return Response.json(moderation.appeal(id,actor.userId,input));
        if(url.pathname==="/moderation-decide")return Response.json(moderation.decide(id,actor.userId,canModerate,input));
        if(url.pathname==="/activity")return Response.json(forum.activity(url.searchParams.get("q")??""));
        if (url.pathname === "/pending") return Response.json(forum.pendingNotifications());
        if (url.pathname === "/notification-available") return Response.json(forum.notificationAvailable(id,url.searchParams.get('entry')??'',actor.userId));
        if (url.pathname === "/acknowledge") {forum.acknowledgeNotification(url.searchParams.get('event')??'',actor.userId);return Response.json({ok:true});}
        if (url.pathname === "/convert") {
            this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS issues(number INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,body TEXT NOT NULL,author TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)');
            return Response.json(forum.convert(actor,id,input));
        }
        if (url.pathname === "/origin") return Response.json(forum.conversionOrigin(Number(url.searchParams.get('number'))));
        if (url.pathname === "/poll") return Response.json(forum.pollMutate(actor,id,input,url.searchParams.get("owner")==="true"));
        if (url.pathname === "/subscribe") return Response.json(forum.subscribe(actor,id,input));
        if (url.pathname === "/permissions") return Response.json(forum.permissions(actor,id,url.searchParams.get("owner")==="true"));
        if (url.pathname === "/subscriptions") return Response.json(forum.subscriptions(actor));
        if (url.pathname === "/create")
            return Response.json(forum.create(actor, input, id || undefined));
        if (url.pathname === "/control") return Response.json(forum.control(actor,id,input,url.searchParams.get("owner")==="true"));
            if (url.pathname === "/edit")
            return Response.json(forum.edit(actor, id, input));
        if (url.pathname === "/remove")
            return Response.json(forum.remove(actor, id, input, url.searchParams.get("moderator") === "true"));
        if (url.pathname === "/topic")
            return Response.json(forum.topic(id));
        return Response.json(forum.list({ ...(url.searchParams.has("q") ? { q: url.searchParams.get("q")! } : {}) }));
    }
    catch {
        return new Response("Refused", { status: 409 });
    } }
}
export default { fetch: (request: Request, env: {
        TEST: DurableObjectNamespace<DiscussionFixture>;
    }) => env.TEST.getByName(new URL(request.url).searchParams.get("namespace") ?? "global").fetch(request) };
