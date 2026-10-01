import React, { useState } from "react";
import { calculateShipping } from "./rates.js";
import type { ShippingQuote, ShippingSpeed } from "./types.js";

export function App() {
  const [weightKg, setWeightKg] = useState<number>(5);
  const [speed, setSpeed] = useState<ShippingSpeed>("standard");
  const [isHazardous, setIsHazardous] = useState<boolean>(false);
  const [insuranceValueUsd] = useState<number>(0);

  const quote: ShippingQuote = calculateShipping({
    weightKg,
    speed,
    isHazardous,
    insuranceValueUsd: insuranceValueUsd > 0 ? insuranceValueUsd : undefined,
  });

  return (
    <div style={{ padding: "24px", maxWidth: "600px", margin: "0 auto", fontFamily: "sans-serif" }}>
      <h1>Freight & Shipping Estimator</h1>
      <p>Second Repository Fixture for FlareGit Agnostic Verification</p>

      <div style={{ marginBottom: "16px" }}>
        <label>Weight (kg): </label>
        <input
          id="shipping-weight-input"
          type="number"
          min="1"
          max="100"
          value={weightKg}
          onChange={(e) => setWeightKg(parseFloat(e.target.value) || 1)}
        />
      </div>

      <div style={{ marginBottom: "16px" }}>
        <label>Speed: </label>
        <select
          id="shipping-speed-select"
          value={speed}
          onChange={(e) => setSpeed(e.target.value as ShippingSpeed)}
        >
          <option value="standard">Standard (5 days)</option>
          <option value="express">Express (2 days)</option>
          <option value="overnight">Overnight (1 day)</option>
        </select>
      </div>

      <div style={{ marginBottom: "16px" }}>
        <label>
          <input
            id="shipping-hazardous-checkbox"
            type="checkbox"
            checked={isHazardous}
            onChange={(e) => setIsHazardous(e.target.checked)}
          />
          Hazardous Material Handling
        </label>
      </div>

      <div style={{ background: "#f1f5f9", padding: "16px", borderRadius: "8px" }}>
        <h3>Quote Summary</h3>
        <p>Base Rate: ${quote.baseRate.toFixed(2)}</p>
        <p>Speed Surcharge: ${quote.speedSurcharge.toFixed(2)}</p>
        <p>Hazardous Fee: ${quote.hazardousFee.toFixed(2)}</p>
        <p>Bulk Discount: -${quote.weightDiscount.toFixed(2)}</p>
        <hr />
        <h2 id="shipping-total-price">Total: ${quote.total.toFixed(2)}</h2>
      </div>
    </div>
  );
}
