import { RepositoryController } from '../../src/server/durable-object';
import type { Env } from '../../src/server/env';
export class WebhookReplayFixture extends RepositoryController {
  constructor(ctx: DurableObjectState, env: Env) {
    // Begin with a pre-generation database and an existing saved delivery.
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,seq INTEGER NOT NULL DEFAULT 0,queue_ms INTEGER,webhook_id TEXT NOT NULL,event TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_status INTEGER,last_error TEXT,latency_ms INTEGER,payload TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
    ctx.storage.sql.exec("INSERT OR IGNORE INTO deliveries(id,webhook_id,event,status,attempts,payload,created_at,updated_at) VALUES('dlv_legacy','wh_legacy','change.accepted','pending',2,'legacy-payload','2026-10-02T00:00:00.000Z','2026-10-02T00:00:00.000Z')");
    super(ctx, { ...env, INTEGRATION_QUEUE: { send: async () => undefined } } as unknown as Env);
  }
  override async fetch(request: Request) {
    const route = new URL(request.url).pathname;
    if (route === '/seed') {
      await this.initialize({ projectId: 'p123456789abc', projectName: 'Local replay fixture', canonicalRepoName: 'fixture', head: 'a'.repeat(40), verificationPolicy: {} });
      const { secret } = await request.json() as { secret: string };
      this.ctx.storage.sql.exec("INSERT INTO webhooks VALUES('wh_local','https://receiver.fixture.example/webhook',?,'change.accepted',1,?)", secret, new Date().toISOString());
      this.ctx.storage.sql.exec("INSERT INTO deliveries(id,webhook_id,event,status,attempts,payload,created_at,updated_at) VALUES('dlv_local','wh_local','change.accepted','pending',5,'{\"id\":\"evt_local\",\"data\":{\"commit\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"}}',?,?)", new Date().toISOString(), new Date().toISOString());
      return Response.json({ seeded: true });
    }
    if (route === '/legacy') return Response.json(this.ctx.storage.sql.exec("SELECT generation,attempts,payload FROM deliveries WHERE id='dlv_legacy'").toArray()[0]);
    if (route === '/get') return Response.json(await this.getDelivery('dlv_local'));
    if (route === '/mark') return Response.json(await this.markDelivery('dlv_local', await request.json()));
    if (route === '/replay') return Response.json(await this.redeliver('dlv_local'));
    if (route === '/blocked') return Response.json(await this.isBlocked('dlv_local'));
    return new Response('Not found', { status: 404 });
  }
}
export default { fetch: (request: Request, env: { TEST: DurableObjectNamespace<WebhookReplayFixture> }) => env.TEST.getByName('repository').fetch(request) };
