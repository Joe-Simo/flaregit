import { DurableObject } from "cloudflare:workers";
import { PublicGitPublicationLedger } from "../../src/server/public-git-publication";
import type { PublicGitConsentScope } from "../../src/server/public-git-consent";
export class PublicationTest extends DurableObject {
  async run(input: { scope: PublicGitConsentScope; decision?: Parameters<PublicGitPublicationLedger["decide"]>[0]; owner?: string }) {
    const ledger = new PublicGitPublicationLedger(this.ctx.storage);
    return input.decision ? ledger.decide(input.decision, input.scope, input.owner ?? "owner") : { state: ledger.state(), readable: ledger.readable(input.scope) };
  }
}
export default { async fetch(request: Request, env: { TEST: DurableObjectNamespace<PublicationTest> }) {
  try { return Response.json(await env.TEST.getByName("test").run(await request.json())); }
  catch { return new Response("Decision rejected", { status: 409 }); }
} };
