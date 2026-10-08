import {RepositoryController} from "../../src/server/durable-object";
export {RepositoryController};
import { AuthorityController } from "../../src/server/authority-controller";
import type { AuthorityCall } from "../../src/server/authority-api";

export { AuthorityController };

// Test-only entry: forwards a prepared call straight to the real Durable Object, so the object's SQLite storage is exercised under workerd.
export default {
  async fetch(request: Request, env: { AUTHORITY: DurableObjectNamespace<AuthorityController> }): Promise<Response> {
    if (new URL(request.url).pathname !== "/__call") return new Response("Not found", { status: 404 });
    const input = (await request.json()) as AuthorityCall;
    const reply = await env.AUTHORITY.get(env.AUTHORITY.idFromName("authority")).call(input);
    return new Response(reply.body, { status: reply.status, headers: { "content-type": reply.contentType } });
  },
};
