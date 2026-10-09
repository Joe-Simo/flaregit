import { DurableObject } from "cloudflare:workers";
import type { Task } from "../../src/core/types";
import { AgentBoard } from "../../src/server/agent-board";
import { AgentRunLedger, type AgentRunInput } from "../../src/server/agent-run-ledger";
import { MembershipEpochs } from "../../src/server/membership-epochs";

/** Real SQLite DO hosting the production AgentBoard and AgentRunLedger. The read
 * fence is the direct `members` table with its real membership-epoch triggers. */
export class AgentBoardFixture extends DurableObject {
  private pending = false;
  private boardInstance?: AgentBoard;
  private board() {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS members(user_id TEXT PRIMARY KEY,role TEXT NOT NULL); CREATE TABLE IF NOT EXISTS fixture_tasks(id TEXT PRIMARY KEY,doc TEXT NOT NULL);");
    new MembershipEpochs(this.ctx.storage);
    return this.boardInstance ??= new AgentBoard(this.ctx, {
      tasks: () => Object.fromEntries(this.ctx.storage.sql.exec<{ id: string; doc: string }>("SELECT id,doc FROM fixture_tasks").toArray().map(row => [row.id, JSON.parse(row.doc) as Task])),
      deleting: () => false,
      canRead: async userId => this.ctx.storage.sql.exec("SELECT 1 FROM members WHERE user_id=?", userId).toArray().length > 0,
    });
  }
  private runs() { this.board(); return new AgentRunLedger(this.ctx.storage, () => { if (this.pending) return; this.pending = true; queueMicrotask(() => { this.pending = false; this.board().refresh(); }); }); }
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url), board = this.board();
    if (url.pathname === "/agent-board") return board.accept(request);
    const input = await request.json() as Record<string, unknown>;
    try {
      switch (url.pathname) {
        case "/member": this.ctx.storage.sql.exec("INSERT OR REPLACE INTO members VALUES(?,?)", input.userId as string, "member"); board.revalidate(); return Response.json(true);
        case "/remove-member": this.ctx.storage.sql.exec("DELETE FROM members WHERE user_id=?", input.userId as string); board.revalidate(); return Response.json(true);
        case "/task": this.ctx.storage.sql.exec("INSERT OR REPLACE INTO fixture_tasks VALUES(?,?)", (input.task as Task).id, JSON.stringify(input.task)); board.refresh(); return Response.json(true);
        case "/ticket": return Response.json(await board.issueTicket(input.userId as string, null));
        case "/claim": return Response.json(this.runs().claim(input as unknown as AgentRunInput));
        case "/propose": return Response.json(await this.runs().propose(input.runId as string, input.taskId as string, input.files as Record<string, string>));
        case "/context": return Response.json(board.coordinationContext(input.runId as string, input.taskId as string));
        case "/warnings": return Response.json(board.warningsFor(input.taskId as string));
        default: return new Response("Not found", { status: 404 });
      }
    } catch (error) { return new Response(error instanceof Error ? error.message : "Refused", { status: 409 }); }
  }
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) { await this.board().webSocketMessage(ws, message); }
  override async webSocketClose(ws: WebSocket, code: number) { await this.board().webSocketClose(ws, code); }
}
export default { fetch: (request: Request, env: { TEST: DurableObjectNamespace<AgentBoardFixture> }) => env.TEST.getByName("repository").fetch(request) };
