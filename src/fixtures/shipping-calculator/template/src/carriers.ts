export interface CarrierZone {
  id: string;
  name: string;
  baseRatePerKg: number; // in dollars
  minimumRate: number;
}

export const DEFAULT_CARRIER_ZONE: CarrierZone = {
  id: "zone-continental-us",
  name: "Continental US Delivery",
  baseRatePerKg: 3.0, // $3.00 per kg
  minimumRate: 15.0,  // minimum $15.00
};
