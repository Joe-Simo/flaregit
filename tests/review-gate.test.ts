import { expect, test } from "bun:test";
import { blocksExternalAcceptance } from "../src/web/review-gate";
const available = { known: true, readFailed: false, identityMismatch: false, gate: "passed" as const, retryingRequired: false };
test("optional external reporting failure never gates native acceptance", () => {
  expect(blocksExternalAcceptance({ ...available, required: false, known: false, readFailed: true, gate: "pending" })).toBe(false);
  expect(blocksExternalAcceptance({ ...available, required: false, gate: "failed" })).toBe(false);
});
test("required checks fail closed for unknown, failed, pending and retrying evidence", () => {
  for (const change of [{ known: false }, { readFailed: true }, { gate: "pending" as const }, { gate: "failed" as const }, { retryingRequired: true }]) expect(blocksExternalAcceptance({ ...available, required: true, ...change })).toBe(true);
  expect(blocksExternalAcceptance({ ...available, required: true })).toBe(false);
});
test("mismatched evidence always blocks even when checks are optional", () => {
  expect(blocksExternalAcceptance({ ...available, required: false, identityMismatch: true })).toBe(true);
});
