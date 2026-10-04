import { handleQueueBatch } from "../../src/server/queue";
import type { Env, QueueMessage } from "../../src/server/env";
export default {async fetch(request:Request){const generation=Number(new URL(request.url).searchParams.get("generation"));
  let deferrals = 0, sends = 0, acknowledgments = 0, retries = 0;
  const ledger = {
    getDelivery: async () => ({ delivery: { generation, status: "pending", payload: "{}" }, webhook: { active: 1 } }),
    isBlocked: async () => true,
    deferBlockedWebhook: async (_id: string, value: number, sequence: number) => { if(value!==0||sequence!==0)throw new Error("Legacy scope changed"); deferrals++; },
  };
  const env = { REPOSITORY_CONTROLLER: { idFromName: () => "fixture", get: () => ledger }, INTEGRATION_QUEUE: { send: async () => { sends++; } } } as unknown as Env;
  const batch = { messages: [{ body: { type: "webhook.deliver", projectId: "abcdef123456", deliveryId: "delivery" }, ack: () => { acknowledgments++; }, retry: () => { retries++; } }] } as unknown as MessageBatch<QueueMessage>;
  await handleQueueBatch(batch, env);
return Response.json({deferrals,sends,acknowledgments,retries});}};
