import { readPublicPlanPrice } from "../../src/server/plan-price.js";

export default {
  async fetch(request: Request) {
    const env = { POLAR_ACCESS_TOKEN: "test-only-no-live-credential", POLAR_PRODUCT_ID: "00000000-0000-4000-8000-000000000001" };
    const parameters = new URL(request.url).searchParams;
    const native = globalThis.fetch;
    const priceRequest = parameters.has("error") ? (url: string, init: RequestInit) => native(url, { ...init, redirect: "error" }) : parameters.has("bound") ? globalThis.fetch.bind(globalThis) : undefined;
    return Response.json(await readPublicPlanPrice(env, priceRequest));
  },
};
