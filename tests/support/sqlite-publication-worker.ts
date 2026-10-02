import { RepositoryController } from "../../src/server/durable-object.js";
import type { FlareGitProjectState } from "../../src/core/types.js";

/** Test-only fixture injection; all acceptance/abort transitions execute production methods. */
export class PublicationFixture extends RepositoryController {
  seed(state: FlareGitProjectState, holder: string) {
    this.ctx.storage.sql.exec("INSERT INTO project (id, doc) VALUES (1, ?)", JSON.stringify(state));
    this.ctx.storage.sql.exec("INSERT INTO lease (id, holder, expires_at) VALUES (1, ?, ?)", holder, Date.now() + 60_000);
    this.ctx.storage.sql.exec("INSERT INTO webhooks (id,url,secret,events,active,created_at) VALUES ('hook','https://example.com/hook','test-secret','change.accepted,change.ready,change.blocked,decision.needed',1,'now')");
  }
  failSave(enabled: boolean) {
    if (enabled) this.ctx.storage.sql.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON project BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END");
    else this.ctx.storage.sql.exec("DROP TRIGGER fail_save");
  }
  expireLease() { this.ctx.storage.sql.exec("DELETE FROM lease"); }
  async snapshot() {
    return {
      state: JSON.parse(String(this.ctx.storage.sql.exec("SELECT doc FROM project").toArray()[0]?.doc)),
      lease: this.ctx.storage.sql.exec("SELECT holder FROM lease").toArray(),
      deliveries: this.ctx.storage.sql.exec("SELECT id, payload FROM deliveries").toArray(),
      events: this.ctx.storage.sql.exec("SELECT id FROM events").toArray(),
      webhooks: this.ctx.storage.sql.exec("SELECT id FROM webhooks").toArray(),
      alarm: await this.ctx.storage.getAlarm(),
    };
  }
}

export default {
  async fetch(request: Request, env: { TEST: DurableObjectNamespace<PublicationFixture> }) {
    const url = new URL(request.url);
    const stub = env.TEST.get(env.TEST.idFromName(url.searchParams.get("name") ?? "test"));
    try {
      if (url.pathname === "/seed") { const body = await request.json() as { state: FlareGitProjectState; holder: string }; await stub.seed(body.state, body.holder); }
      if (url.pathname === "/fail") await stub.failSave(url.searchParams.get("enabled") === "true");
      if (url.pathname === "/complete") await stub.completePublish("journal");
      if (url.pathname === "/abort") await stub.abortPublish("candidate", "journal", "late abort", "failed");
      if (url.pathname === "/checkpoint") await stub.ingestCheckpoint({ eventId: "checkpoint-event", taskId: "task", commit: "checkpoint-tip", ready: true });
      if (url.pathname === "/subscribe") await stub.addWebhook("https://example.com/hook", await request.json() as string[]);
      if (url.pathname === "/expire") await stub.expireLease();
      if (url.pathname === "/claim") await stub.claimLanding({ holder: "claim-holder", taskIds: (url.searchParams.get("tasks") ?? "task").split(",") });
      return Response.json(await stub.snapshot());
    } catch (error) { return Response.json({ error: String(error) }, { status: 500 }); }
  },
};
