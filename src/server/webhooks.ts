import type { Env } from "./env.js";
import { projectOf } from "./projects.js";

const MAX_ATTEMPTS = 6;
const TIMEOUT_MS = 10_000;
/** Seconds to wait before re-checking when an earlier event for the same webhook has not been delivered yet. */
export const BLOCKED = 5;

/** Webhook targets must be public https hostnames: no IP literals, no localhost, no internal suffixes. */
export function validateWebhookUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Enter a valid https:// URL");
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (u.protocol !== "https:") throw new Error("Webhook URLs must use https");
  if (u.username || u.password) throw new Error("Do not put credentials in the URL");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) throw new Error("Webhook URLs must be public hostnames");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":") || host.startsWith("[")) throw new Error("Use a hostname, not an IP address");
  return u;
}

const b64decode = (v: string) => Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
const b64encode = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));

async function sign(secret: string, id: string, timestamp: number, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", b64decode(secret.replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64encode(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${payload}`)));
}

/** One delivery attempt. Returns the seconds to wait before retrying, or null when finished (success or out of attempts). */
export async function deliverWebhook(env: Env, projectId: string, deliveryId: string): Promise<number | null> {
  const ledger = projectOf(env, projectId);
  const found = await ledger.getDelivery(deliveryId);
  if (!found) return null;
  const { delivery, webhook } = found;
  // A duplicate queue message cannot restart an exhausted delivery. Explicit replay
  // resets the durable row to pending before enqueueing it again.
  if (delivery.status !== "pending") return null;
  if (!webhook.active) {
    await ledger.markDelivery(deliveryId, { generation: delivery.generation, ok: false, error: "Webhook disabled", final: true });
    return null;
  }

  // Deliver in order: wait while an earlier event for this webhook is still being retried (no attempt is consumed).
  if (await ledger.isBlocked(deliveryId)) return BLOCKED;

  const timestamp = Math.floor(Date.now() / 1000);
  const started = Date.now();
  try {
    validateWebhookUrl(webhook.url);
    const res = await fetch(webhook.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "FlareGit-Webhooks/1",
        "webhook-sequence": String(delivery.seq),
        "webhook-id": deliveryId, // stable across retries: receivers de-duplicate on it
        "webhook-timestamp": String(timestamp),
        "webhook-signature": `v1,${await sign(webhook.secret, deliveryId, timestamp, delivery.payload)}`,
      },
      body: delivery.payload,
    });
    const latencyMs = Date.now() - started;
    if (res.status >= 200 && res.status < 300) {
      await ledger.markDelivery(deliveryId, { generation: delivery.generation, ok: true, status: res.status, latencyMs });
      return null;
    }
    const attempts = await ledger.markDelivery(deliveryId, { generation: delivery.generation, ok: false, status: res.status, error: `Receiver answered ${res.status}`, latencyMs, final: delivery.attempts + 1 >= MAX_ATTEMPTS });
    return attempts === null || attempts >= MAX_ATTEMPTS ? null : Math.min(30 * 2 ** (attempts - 1), 3600);
  } catch {
    // Fetch exception text can contain the receiver URL, including query credentials.
    const attempts = await ledger.markDelivery(deliveryId, { generation: delivery.generation, ok: false, error: "Delivery failed or timed out", latencyMs: Date.now() - started, final: delivery.attempts + 1 >= MAX_ATTEMPTS });
    return attempts === null || attempts >= MAX_ATTEMPTS ? null : Math.min(30 * 2 ** (attempts - 1), 3600);
  }
}
