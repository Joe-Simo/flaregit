import * as path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { quoteKey, type Params, type Quote, type TicketObservations } from "./checks.js";

/** Untrusted child reports behavior only. All pass/fail assertions run in the parent. */
export async function observe(dir: string, policy: Record<string, unknown>): Promise<TicketObservations> {
  const inputs: Params[] = [{ ticketCount: 1, basePrice: 40, isRefundable: false }, { ticketCount: 2, basePrice: 40, isRefundable: true }, { ticketCount: 4, basePrice: 40, isRefundable: true }];
  if (typeof policy.minTicketsForDiscount === "number") {
    inputs.push({ ticketCount: policy.minTicketsForDiscount, basePrice: 40, isRefundable: false }, { ticketCount: policy.minTicketsForDiscount - 1, basePrice: 40, isRefundable: false }, { ticketCount: policy.minTicketsForDiscount, basePrice: 40, isRefundable: true });
  }
  const pricing = await import(path.join(dir, "src/pricing.ts")) as { calculateQuote(params: Params): Quote };
  const catalog = await import(path.join(dir, "src/catalog.ts")) as { EVENT_CATALOG: Array<{ id: string }> };
  const { App } = await import(path.join(dir, "src/App.tsx")) as { App: () => unknown };
  const quotes: Record<string, Quote> = {};
  for (const input of inputs) quotes[quoteKey(input)] = pricing.calculateQuote(input);
  return { quotes, catalogExists: catalog.EVENT_CATALOG.some((event) => event.id === "cf-connect-2026"), html: renderToStaticMarkup(createElement(App as never)) };
}
