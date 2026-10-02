import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

test("default price-reader fetch reaches intercepted Polar fixture in actual workerd", async () => {
  const built = await Bun.build({ entrypoints: ["tests/support/plan-price-worker.ts"], target: "browser", external: ["cloudflare:workers"] });
  if (!built.success) throw new Error(built.logs.join("\n"));
  const id = "00000000-0000-4000-8000-000000000001";
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: "price-runtime", modules: true, script: await built.outputs[0]!.text(), compatibilityDate: "2026-10-02",
    outboundService: "polar-fixture",
  }, {
    name: "polar-fixture", modules: true, compatibilityDate: "2026-10-02",
    script: `let calls=0; export default { async fetch(request) { if(new URL(request.url).pathname==='/stats') return Response.json({calls}); calls++; if(request.url!=='https://api.polar.sh/v1/products/00000000-0000-4000-8000-000000000001' || request.method!=='GET') return new Response(null,{status:400}); if(request.headers.get('Authorization')!=='Bearer test-only-no-live-credential') return new Response(null,{status:401}); return Response.json({ id: '00000000-0000-4000-8000-000000000001', is_archived:false, is_recurring:true, visibility:'private', recurring_interval:'month', recurring_interval_count:1, prices:[{product_id:'00000000-0000-4000-8000-000000000001',is_archived:false,amount_type:'fixed',price_amount:400,price_currency:'usd',tax_behavior:'exclusive'}]}); } };`,
  }] }));
  try {
    const worker = await mf.getWorker("price-runtime");
    const response = await worker.fetch("http://test/");
    expect(await response.json()).toEqual({ status: "known", source: "polar", environment: "production", amountMinor: 400, currency: "USD", interval: "month", intervalCount: 1, taxBehavior: "exclusive" });
    const fixture = await mf.getWorker("polar-fixture");
    expect(await (await fixture.fetch("http://test/stats")).json()).toEqual({calls:1});
    const bound = await worker.fetch("http://test/?bound");
    expect(await bound.json()).toEqual({ status: "known", source: "polar", environment: "production", amountMinor: 400, currency: "USD", interval: "month", intervalCount: 1, taxBehavior: "exclusive" });
    const unsupported = await worker.fetch("http://test/?error");
    expect(await unsupported.json()).toEqual({ status: "unavailable", reason: "provider_runtime_error" });
    expect(await (await fixture.fetch("http://test/stats")).json()).toEqual({calls:2});
  } finally { await mf.dispose(); }
}, 30_000);
