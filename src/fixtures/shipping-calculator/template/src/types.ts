export type ShippingSpeed = "standard" | "express" | "overnight";

export interface ShippingParams {
  weightKg: number;
  speed: ShippingSpeed;
  isHazardous?: boolean;
  insuranceValueUsd?: number;
}

export interface ShippingReceiptItem {
  description: string;
  amount: number;
}

export interface ShippingQuote {
  baseRate: number;
  speedSurcharge: number;
  hazardousFee: number;
  insuranceFee: number;
  weightDiscount: number;
  total: number;
  estimatedDays: number;
  receiptItems?: ShippingReceiptItem[];
}
