import type { QuoteParams, QuoteResult } from "./types.js";

/**
 * Baseline Quote Calculation
 * Initial policy: Calculates subtotal based on ticketCount and base price.
 */
export function calculateQuote(params: QuoteParams): QuoteResult {
  const ticketCount = Math.max(1, params.ticketCount);
  const basePrice = params.basePrice;
  const ticketTotal = ticketCount * basePrice;
  const discountAmount = 0;
  const refundFeeTotal = 0;
  const total = ticketTotal;

  return {
    ticketCount,
    basePrice,
    ticketTotal,
    discountAmount,
    refundFeeTotal,
    total,
    isRefundable: false,
    breakdown: [
      `${ticketCount} ticket${ticketCount > 1 ? "s" : ""} @ $${basePrice.toFixed(2)} = $${ticketTotal.toFixed(2)}`,
    ],
  };
}
