/** F18 slice: usage metering against a plan allowance. Over-limit usage is reported, never silently dropped. */

export interface Usage {
  readonly used: number;
  readonly allowance: number;
}

export function record(usage: Usage, amount: number): {readonly usage: Usage; readonly overLimit: boolean} {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError("Usage must be a non-negative number");
  const next = {...usage, used: usage.used + amount};
  return {usage: next, overLimit: next.used > next.allowance};
}
