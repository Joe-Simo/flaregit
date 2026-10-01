import type { ShippingParams, ShippingQuote } from "./types.js";
import { DEFAULT_CARRIER_ZONE } from "./carriers.js";

/**
 * Baseline Shipping Quote Engine
 */
export function calculateShipping(params: ShippingParams): ShippingQuote {
  const weight = Math.max(0.5, params.weightKg);
  const baseRate = Math.max(DEFAULT_CARRIER_ZONE.minimumRate, weight * DEFAULT_CARRIER_ZONE.baseRatePerKg);

  let speedSurcharge = 0;
  let estimatedDays = 5;

  if (params.speed === "express") {
    speedSurcharge = baseRate * 0.5; // +50% for express
    estimatedDays = 2;
  } else if (params.speed === "overnight") {
    speedSurcharge = baseRate * 1.0; // +100% for overnight
    estimatedDays = 1;
  }

  const hazardousFee = params.isHazardous ? 12.0 : 0.0;
  const insuranceFee = params.insuranceValueUsd ? Math.max(5.0, params.insuranceValueUsd * 0.02) : 0.0;
  const weightDiscount = weight >= 20 ? baseRate * 0.15 : 0.0; // 15% discount for bulk freight >= 20kg

  const total = baseRate + speedSurcharge + hazardousFee + insuranceFee - weightDiscount;

  return {
    baseRate,
    speedSurcharge,
    hazardousFee,
    insuranceFee,
    weightDiscount,
    total: Math.round(total * 100) / 100,
    estimatedDays,
    receiptItems: [
      { description: `Base freight (${weight} kg)`, amount: baseRate },
      ...(speedSurcharge > 0 ? [{ description: `Speed tier: ${params.speed}`, amount: speedSurcharge }] : []),
      ...(hazardousFee > 0 ? [{ description: "Hazardous handling compliance fee", amount: hazardousFee }] : []),
      ...(insuranceFee > 0 ? [{ description: "Parcel loss guarantee protection", amount: insuranceFee }] : []),
      ...(weightDiscount > 0 ? [{ description: "Bulk weight tier discount (-15%)", amount: -weightDiscount }] : []),
    ],
  };
}
