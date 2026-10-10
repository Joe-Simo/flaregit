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

export interface AccountBilling extends Billing { providerUpdatedAt?: string }

/** Maps a Polar subscription webhook payload to an account's plan.
 * The Polar customer's external_id is `flaregit:<accountKey>` (checkout sets it), so billing is account-level. */
export function billingFromEvent(event: unknown, productId: string | undefined): { accountKey: string; billing: AccountBilling } | null {
  const e = event as {
    type?: string;
    data?: { id?: string; status?: string; modified_at?: string | null; created_at?: string; product_id?: string; product?: { id?: string }; customer?: { external_id?: string | null } };
  };
  if (!e?.type?.startsWith("subscription.")) return null;
  // The Polar organization is shared with other projects: act only on FlareGit's own product and customers.
  if (!productId || (e.data?.product_id ?? e.data?.product?.id) !== productId) return null;
  const accountKey = accountKeyFromExternalId(e.data?.customer?.external_id);
  if (!accountKey) return null;
  const status = e.type === "subscription.revoked" ? "revoked" : e.data?.status ?? "unknown";
  const paid = status === "active" || status === "trialing";
  const providerUpdatedAt = e.data?.modified_at ?? e.data?.created_at;
  return {
    accountKey,
    billing: { plan: paid ? "pro" : "free", status, subscriptionId: e.data?.id, updatedAt: new Date().toISOString(), ...(providerUpdatedAt && Number.isFinite(Date.parse(providerUpdatedAt)) ? { providerUpdatedAt } : {}) },
  };
}

/** Webhooks can arrive out of order; an older provider snapshot never overwrites a newer one. */
export function newerBilling(current: AccountBilling | null, next: AccountBilling): boolean {
  if (!current?.providerUpdatedAt || !next.providerUpdatedAt) return true;
  return Date.parse(next.providerUpdatedAt) >= Date.parse(current.providerUpdatedAt);
}

function accountKeyFromExternalId(externalId: string | null | undefined): string | null {
  if (!externalId?.startsWith(CUSTOMER_PREFIX)) return null;
  const accountKey = externalId.slice(CUSTOMER_PREFIX.length);
  return /^[0-9a-f]{12}$/.test(accountKey) ? accountKey : null;
}

/** One USD cent in ledger micros. Polar amounts are integer cents. */
export const MICROS_PER_CENT = 10_000;

/** A credit change derived from a verified Polar order webhook for FlareGit's credit product.
 * `paidMicros` is the order's net amount (after discounts, before tax); `refundedMicros` is cumulative. */
export interface CreditOrderChange { accountKey: string; orderId: string; paidMicros: number; refundedMicros: number; paid: boolean }
export function creditOrderFromEvent(event: unknown, creditProductId: string | undefined): CreditOrderChange | null {
  const e = event as {
    type?: string;
    data?: { id?: string; status?: string; paid?: boolean; net_amount?: number; subtotal_amount?: number; discount_amount?: number; refunded_amount?: number; product_id?: string | null; product?: { id?: string } | null; customer?: { external_id?: string | null } };
  };
  if (!e?.type?.startsWith("order.") || !creditProductId) return null;
  const data = e.data;
  if (!data?.id || !/^[A-Za-z0-9_-]{1,100}$/.test(data.id) || (data.product_id ?? data.product?.id) !== creditProductId) return null;
  const accountKey = accountKeyFromExternalId(data.customer?.external_id);
  if (!accountKey) return null;
  const net = data.net_amount ?? (data.subtotal_amount ?? 0) - (data.discount_amount ?? 0);
  const refunded = data.refunded_amount ?? 0;
  if (!Number.isSafeInteger(net) || net < 0 || !Number.isSafeInteger(refunded) || refunded < 0) return null;
  const status = data.status ?? "";
  const paid = data.paid === true || ["paid", "refunded", "partially_refunded"].includes(status);
  return { accountKey, orderId: data.id, paidMicros: net * MICROS_PER_CENT, refundedMicros: Math.min(refunded, net) * MICROS_PER_CENT, paid };
}

const apiBase = (env: Pick<Env, "POLAR_SERVER">) => (env.POLAR_SERVER === "sandbox" ? "https://sandbox-api.polar.sh" : "https://api.polar.sh");

export async function createCheckout(env: Env, opts: { accountKey: string; email: string; successUrl: string }): Promise<string> {
  if (!env.POLAR_ACCESS_TOKEN || !env.POLAR_PRODUCT_ID) throw new Error("Billing is not configured");
  const res = await fetch(`${apiBase(env)}/v1/checkouts/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      products: [env.POLAR_PRODUCT_ID],
      external_customer_id: `${CUSTOMER_PREFIX}${opts.accountKey}`,
      ...(opts.email ? { customer_email: opts.email } : {}),
      success_url: opts.successUrl,
      metadata: { app: "flaregit", accountKey: opts.accountKey },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Polar checkout failed (${res.status})`);
  const checkout = (await res.json()) as { url?: string };
  if (!checkout.url) throw new Error("Polar returned no checkout URL");
  return checkout.url;
}


/** One-time checkout that buys prepaid credits. The credit product must have a pay-what-you-want price,
 * so `amountCents` is the deposit; Polar enforces the product's own minimum. */
export async function createCreditCheckout(env: Env, opts: { accountKey: string; email: string; amountCents: number; successUrl: string }): Promise<string> {
  if (!env.POLAR_ACCESS_TOKEN || !env.POLAR_CREDIT_PRODUCT_ID) throw new Error("Credit purchases are not configured");
  if (!Number.isSafeInteger(opts.amountCents) || opts.amountCents < 100 || opts.amountCents > 1_000_000) throw new Error("Invalid credit amount");
  const res = await fetch(`${apiBase(env)}/v1/checkouts/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      products: [env.POLAR_CREDIT_PRODUCT_ID],
      amount: opts.amountCents,
      external_customer_id: `${CUSTOMER_PREFIX}${opts.accountKey}`,
      ...(opts.email ? { customer_email: opts.email } : {}),
      success_url: opts.successUrl,
      metadata: { app: "flaregit", accountKey: opts.accountKey, purpose: "credits" },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Polar checkout failed (${res.status})`);
  const checkout = (await res.json()) as { url?: string };
  if (!checkout.url) throw new Error("Polar returned no checkout URL");
  return checkout.url;
}

export const planLimits = (env: Env): Record<Plan, number> => ({
  free: Number(env.FREE_RUNS_PER_DAY ?? "3"),
  pro: Number(env.PRO_RUNS_PER_DAY ?? "100"),
});
