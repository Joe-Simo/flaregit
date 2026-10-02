import type { Env, QueueMessage } from "./env.js";
import { deliverWebhook } from "./webhooks.js";
import { globalOf } from "./projects.js";
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
        const retryAfter = await deliverWebhook(env, body.projectId, body.deliveryId);
        if (retryAfter !== null) {
          // Re-enqueue rather than msg.retry(): waiting for an earlier event must not consume the queue's retry budget.
          await env.INTEGRATION_QUEUE.send(body, { delaySeconds: retryAfter });
        }
      } else {
        const params: IntegrationParams = { projectId: body.projectId, taskIds: body.taskIds };
        await env.INTEGRATION_WORKFLOW.create({ id: body.eventId, params });
      }
      msg.ack();
    } catch (err) {
      console.error("queue message failed", err instanceof Error ? err.message : String(err));
      msg.retry();
    }
  }
}
