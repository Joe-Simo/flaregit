import type { Env } from "./env.js";

export type Plan = "free" | "pro";

export interface Billing {
  plan: Plan;
  status: string;
  subscriptionId?: string;
  updatedAt: string;
}

const TOLERANCE_SECONDS = 300;

/** Every Polar customer/event created by FlareGit carries this namespace so it never mixes with other projects. */
export const CUSTOMER_PREFIX = "flaregit:";

const base64 = (value: string): Uint8Array<ArrayBuffer> | null => {
  try {
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

/** Candidate HMAC keys for a Polar webhook secret (Standard Webhooks `whsec_` base64 form, or raw UTF-8). */
function hmacKeys(secret: string): Uint8Array<ArrayBuffer>[] {
  const utf8 = new TextEncoder().encode(secret);
  const keys: Uint8Array<ArrayBuffer>[] = [utf8];
  const decoded = base64(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  if (decoded && decoded.byteLength > 0) keys.push(decoded);
  return keys;
}

/** Verifies a Standard Webhooks signature (as used by Polar) and returns the parsed JSON body. */
export async function verifyPolarWebhook(body: string, headers: Headers, secret: string | undefined): Promise<unknown> {
  if (!secret) throw new Error("POLAR_WEBHOOK_SECRET is not configured");
  const id = headers.get("webhook-id");
  const timestamp = Number(headers.get("webhook-timestamp"));
  const signatures = headers.get("webhook-signature");
  if (!id || !signatures || !Number.isFinite(timestamp)) throw new Error("Missing signature headers");
  const now = Date.now() / 1000;
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) throw new Error("Timestamp outside tolerance");

  const signed = new TextEncoder().encode(`${id}.${Math.floor(timestamp)}.${body}`);
  for (const keyBytes of hmacKeys(secret)) {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    for (const part of signatures.split(" ")) {
      const [version, sig] = part.split(",", 2);
      const decoded = version === "v1" && sig ? base64(sig) : null;
      if (decoded && (await crypto.subtle.verify("HMAC", key, decoded, signed))) return JSON.parse(body);
    }
  }
  throw new Error("Invalid signature");
}

/** Maps a Polar subscription webhook payload to a project's plan. The customer's external_id is the project id. */
export function billingFromEvent(event: unknown, productId: string | undefined): { projectId: string; billing: Billing } | null {
  const e = event as {
    type?: string;
    data?: { id?: string; status?: string; product_id?: string; product?: { id?: string }; customer?: { external_id?: string | null } };
  };
  if (!e?.type?.startsWith("subscription.")) return null;
  // The Polar organization is shared with other projects: act only on FlareGit's own product and customers.
  if (!productId || (e.data?.product_id ?? e.data?.product?.id) !== productId) return null;
  const externalId = e.data?.customer?.external_id;
  if (!externalId?.startsWith(CUSTOMER_PREFIX)) return null;
  const projectId = externalId.slice(CUSTOMER_PREFIX.length);
  if (!/^[0-9a-f]{12}$/.test(projectId)) return null;
  const status = e.data?.status ?? "unknown";
  const paid = status === "active" || status === "trialing";
  return {
    projectId,
    billing: { plan: paid ? "pro" : "free", status, subscriptionId: e.data?.id, updatedAt: new Date().toISOString() },
  };
}

const apiBase = (env: Env) => (env.POLAR_SERVER === "sandbox" ? "https://sandbox-api.polar.sh" : "https://api.polar.sh");

export async function createCheckout(env: Env, opts: { projectId: string; email: string; successUrl: string }): Promise<string> {
  if (!env.POLAR_ACCESS_TOKEN || !env.POLAR_PRODUCT_ID) throw new Error("Billing is not configured");
  const res = await fetch(`${apiBase(env)}/v1/checkouts/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      products: [env.POLAR_PRODUCT_ID],
      external_customer_id: `${CUSTOMER_PREFIX}${opts.projectId}`,
      ...(opts.email ? { customer_email: opts.email } : {}),
      success_url: opts.successUrl,
      metadata: { app: "flaregit", projectId: opts.projectId },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Polar checkout failed (${res.status})`);
  const checkout = (await res.json()) as { url?: string };
  if (!checkout.url) throw new Error("Polar returned no checkout URL");
  return checkout.url;
}

/** Usage event for metered billing; best-effort and de-duplicated by external_id. */
export async function reportUsage(env: Env, projectId: string, name: string, externalId: string, metadata: Record<string, string | number>): Promise<void> {
  if (!env.POLAR_ACCESS_TOKEN) return;
  await fetch(`${apiBase(env)}/v1/events/ingest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ events: [{ name: `flaregit.${name}`, external_customer_id: `${CUSTOMER_PREFIX}${projectId}`, external_id: `flaregit:${externalId}`, metadata: { app: "flaregit", ...metadata } }] }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

export const planLimits = (env: Env): Record<Plan, number> => ({
  free: Number(env.FREE_RUNS_PER_DAY ?? "3"),
  pro: Number(env.PRO_RUNS_PER_DAY ?? "100"),
});
