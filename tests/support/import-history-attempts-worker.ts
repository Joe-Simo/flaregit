import { DurableObject } from "cloudflare:workers";
import { ImportHistoryAttempts } from "../../src/server/import-history-attempts";
export class AttemptsTest extends DurableObject {
  async run(input: { method: "start" | "dispatchUnknown" | "observed" | "nativeAllocationIntent" | "nativeStopped"; generation: number; nativeRunId?: string; status?: "terminated"; now?: number }) {
    const ledger = new ImportHistoryAttempts(this.ctx.storage);
    const op = "import-history-11111111-1111-4111-8111-111111111111";
    if (input.method === "observed") return ledger.observed(op, input.generation, input.status!);
    if (input.method === "nativeStopped") return ledger.nativeStopped(op, input.generation, input.nativeRunId!);
    if (input.method === "start") return ledger.start(op, input.generation, input.now);
    return ledger[input.method](op, input.generation);
  }
}
export default { async fetch(request: Request, env: { TEST: DurableObjectNamespace<AttemptsTest> }) {
  try { return Response.json(await env.TEST.getByName("test").run(await request.json())); }
  catch { return new Response("Rejected", { status: 409 }); }
} };
