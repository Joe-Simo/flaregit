import type { Env, QueueMessage } from "./env.js";
import { deliverWebhook, BLOCKED } from "./webhooks.js";
import { accountKeyFor, accountOf, globalOf, projectOf } from "./projects.js";
import type { IntegrationParams } from "./workflow.js";
import { ledgerOf } from "./scenario-workflow.js";

/** Consumes push/integration events. The Durable Object de-duplicates by event id, so redelivery is safe. */
export async function handleQueueBatch(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const body = msg.body;
      if (body.type === "git.push") {
        await ledgerOf(env, body.projectId).ingestCheckpoint({ eventId: body.eventId, taskId: body.taskId, commit: body.commit, ready: body.ready });
      } else if (body.type === "probe") {
        await globalOf(env).recordProbe("queue", true, Date.now() - body.sentAt, "consumer received probe");
      } else if (body.type === "webhook.deliver") {
        const retryAfter = await deliverWebhook(env, body.projectId, body.deliveryId, body.generation??0);
        if (retryAfter === BLOCKED) {
          const ledger=projectOf(env,body.projectId);
          const found=await ledger.getDelivery(body.deliveryId);
          if(found)await ledger.deferBlockedWebhook(body.deliveryId,body.generation??0,body.blockedSequence??0);
        } else if (retryAfter !== null) {
          // Receiver retries are separately bounded by the durable attempt count.
          await env.INTEGRATION_QUEUE.send(body, { delaySeconds: retryAfter });
        }
      } else {
        const repository = ledgerOf(env, body.projectId);
        if(!/^[a-z0-9]{12,16}$/.test(body.projectId)||!/^[a-zA-Z0-9_-]{1,128}$/.test(body.eventId)||!Array.isArray(body.taskIds)||body.taskIds.length<1||body.taskIds.length>8||new Set(body.taskIds).size!==body.taskIds.length||body.taskIds.some(id=>typeof id!=="string"||!/^[a-z0-9][a-z0-9-]{0,100}$/.test(id)))throw new Error("Invalid integration dispatch");
        const dispatch=await repository.admitIntegrationDispatch(body.eventId,body.taskIds);
        if(dispatch.terminal){msg.ack();continue;}
        const actorId=dispatch.actorId;
        if(!actorId||!await repository.roleOf(actorId))throw new Error("Integration dispatch actor is unavailable");
        const accountKey=await accountKeyFor(actorId);
        if(await accountOf(env,accountKey).accountLifecycle()!=="active")throw new Error("Integration dispatch account is unavailable");
        const current=await repository.admitIntegrationDispatch(body.eventId,body.taskIds);
        if(current.terminal){msg.ack();continue;}
        if(current.actorId!==actorId)throw new Error("Integration dispatch authority changed");
        // Billing authority comes from the stored authenticated request, never queue payload data.
        const params: IntegrationParams = { projectId: body.projectId, taskIds: body.taskIds, accountKey,nativeRuntimeProtocolVersion:1 };
        // Documented batch creation skips retained duplicate IDs. Errors still
        // retry; a lost acknowledgment never becomes an inferred successful start.
        const created=await env.INTEGRATION_WORKFLOW.createBatch([{ id: body.eventId, params }]);
        if(!Array.isArray(created)||created.length>1||created.some(instance=>instance.id!==body.eventId))throw new Error("Integration dispatch acknowledgment is invalid");
      }
      msg.ack();
    } catch (err) {
      console.error("queue message failed", err instanceof Error ? err.message : String(err));
      msg.retry();
    }
  }
}
