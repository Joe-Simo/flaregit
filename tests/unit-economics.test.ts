import { expect, test } from "bun:test";
import { calculateUnitEconomics, DEFAULT_ECONOMICS_INPUTS } from "../src/tooling/unit-economics.js";

test("published rates and explicit hypothetical inputs reproduce documented economics", () => {
  const result = calculateUnitEconomics(DEFAULT_ECONOMICS_INPUTS);
  expect(result.scenarios.map((scenario) => scenario.contribution)).toEqual([2.7, 1.6, -1.1]);
  expect(result.scenarios[1]!.breakEvenSeats).toBe(2500);
  expect(result.scenarios[2]!.breakEvenSeats).toBeNull();
  expect(result.containers).toEqual({ tenActiveMinutes: 0.021504, activeHour: 0.129024, idleHour: 0.057024, activeDay: 3.096576 });
  expect(result.managed.totalRuns).toBe(3.2254);
  const aggregated = calculateUnitEconomics({ ...DEFAULT_ECONOMICS_INPUTS, seatsPerInvoice: 5 });
  expect(aggregated.scenarios[1]!.breakEvenSeats).toBe(2000);
});
test("usage inputs reject invalid values and additional billing costs reduce margin", () => {
  expect(() => calculateUnitEconomics({ ...DEFAULT_ECONOMICS_INPUTS, freeUsers: -1 })).toThrow();
  expect(() => calculateUnitEconomics({ ...DEFAULT_ECONOMICS_INPUTS, paymentPercent: Infinity })).toThrow();
  const additional = calculateUnitEconomics({ ...DEFAULT_ECONOMICS_INPUTS, paymentAdditionalPerSeat: 0.25 });
  expect(additional.scenarios[1]!.contribution).toBe(1.35);
});
