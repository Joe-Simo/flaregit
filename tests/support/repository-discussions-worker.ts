import { DurableObject } from "cloudflare:workers";
import { RepositoryDiscussions } from "../../src/server/repository-discussions";
export class DiscussionFixture extends DurableObject {
    override async fetch(request: Request) { const url = new URL(request.url), forum = new RepositoryDiscussions(this.ctx.storage,url.searchParams.get("private")!=="true"), actor = { userId: url.searchParams.get("actor") ?? "human-subject", accountKey: "private-account-key", displayName: "Human" }; try {
        const input = request.method === "GET" ? {} : await request.json();
        const id = url.searchParams.get("id") ?? "";
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
