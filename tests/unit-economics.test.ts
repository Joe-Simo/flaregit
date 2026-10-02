import { expect, test } from "bun:test";
import { calculateAdmissionExposure, calculateUnitEconomics, DEFAULT_ECONOMICS_INPUTS } from "../src/tooling/unit-economics.js";

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

test("admission sensitivity exposes multi-call cost without claiming a spending ceiling", () => {
  const result = calculateAdmissionExposure({ callsPerAdmission: 20, inputTokensPerCall: 20000, outputTokensPerCall: 8192,
    admissionsPerDay: 300, days: 30, containerSecondsPerAdmission: 600, activeCpuSecondsPerAdmission: 600 });
  expect(result.admissions).toBe(9000);
  expect(result.modelPerRun).toBe(0.26288);
  expect(result.totalRuns).toBe(2559.456);
  expect(result.isEnforcedSpendCeiling).toBeFalse();
  expect(() => calculateAdmissionExposure({ ...result.assumptions, admissionsPerDay: -1 })).toThrow();
});

test("proposed three-dollar Team target requires aggregate billing and still fails base margin", () => {
  const monthly = calculateUnitEconomics({ ...DEFAULT_ECONOMICS_INPUTS, seatPrice: 3 });
  expect(monthly.scenarios.map((s) => s.contribution)).toEqual([1.75, 0.65, -2.05]);
  expect(monthly.scenarios[1]!.breakEvenSeats).toBe(6154);
  const aggregate = calculateUnitEconomics({ ...DEFAULT_ECONOMICS_INPUTS, seatPrice: 3, seatsPerInvoice: 5 });
  expect(aggregate.scenarios[1]!.breakEvenSeats).toBe(3810);
});
