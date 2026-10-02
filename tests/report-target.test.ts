import { expect, test } from "bun:test";
import { safeReportTarget } from "../src/web/report-target";
import { safeSignInReturn } from "../src/web/sign-in-return";
const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
test("report context survives sign-in only as validated internal references", () => {
 for (const target of [`/community#repo=pabcdef012345&topic=discussion_${id}&entry=discussion_${id}`, `/#/p/pabcdef012345/discussions?topic=discussion_${id}&entry=discussion_${id}`, `/community#view=help&topic=forum_${id}&entry=forum_${id}`, "/#/profile/joseph"]) {
  expect(safeReportTarget(target)).toBe(target);
  expect(safeSignInReturn(`/report?target=${encodeURIComponent(target)}&signin=1`)).toBe(`/report?target=${encodeURIComponent(target).replaceAll('%20','+')}`);
 }
});
test("external targets and credential-shaped or extra query intent are rejected", () => {
 for (const target of ["https://evil.example", "//evil.example", "/#/profile/joseph?token=secret", `/community#repo=pabcdef012345&topic=discussion_${id}&entry=discussion_${id}&token=secret`, "/community#repo=x", "/%2f%2fevil", "/#/profile/../operator"]) {
  expect(safeReportTarget(target)).toBeNull(); expect(safeSignInReturn(`/report?target=${encodeURIComponent(target)}&signin=1`)).toBeNull();
 }
 expect(safeSignInReturn("/report?redirect_url=https://evil.example")).toBeNull();
 expect(safeSignInReturn("/report?kind=admin")).toBeNull();
 expect(safeSignInReturn("/report?target=%2F%23%2Fprofile%2Fjoseph&target=%2F%23%2Fprofile%2Fother")).toBeNull();
});
