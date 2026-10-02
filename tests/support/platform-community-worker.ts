import { DurableObject } from "cloudflare:workers";
import { PlatformCommunity } from "../../src/server/platform-community";
export class ForumFixture extends DurableObject {
    override async fetch(request: Request) { const url = new URL(request.url), forum = new PlatformCommunity(this.ctx.storage), actor = { userId: url.searchParams.get("actor") ?? "human-subject", accountKey: "private-account-key", displayName: "Human" }; try {
        const input = request.method === "GET" ? {} : await request.json();
        const id = url.searchParams.get("id") ?? "";
        if (url.pathname === "/create")
            return Response.json(forum.create(actor, input, id || undefined));
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
        TEST: DurableObjectNamespace<ForumFixture>;
    }) => env.TEST.getByName(new URL(request.url).searchParams.get("namespace") ?? "global").fetch(request) };
