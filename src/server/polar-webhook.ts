import type { Env } from "./env.js";
import { accountOf } from "./projects.js";
import { billingFromEvent, creditOrderFromEvent, newerBilling, verifyPolarWebhook } from "./polar.js";

/** Polar webhooks cannot log in; the Standard Webhooks signature is the authentication.
 * Subscription events update the legacy plan; credit-product orders deposit (once per order id)
 * or claw back refunds (cumulative, so replays and reordering never double count). */
export async function handlePolarWebhook(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  let event: unknown;
  try {
    event = await verifyPolarWebhook(body, request.headers, env.POLAR_WEBHOOK_SECRET);
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }
  const change = billingFromEvent(event, env.POLAR_PRODUCT_ID);
  if (change) {
    const account = accountOf(env, change.accountKey);
    if (newerBilling(await account.getBilling(), change.billing)) await account.setBilling(change.billing);
  }
  const order = creditOrderFromEvent(event, env.POLAR_CREDIT_PRODUCT_ID);
  if (order) await accountOf(env, order.accountKey).applyCreditOrder(order);
  return new Response(null, { status: 202 });
}
