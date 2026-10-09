import {expect, test} from "bun:test";
import {record} from "../src/core/usage-limits";

test("usage accumulates and flags the overage", () => {
  const first = record({used: 0, allowance: 10}, 8);
  expect(first.overLimit).toBe(false);
  const second = record(first.usage, 5);
  expect(second.usage.used).toBe(13);
  expect(second.overLimit).toBe(true);
});

test("invalid amounts are refused", () => {
  expect(() => record({used: 0, allowance: 1}, -1)).toThrow();
  expect(() => record({used: 0, allowance: 1}, Number.NaN)).toThrow();
});
