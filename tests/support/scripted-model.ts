/**
 * Test double for the external LLM only (Workers AI in production). Everything around it — Git,
 * isolation, verification, CAS publication — is real. The double answers the way a competent model
 * would for the fixture goals, so tests exercise the platform's deterministic control logic.
 */
const FILE = (prompt: string, p: string): string => {
  const m = new RegExp(`<current path="${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">\\n([\\s\\S]*?)\\n</current>`).exec(prompt);
  if (!m) throw new Error(`prompt lacks ${p}`);
  return m[1]!;
};
const out = (p: string, content: string) => `<file path="${p}">\n${content}\n</file>`;

export const DISCOUNT_ONLY = `import type { QuoteParams, QuoteResult } from "./types.js";

export function calculateQuote(params: QuoteParams): QuoteResult {
  const ticketCount = Math.max(1, params.ticketCount);
  const rawSubtotal = ticketCount * params.basePrice;
  const discountAmount = ticketCount >= 4 ? rawSubtotal * 0.15 : 0;
  const total = rawSubtotal - discountAmount;
  return {
    ticketCount,
    basePrice: params.basePrice,
    ticketTotal: rawSubtotal,
    discountAmount,
    refundFeeTotal: 0,
    total,
    isRefundable: false,
    breakdown: [String(ticketCount) + " tickets"],
  };
}`;

export const REFUND_ONLY = `import type { QuoteParams, QuoteResult } from "./types.js";

export function calculateQuote(params: QuoteParams): QuoteResult {
  const ticketCount = Math.max(1, params.ticketCount);
  const ticketTotal = ticketCount * params.basePrice;
  const isRefundable = Boolean(params.isRefundable);
  const refundFeeTotal = isRefundable ? ticketCount * 5 : 0;
  return {
    ticketCount,
    basePrice: params.basePrice,
    ticketTotal,
    discountAmount: 0,
    refundFeeTotal,
    total: ticketTotal + refundFeeTotal,
    isRefundable,
    breakdown: [String(ticketCount) + " tickets"],
  };
}`;

export function mergedPricing(discountAppliesToRefundFee: boolean): string {
  return `import type { QuoteParams, QuoteResult } from "./types.js";

export function calculateQuote(params: QuoteParams): QuoteResult {
  const ticketCount = Math.max(1, params.ticketCount);
  const rawSubtotal = ticketCount * params.basePrice;
  const isRefundable = Boolean(params.isRefundable);
  const refundBase = isRefundable ? ticketCount * 5 : 0;
  const rate = ticketCount >= 4 ? 0.15 : 0;
  const discountAmount = (rawSubtotal + ${discountAppliesToRefundFee ? "refundBase" : "0"}) * rate;
  const refundFeeTotal = ${discountAppliesToRefundFee ? "refundBase * (1 - rate)" : "refundBase"};
  const ticketTotal = ${discountAppliesToRefundFee ? "rawSubtotal * (1 - rate)" : "rawSubtotal - discountAmount"};
  const total = ticketTotal + refundFeeTotal;
  return {
    ticketCount,
    basePrice: params.basePrice,
    ticketTotal,
    discountAmount,
    refundFeeTotal,
    total,
    isRefundable,
    breakdown: [String(ticketCount) + " tickets"],
  };
}`;
}

export interface ScriptedModelOptions {
  /** Override behaviors to simulate misbehaving models. */
  repair?: (prompt: string) => string;
  agent?: (prompt: string) => string | undefined;
  repairCalls?: string[];
}

export function scriptedModel(opts: ScriptedModelOptions = {}) {
  return async (prompt: string): Promise<string> => {
    if (prompt.includes("integration repair engine")) {
      opts.repairCalls?.push(prompt);
      if (opts.repair) return opts.repair(prompt);
      if (prompt.includes("Git text conflict")) {
        return out("src/pricing.ts", mergedPricing(false));
      }
      // Behavior repair: make the checkout consume integer-cent catalog prices correctly.
      if (prompt.includes("Checkout shows base price")) {
        const app = FILE(prompt, "src/App.tsx").replace("basePrice: event.price,", "basePrice: event.price / 100,").replace("${event.price.toFixed(2)}", "${(event.price / 100).toFixed(2)}");
        return out("src/App.tsx", app);
      }
      // Policy change (decision): total expected 153 → discount applies to the refund fee.
      if (prompt.includes("REQ-INTERACTION-DISCOUNT-AND-REFUND")) {
        return out("src/pricing.ts", mergedPricing(prompt.includes("$153.00")));
      }
      return "I cannot help.";
    }
    const custom = opts.agent?.(prompt);
    if (custom !== undefined) return custom;
    if (prompt.includes("15% group discount")) return out("src/pricing.ts", DISCOUNT_ONLY);
    if (prompt.includes("refundable-ticket option")) return out("src/pricing.ts", REFUND_ONLY);
    if (prompt.includes("integer cents")) {
      const cat = FILE(prompt, "src/catalog.ts").replace(/price: 40,[^\n]*/, "price: 4000, // integer cents").replace(/price: 50,/, "price: 5000,");
      return out("src/catalog.ts", cat);
    }
    if (prompt.includes("itemized receiptItems")) {
      const p = FILE(prompt, "src/pricing.ts").replace(
        "  return {",
        `  const receiptItems = [
    { description: "Tickets", amount: rawSubtotal },
    ...(discountAmount > 0 ? [{ description: "Group discount", amount: -discountAmount }] : []),
    ...(refundFeeTotal > 0 ? [{ description: "Refund protection", amount: refundFeeTotal }] : []),
  ];
  return {
    receiptItems,`
      );
      return out("src/pricing.ts", p);
    }
    if (prompt.includes("discount also reduce the refundable surcharge") || prompt.includes("never discounted")) {
      return out("src/NOTES.md", "# Proposal recorded by the agent");
    }
    throw new Error("scripted model has no answer for this prompt");
  };
}
