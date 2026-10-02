import { expect, test } from "bun:test";
import { readPublicPlanPrice, type PriceRequest } from "../src/server/plan-price.js";

const id = "00000000-0000-4000-8000-000000000001";
const env = { POLAR_ACCESS_TOKEN: "server-only-secret", POLAR_PRODUCT_ID: id };
const product = () => ({ id, is_archived: false, is_recurring: true, visibility: "private", recurring_interval: "month", recurring_interval_count: 1, metadata: { secret: "private-field" }, name: "private-name", organization_id: "private-org", prices: [{ product_id: id, is_archived: false, amount_type: "fixed", price_amount: 400, price_currency: "usd", tax_behavior: "exclusive" }] });
const returns = (body: unknown): PriceRequest => async () => Response.json(body);

test("configured product GET keeps authentication and all private vendor fields server-side", async () => {
  let called = false;
  const request: PriceRequest = async (url, init) => {
    called = true;
    expect(String(url)).toBe(`https://api.polar.sh/v1/products/${id}`);
    expect(init?.method).toBe("GET"); expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer server-only-secret");
    expect(init?.signal).toBeDefined();
    return Response.json(product());
  };
  const result = await readPublicPlanPrice(env, request);
  expect(called).toBe(true);
  expect(result).toEqual({ status: "known", source: "polar", environment: "production", amountMinor: 400, currency: "USD", interval: "month", intervalCount: 1, taxBehavior: "exclusive" });
  expect(JSON.stringify(result)).not.toMatch(/secret|private|organization|00000000/);
});
test("redirect and provider errors never expose error bodies or tokens", async () => {
  const request: PriceRequest = async () => new Response("server-only-secret", { status: 302, headers: { Location: "https://attacker.example" } });
  expect(await readPublicPlanPrice(env, request)).toEqual({ status: "unavailable", reason: "provider_unavailable" });
  expect(await readPublicPlanPrice(env, async () => { throw new Error("server-only-secret"); })).toEqual({ status: "unavailable", reason: "provider_unavailable" });
});
test.each([
  [401, "provider_access_denied"], [403, "provider_access_denied"], [404, "provider_not_found"],
  [429, "provider_rate_limited"], [400, "provider_rejected_request"], [500, "provider_unavailable"],
] as const)("HTTP %s projects a safe classification %s without vendor details", async (status, reason) => {
  const result = await readPublicPlanPrice(env, async () => new Response("server-only-secret and private provider URL", { status: Number(status) }));
  expect(result).toEqual({ status: "unavailable", reason });
  expect(JSON.stringify(result)).not.toMatch(/secret|URL/);
});
test("wrong products, archived/draft/nonrecurring products cannot advertise a subscription", async () => {
  expect((await readPublicPlanPrice(env, returns({ ...product(), id: "other" })))).toEqual({ status: "unavailable", reason: "product_mismatch" });
  for (const patch of [{ is_archived: true }, { visibility: "draft" }, { is_recurring: false }]) expect(await readPublicPlanPrice(env, returns({ ...product(), ...patch }))).toEqual({ status: "unavailable", reason: "inactive_product" });
});
test("complex, ambiguous, absent and mismatched price information stays unavailable", async () => {
  const p = product();
  for (const prices of [[], [...p.prices, ...p.prices], [{ ...p.prices[0], amount_type: "seat_based" }]]) expect(await readPublicPlanPrice(env, returns({ ...p, prices }))).toEqual({ status: "unavailable", reason: "unsupported_pricing" });
  expect(await readPublicPlanPrice(env, returns({ ...p, prices: [{ ...p.prices[0], product_id: "wrong" }] }))).toEqual({ status: "unavailable", reason: "product_mismatch" });
  expect(await readPublicPlanPrice({}, returns(p))).toEqual({ status: "unavailable", reason: "not_configured" });
  expect(await readPublicPlanPrice(env, returns({ ...p, prices: [{ ...p.prices[0], legacy: true, type: "recurring", recurring_interval: "year" }] }))).toEqual({ status: "unavailable", reason: "unsupported_pricing" });
});
