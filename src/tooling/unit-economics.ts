import { z } from "zod";

const nonnegative = z.number().finite().nonnegative();
const inputsSchema = z.object({
  seatPrice: nonnegative, seatsPerInvoice: z.number().int().positive(),
  paymentPercent: z.number().finite().min(0).max(1), paymentFixed: nonnegative, paymentAdditionalPerSeat: nonnegative,
  fixedMonthly: nonnegative, freeUsers: nonnegative, freeUserCost: nonnegative,
  artifactStorageRate: nonnegative, artifactOperationRate: nonnegative,
  memoryGiB: nonnegative, diskGB: nonnegative, activeVcpu: nonnegative,
  memorySecondRate: nonnegative, diskSecondRate: nonnegative, cpuSecondRate: nonnegative,
  inputTokens: nonnegative, outputTokens: nonnegative, modelInputMillionRate: nonnegative, modelOutputMillionRate: nonnegative,
  containerSecondsPerRun: nonnegative, activeCpuSecondsPerRun: nonnegative, runs: nonnegative,
  scenarios: z.array(z.object({ name: z.string(), artifactGBMonth: nonnegative, artifactOperations: nonnegative, otherInfrastructure: nonnegative, support: nonnegative })).min(1),
}).strict();
export type EconomicsInputs = z.infer<typeof inputsSchema>;

/** Published unit rates plus explicitly hypothetical usage; no production metrics or free allowances. */
export const DEFAULT_ECONOMICS_INPUTS: EconomicsInputs = {
  seatPrice: 4, seatsPerInvoice: 1, paymentPercent: 0.05, paymentFixed: 0.50, paymentAdditionalPerSeat: 0,
  fixedMonthly: 3000, freeUsers: 10000, freeUserCost: 0.10,
  artifactStorageRate: 0.50, artifactOperationRate: 0.00015,
  memoryGiB: 6, diskGB: 12, activeVcpu: 1, memorySecondRate: 0.0000025, diskSecondRate: 0.00000007, cpuSecondRate: 0.000020,
  inputTokens: 20000, outputTokens: 5000, modelInputMillionRate: 0.35, modelOutputMillionRate: 0.75,
  containerSecondsPerRun: 600, activeCpuSecondsPerRun: 600, runs: 100,
  scenarios: [
    { name: "light", artifactGBMonth: 0.25, artifactOperations: 500, otherInfrastructure: 0.15, support: 0.25 },
    { name: "base", artifactGBMonth: 1, artifactOperations: 3000, otherInfrastructure: 0.25, support: 0.50 },
    { name: "heavy", artifactGBMonth: 3, artifactOperations: 10000, otherInfrastructure: 0.40, support: 1 },
  ],
};

export function calculateUnitEconomics(raw: EconomicsInputs) {
  const input = inputsSchema.parse(raw);
  const round = (value: number) => Math.round(value * 1e9) / 1e9;
  const paymentPerSeat = input.seatPrice * input.paymentPercent + input.paymentFixed / input.seatsPerInvoice + input.paymentAdditionalPerSeat;
  const fixedAndFree = input.fixedMonthly + input.freeUsers * input.freeUserCost;
  const memoryDiskPerSecond = input.memoryGiB * input.memorySecondRate + input.diskGB * input.diskSecondRate;
  const activePerSecond = memoryDiskPerSecond + input.activeVcpu * input.cpuSecondRate;
  const containerPerRun = input.containerSecondsPerRun * memoryDiskPerSecond + input.activeCpuSecondsPerRun * input.activeVcpu * input.cpuSecondRate;
  const modelPerRun = (input.inputTokens * input.modelInputMillionRate + input.outputTokens * input.modelOutputMillionRate) / 1_000_000;
  return {
    assumptions: input,
    exclusions: ["shared allowances", "payout fees unless input as paymentAdditionalPerSeat", "international/tax-inclusive fee uplift", "refund/dispute reserves", "regional egress", "platform retry overhead", "unmeasured model reasoning token usage"],
    scenarios: input.scenarios.map((scenario) => {
      const storageAndOperations = scenario.artifactGBMonth * input.artifactStorageRate + scenario.artifactOperations * input.artifactOperationRate;
      const variableCost = storageAndOperations + scenario.otherInfrastructure + scenario.support + paymentPerSeat;
      const contribution = input.seatPrice - variableCost;
      return { name: scenario.name, storageAndOperations: round(storageAndOperations), paymentPerSeat: round(paymentPerSeat), variableCost: round(variableCost), contribution: round(contribution), breakEvenSeats: contribution > 0 ? Math.ceil(fixedAndFree / contribution) : null };
    }),
    containers: { tenActiveMinutes: round(activePerSecond * 600), activeHour: round(activePerSecond * 3600), idleHour: round(memoryDiskPerSecond * 3600), activeDay: round(activePerSecond * 86400) },
    managed: { containerPerRun: round(containerPerRun), modelPerRun: round(modelPerRun), totalPerRun: round(containerPerRun + modelPerRun), totalRuns: round(input.runs * (containerPerRun + modelPerRun)) },
  };
}

if (import.meta.main) {
  const raw: unknown = process.argv[2] ? await Bun.file(process.argv[2]!).json() : DEFAULT_ECONOMICS_INPUTS;
  console.log(JSON.stringify(calculateUnitEconomics(inputsSchema.parse(raw)), null, 2));
}
