import { DurableObject } from "cloudflare:workers";
import { AgentRunLedger, type AgentRunInput } from "../../src/server/agent-run-ledger";
export class AgentRunFixture extends DurableObject {
  override async fetch(request: Request) {
    const ledger = new AgentRunLedger(this.ctx.storage), route = new URL(request.url).pathname;
    try {
      if (route === "/claim") return Response.json(ledger.claim(await request.json() as AgentRunInput));
      if (route === "/resume") { const value = await request.json() as { newRunId: string; taskId: string; previousRunId: string; allowedScope: string[]; protectedPaths: string[]; goal: string }; return Response.json(ledger.resume(value.newRunId,value.taskId,value.previousRunId,value.allowedScope,value.protectedPaths,value.goal)); }
      const input = await request.json() as { runId: string; taskId: string; files: Record<string,string>; commit: string; eventId: string; reason: string };
      if (route === "/propose") return Response.json(await ledger.propose(input.runId,input.taskId,input.files));
      if (route === "/push") return Response.json(ledger.markPushed(input.runId,input.taskId,input.commit));
      if (route === "/checkpoint") return Response.json(ledger.checkpoint(input.runId,input.taskId,input.eventId,input.commit));
      if (route === "/fail") return Response.json(ledger.fail(input.runId,input.taskId,input.reason));
      if (route === "/get") return Response.json(ledger.get(input.runId));
      return new Response("Not found",{status:404});
    } catch { return new Response("Refused",{status:409}); }
  }
}
export default {fetch:(request:Request,env:{TEST:DurableObjectNamespace<AgentRunFixture>})=>env.TEST.getByName("repository").fetch(request)};
