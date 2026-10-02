import * as path from "node:path";
import { quoteKey, type Params, type Quote } from "./checks.js";

export async function observe(dir: string): Promise<Record<string, Quote>> {
  const inputs: Params[] = [{ weightKg: 2, speed: "standard" }, { weightKg: 10, speed: "standard" }, { weightKg: 10, speed: "express" }, { weightKg: 10, speed: "express", isHazardous: true }, { weightKg: 25, speed: "standard" }];
  const { calculateShipping } = await import(path.join(dir, "src/rates.ts")) as { calculateShipping(params: Params): Quote };
  const quotes: Record<string, Quote> = {};
  for (const input of inputs) quotes[quoteKey(input)] = calculateShipping(input);
  return quotes;
}
