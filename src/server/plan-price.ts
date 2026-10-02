import { z } from "zod";
import type { Env } from "./env.js";

type PriceUnavailableReason = "not_configured" | "invalid_configuration" | "provider_unavailable" | "product_mismatch" | "inactive_product" | "unsupported_pricing" | "invalid_response";
export type PublicPlanPrice = {
  status: "known"; source: "polar"; environment: "production" | "sandbox";
  amountMinor: number; currency: string; interval: "day" | "week" | "month" | "year";
  intervalCount: number; taxBehavior: "inclusive" | "exclusive" | "location";
} | { status: "unavailable"; reason: PriceUnavailableReason };
export type PriceRequest = (url: string, init: RequestInit) => Promise<Response>;

const interval = z.enum(["day", "week", "month", "year"]);
const productSchema = z.object({
  id: z.string(), is_archived: z.boolean(), is_recurring: z.boolean(),
  visibility: z.enum(["draft", "private", "public"]),
  recurring_interval: interval.nullable(), recurring_interval_count: z.number().int().positive().nullable(),
  prices: z.array(z.object({ is_archived: z.boolean(), amount_type: z.string(), product_id: z.string() }).passthrough()).max(100),
});
const fixedPriceSchema = z.object({
  amount_type: z.literal("fixed"), price_amount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  price_currency: z.string().regex(/^[a-zA-Z]{3}$/),
  tax_behavior: z.enum(["inclusive", "exclusive", "location"]),
  legacy: z.boolean().optional(), type: z.string().optional(), recurring_interval: interval.optional(),
});

/** GET only; projects no vendor metadata, IDs, names, errors or credentials into the public response. */
export async function readPublicPlanPrice(
  env: Pick<Env, "POLAR_ACCESS_TOKEN" | "POLAR_PRODUCT_ID" | "POLAR_SERVER">,
  request: PriceRequest = fetch,
): Promise<PublicPlanPrice> {
  const unavailable = (reason: PriceUnavailableReason): PublicPlanPrice => ({ status: "unavailable", reason });
  if (!env.POLAR_ACCESS_TOKEN || !env.POLAR_PRODUCT_ID) return unavailable("not_configured");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(env.POLAR_PRODUCT_ID) || (env.POLAR_SERVER && !["production", "sandbox"].includes(env.POLAR_SERVER))) return unavailable("invalid_configuration");
  const environment = env.POLAR_SERVER === "sandbox" ? "sandbox" : "production";
  const base = environment === "sandbox" ? "https://sandbox-api.polar.sh" : "https://api.polar.sh";
  try {
    const response = await request(`${base}/v1/products/${env.POLAR_PRODUCT_ID}`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(5_000),
      headers: { Authorization: `Bearer ${env.POLAR_ACCESS_TOKEN}`, Accept: "application/json", "Polar-Version": "2026-04" },
    });
    if (!response.ok || response.redirected || (response.status >= 300 && response.status < 400)) return unavailable("provider_unavailable");
    const product = productSchema.safeParse(await response.json());
    if (!product.success) return unavailable("invalid_response");
    const value = product.data;
    if (value.id !== env.POLAR_PRODUCT_ID) return unavailable("product_mismatch");
    if (value.is_archived || !value.is_recurring || value.visibility === "draft") return unavailable("inactive_product");
    const prices = value.prices.filter((price) => !price.is_archived);
    if (prices.length !== 1) return unavailable("unsupported_pricing");
    const price = prices[0]!;
    if (price.product_id !== value.id) return unavailable("product_mismatch");
    const fixed = fixedPriceSchema.safeParse(price);
    if (!fixed.success) return unavailable("unsupported_pricing");
    if (fixed.data.legacy && (fixed.data.type !== "recurring" || (value.recurring_interval && fixed.data.recurring_interval && value.recurring_interval !== fixed.data.recurring_interval))) return unavailable("unsupported_pricing");
    const recurrence = value.recurring_interval ?? (fixed.data.legacy && fixed.data.type === "recurring" ? fixed.data.recurring_interval : undefined);
    const intervalCount = value.recurring_interval_count ?? (fixed.data.legacy ? 1 : undefined);
    if (!recurrence || !intervalCount) return unavailable("unsupported_pricing");
    return { status: "known", source: "polar", environment, amountMinor: fixed.data.price_amount, currency: fixed.data.price_currency.toUpperCase(), interval: recurrence, intervalCount, taxBehavior: fixed.data.tax_behavior };
  } catch { return unavailable("provider_unavailable"); }
}
