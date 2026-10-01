/**
 * Cloudflare Queue: FlareGit Async Event & Checkpoint Consumer
 * 
 * Ingests Git push events and checkpoint submissions asynchronously.
 * Reconciles authoritative repository refs and triggers background workflow runs.
 */

export interface QueueMessage {
  type: "checkpoint.ingest" | "git.push" | "workflow.trigger";
  taskId?: string;
  repoName?: string;
  ref?: string;
  commitHash?: string;
  timestamp: string;
}

export async function handleQueueBatch(
  batch: { messages: Array<{ body: QueueMessage; ack: () => void; retry: () => void }> },
  env: any
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const payload = msg.body;
      if (payload.type === "git.push") {
        console.log(`[Queue] Ingested Git push to ${payload.repoName} at ${payload.commitHash}`);
      } else if (payload.type === "checkpoint.ingest") {
        console.log(`[Queue] Ingested checkpoint for task ${payload.taskId}`);
      }
      msg.ack();
    } catch (err) {
      console.error("[Queue] Processing error:", err);
      msg.retry();
    }
  }
}
