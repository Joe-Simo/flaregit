/**
 * Platform-owned protected checks for the ticket-booking fixture. This module lives outside any
 * contributor repository and is executed by the isolated runner against a candidate checkout.
 */
import * as path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { TestResultItem } from "../../core/types.js";

interface Policy {
  groupDiscountPercent?: number;
  minTicketsForDiscount?: number;
  refundFeePerTicket?: number;
  discountAppliesToRefundFee?: boolean;
}

type Quote = {
  ticketTotal: number;
  discountAmount: number;
  refundFeeTotal: number;
  total: number;
  isRefundable: boolean;
  receiptItems?: Array<{ description: string; amount: number; isDiscount?: boolean }>;
};
type Params = { ticketCount: number; basePrice: number; isRefundable?: boolean };

async function check(
  items: TestResultItem[],
  testId: string,
  description: string,
  fn: () => void | Promise<void>
): Promise<void> {
  const started = performance.now();
  try {
    await fn();
    items.push({ testId, description, passed: true, durationMs: Math.round(performance.now() - started) });
  } catch (err) {
    items.push({
      testId,
      description,
      passed: false,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - started),
    });
  }
}

function near(actual: number, expected: number, label: string): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.005) {
    throw new Error(`${label}: expected ${expected.toFixed(2)}, got ${actual}`);
  }
}

export async function runChecks(dir: string, policy: Policy): Promise<TestResultItem[]> {
  const items: TestResultItem[] = [];
  const pricing = (await import(path.join(dir, "src", "pricing.ts"))) as { calculateQuote: (p: Params) => Quote };
  const catalog = (await import(path.join(dir, "src", "catalog.ts"))) as {
    EVENT_CATALOG: Array<{ id: string; price: number }>;
  };
  const { calculateQuote } = pricing;
  const pct = policy.groupDiscountPercent;
  const minTickets = policy.minTicketsForDiscount;
  const fee = policy.refundFeePerTicket;

  await check(items, "REQ-BASE-SINGLE-TICKET", "1 ticket @ $40 without extras equals exactly $40.00", () => {
    const q = calculateQuote({ ticketCount: 1, basePrice: 40, isRefundable: false });
    near(q.total, 40, "total");
    near(q.discountAmount, 0, "discount");
    near(q.refundFeeTotal, 0, "refund fee");
  });

  if (pct !== undefined && minTickets !== undefined) {
    await check(items, "REQ-GROUP-DISCOUNT", `${pct * 100}% group discount from ${minTickets} tickets`, () => {
      const q = calculateQuote({ ticketCount: minTickets, basePrice: 40, isRefundable: false });
      near(q.discountAmount, 40 * minTickets * pct, "discount");
      near(q.total, 40 * minTickets * (1 - pct), "total");
      const below = calculateQuote({ ticketCount: minTickets - 1, basePrice: 40, isRefundable: false });
      near(below.discountAmount, 0, "discount below threshold");
    });
  }

  if (fee !== undefined) {
    await check(items, "REQ-REFUNDABLE-SURCHARGE", `Refundable adds $${fee} per ticket and flags the quote`, () => {
      const q = calculateQuote({ ticketCount: 2, basePrice: 40, isRefundable: true });
      if (q.isRefundable !== true) throw new Error("isRefundable flag not set");
      near(q.refundFeeTotal, 2 * fee, "refund fee");
      near(q.total, 80 + 2 * fee, "total");
    });
  }

  if (pct !== undefined && minTickets !== undefined && fee !== undefined) {
    const expected = policy.discountAppliesToRefundFee
      ? (minTickets * 40 + minTickets * fee) * (1 - pct)
      : minTickets * 40 * (1 - pct) + minTickets * fee;
    await check(
      items,
      "REQ-INTERACTION-DISCOUNT-AND-REFUND",
      `${minTickets} refundable $40 tickets total $${expected.toFixed(2)} under the approved policy`,
      () => near(calculateQuote({ ticketCount: minTickets, basePrice: 40, isRefundable: true }).total, expected, "total")
    );
  }

  await check(items, "REQ-RECEIPT-RECONCILES", "Itemized receipt (when present) sums to the quote total", () => {
    const q = calculateQuote({ ticketCount: 4, basePrice: 40, isRefundable: true });
    if (!q.receiptItems) return;
    const sum = q.receiptItems.reduce((acc, i) => acc + i.amount, 0);
    near(sum, q.total, "receipt sum vs total");
  });

  await check(items, "REQ-CATALOG-TO-CHECKOUT-DOLLARS", "Catalog price flows through checkout as $40.00 per ticket", async () => {
    const event = catalog.EVENT_CATALOG.find((e) => e.id === "cf-connect-2026");
    if (!event) throw new Error("cf-connect-2026 missing from catalog");
    const { App } = (await import(path.join(dir, "src", "App.tsx"))) as { App: () => unknown };
    const html = renderToStaticMarkup(createElement(App as never));
    if (!html.includes("Base price: $40.00 each")) {
      const shown = /Base price: \$([^<]*?) each/.exec(html.replace(/<!--.*?-->/g, ""));
      throw new Error(`Checkout shows base price "$${shown?.[1] ?? "?"}" instead of "$40.00" for the $40 event`);
    }
    if (pct !== undefined && minTickets !== undefined && fee !== undefined) {
      const expected = policy.discountAppliesToRefundFee
        ? (4 * 40 + 4 * fee) * (1 - pct)
        : 4 * 40 * (1 - pct) + 4 * fee;
      const total = /id="summary-total-price">\$([0-9.,]+)</.exec(html)?.[1];
      if (!total || Math.abs(parseFloat(total.replace(/,/g, "")) - expected) > 0.005) {
        throw new Error(`Checkout default total expected $${expected.toFixed(2)}, rendered $${total ?? "?"}`);
      }
    }
  });

  return items;
}
