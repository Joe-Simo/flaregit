import type { Env, QueueMessage } from "./env.js";
import type { IntegrationParams } from "./workflow.js";
import { ledgerOf } from "./scenario-workflow.js";
import { PROTECTED_PATHS } from "./shell.js";

/** Consumes push/integration events. The Durable Object de-duplicates by event id, so redelivery is safe. */
export async function handleQueueBatch(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const body = msg.body;
      if (body.type === "git.push") {
        await ledgerOf(env, body.projectId).ingestCheckpoint({ eventId: body.eventId, taskId: body.taskId, commit: body.commit, ready: body.ready });
      } else {
        const params: IntegrationParams = { projectId: body.projectId, taskIds: body.taskIds, fixture: "ticket-booking", protectedPaths: PROTECTED_PATHS };
        await env.INTEGRATION_WORKFLOW.create({ id: body.eventId, params });
      }
      msg.ack();
    } catch (err) {
      console.error("queue message failed", err instanceof Error ? err.message : String(err));
      msg.retry();
    }
  }
}
