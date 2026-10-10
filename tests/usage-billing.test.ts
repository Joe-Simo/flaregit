import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child.js";

const CREDIT_PRODUCT = "00000000-0000-4000-8000-0000000000c1";
const KEY = new Uint8Array(32).fill(7);
const SECRET = `whsec_${btoa(String.fromCharCode(...KEY))}`;

type Init = { method: string; body: string; headers?: Record<string, string> };
async function signed(body: unknown): Promise<Init> {
  const text = JSON.stringify(body), id = `msg_${crypto.randomUUID()}`, ts = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", KEY, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${text}`)));
  return { method: "POST", body: text, headers: { "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `v1,${btoa(String.fromCharCode(...sig))}` } };
}
const order = (type: string, account: string, data: Record<string, unknown>) => ({ type, data: { id: "order_1", currency: "usd", product_id: CREDIT_PRODUCT, customer: { external_id: `flaregit:${account}` }, ...data } });

test("prepaid credits: deposit once, free pool ceiling, hold, actual-cost debit, auto-recharge prompt, refund clawback", async () => {
  if (await workerdChild("tests/usage-billing.test.ts")) return;
  const file = `/tmp/usage-billing-${crypto.randomUUID()}.js`;
  const built = Bun.spawn([process.execPath, "build", "tests/support/usage-billing-worker.ts", "--target=browser", "--external=cloudflare:workers", "--external=node:*", `--outfile=${file}`], { stdout: "ignore", stderr: "pipe" });
  const [stderr, code] = await Promise.all([new Response(built.stderr).text(), built.exited]);
  if (code) throw new Error(stderr);
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: "usage-billing", modules: true, script: await Bun.file(file).text(), compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"],
    // Free pool fits exactly two agent envelopes (659,444 micros each); each account may spend $10/month.
    bindings: { MANAGED_GLOBAL_MONTHLY_USD_MICROS: "1400000", MANAGED_ACCOUNT_MONTHLY_USD_MICROS: "10000000", MANAGED_ESSENTIAL_GLOBAL_MONTHLY_USD_MICROS: "0", MANAGED_ESSENTIAL_ACCOUNT_MONTHLY_USD_MICROS: "0", POLAR_WEBHOOK_SECRET: SECRET, POLAR_CREDIT_PRODUCT_ID: CREDIT_PRODUCT },
    durableObjects: { REPOSITORY_CONTROLLER: { className: "UsageBillingController", useSQLite: true } },
  }] }));
  try {
    const worker = await mf.getWorker("usage-billing");
    const call = async (path: string, init?: Init) => { const response = await worker.fetch(`http://fixture${path}`, init); expect(response.status).toBeLessThan(300); return response.json() as Promise<Record<string, unknown>>; };
    const paid = "aaaaaaaaaaaa";

    // Free accounts share the pool: however many accounts start, only two envelopes fit.
    const free = await Promise.all(["f00000000001", "f00000000002", "f00000000003", "f00000000004", "f00000000005"].map((account, index) => call(`/start?account=${account}&run=free-${index}`)));
    expect(free.filter((result) => result.tier === "free")).toHaveLength(2);
    for (const refused of free.filter((result) => !result.tier)) expect(refused).toEqual({ refused: 402, message: expect.stringMatching(/^This month's free agent allowance is used up — add credits to keep running agents, or wait until [A-Z][a-z]+ 1, \d{4}\.$/) });
    const pool = await call("/pool");
    expect(pool.pool as number).toBeLessThanOrEqual(1_400_000);

    // No credits and an exhausted pool: blocked with plain text.
    expect((await call(`/start?account=${paid}&run=paid-0`)).refused).toBe(402);

    // A verified paid order deposits exactly once, however often Polar redelivers it.
    for (let i = 0; i < 3; i++) expect((await worker.fetch("http://fixture/webhooks/polar", await signed(order("order.paid", paid, { status: "paid", paid: true, net_amount: 500, refunded_amount: 0 })))).status).toBe(202);
    expect((await worker.fetch("http://fixture/webhooks/polar", { ...(await signed(order("order.paid", paid, { status: "paid", paid: true, net_amount: 99999 }))), headers: { "webhook-id": "x", "webhook-timestamp": String(Math.floor(Date.now() / 1000)), "webhook-signature": "v1,AAAA" } })).status).toBe(401);
    expect((await call(`/credits?account=${paid}`)).balanceMicros).toBe(5_000_000);
    // An order in another currency is never credited at face value.
    expect((await worker.fetch("http://fixture/webhooks/polar", await signed(order("order.paid", paid, { id: "order_eur", currency: "eur", status: "paid", paid: true, net_amount: 500, refunded_amount: 0 })))).status).toBe(202);
    expect((await call(`/credits?account=${paid}`)).balanceMicros).toBe(5_000_000);

    // Credit-funded runs are not blocked by the exhausted free pool; the full envelope is held.
    expect(await call(`/start?account=${paid}&run=paid-1`)).toEqual({ tier: "paid", dailyLimit: 50 });
    expect(await call(`/credits?account=${paid}`)).toMatchObject({ balanceMicros: 5_000_000 - 659_444, heldMicros: 659_444 });

    // Balance below one envelope blocks the next run before dispatch.
    await call(`/auto-recharge?account=${paid}`, { method: "POST", body: JSON.stringify({ enabled: true, thresholdCents: 500, amountCents: 2000 }) });
    const starts = [];
    for (let i = 2; i < 10; i++) starts.push(await call(`/start?account=${paid}&run=paid-${i}`));
    const refusedRun = starts.find((result) => result.refused);
    expect(refusedRun?.message).toMatch(/^Your credit balance \(\$0\.\d\d\) doesn't cover this run \(\$0\.66 is held until it finishes; unused credit comes back\)\. Add credits to keep running agents\.$/);
    for (let i = 2; i < 2 + starts.filter((result) => result.tier).length; i++) await call(`/cancel?account=${paid}&run=paid-${i}`);
    expect(await call(`/credits?account=${paid}`)).toMatchObject({ balanceMicros: 5_000_000 - 659_444, heldMicros: 659_444, rechargePrompt: null });

    // Settlement debits the actual cost (2,000 input + 1,000 output tokens, 300 container seconds) once.
    await call(`/work?run=paid-1&seconds=300&in=2000&out=1000`);
    const actual = Math.ceil(2000 * 0.35 + 1000 * 0.75) + Math.ceil(300 * 129_024 / 3600);
    expect(await call("/settle?run=paid-1")).toEqual({ usdMicros: actual, tier: "paid" });
    expect(await call("/settle?run=paid-1")).toEqual({ usdMicros: actual, tier: "paid" });
    const settled = await call(`/credits?account=${paid}`);
    expect(settled).toMatchObject({ balanceMicros: 5_000_000 - actual, heldMicros: 0 });
    // Balance fell below the $5 threshold: a one-click $20 top-up is prompted (Polar cannot charge off-session).
    expect(settled.rechargePrompt).toMatchObject({ amountCents: 2000, balanceMicros: 5_000_000 - actual });

    // A refund claws back what is spendable; the remainder is owed and blocks new runs.
    expect((await worker.fetch("http://fixture/webhooks/polar", await signed(order("order.refunded", paid, { status: "refunded", paid: true, net_amount: 500, refunded_amount: 500 })))).status).toBe(202);
    expect(await call(`/credits?account=${paid}`)).toMatchObject({ balanceMicros: 0, owedMicros: actual });
    expect((await call(`/start?account=${paid}&run=paid-20`)).message).toBe("A credit purchase was refunded or reversed. Add credits to cover it before running more agents.");
  } finally { await mf.dispose(); await Bun.file(file).delete(); }
}, 60_000);
