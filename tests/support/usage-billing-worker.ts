import { RepositoryController } from "../../src/server/durable-object.js";
import { accountOf, cancelManagedRuns, globalOf, managedAgentEnvelope, settleManagedRun, startManagedRuns } from "../../src/server/projects.js";
import { handlePolarWebhook } from "../../src/server/polar-webhook.js";
import type { Env } from "../../src/server/env.js";

/** Production controller; the fixture only routes calls to the real account and global ledgers. */
export class UsageBillingController extends RepositoryController {}

const limits = { free: 2, paid: 50 };
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url), q = url.searchParams, account = q.get("account") ?? "";
    if (url.pathname === "/webhooks/polar") return handlePolarWebhook(request, env);
    if (url.pathname === "/start") {
      const runId = q.get("run")!, started = await startManagedRuns(env, account, [runId], limits);
      if (started instanceof Response) return Response.json({ refused: started.status, message: await started.text() });
      if (started.tier === "free") await accountOf(env, account).consumeRun(limits.free, runId);
      return Response.json(started);
    }
    if (url.pathname === "/cancel") { await cancelManagedRuns(env, account, [q.get("run")!]); return Response.json({ ok: true }); }
    if (url.pathname === "/work") {
      // One container slice and one model call, like an agent round; usage is the provider's report.
      const runId = q.get("run")!;
      await globalOf(env).consumeManagedSpend(runId, 0, 0, Number(q.get("seconds")));
      await globalOf(env).consumeManagedSpend(runId, 1000, 8192, 0);
      await globalOf(env).recordManagedUsage(runId, Number(q.get("in")), Number(q.get("out")));
      return Response.json({ ok: true });
    }
    if (url.pathname === "/settle") return Response.json(await settleManagedRun(env, q.get("run")!));
    if (url.pathname === "/credits") return Response.json(await accountOf(env, account).creditSummary());
    if (url.pathname === "/auto-recharge") return Response.json(await accountOf(env, account).setAutoRecharge(await request.json()));
    if (url.pathname === "/pool") return Response.json({ pool: await globalOf(env).managedSpendReserved(new Date().toISOString().slice(0, 7)), envelope: managedAgentEnvelope(account || "a", "r").usdMicros });
    return new Response("Not found", { status: 404 });
  },
};
