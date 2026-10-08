import {expect, test} from "bun:test";
import {scanText} from "../src/core/security-alerts";

test("known secret shapes are found by line without echoing values", () => {
  const text = ["ok", "key=AKIAABCDEFGHIJKLMNOP", "-----BEGIN PRIVATE KEY-----"].join("\n");
  const findings = scanText(text);
  expect(findings).toEqual([{kind: "aws-access-key", line: 2}, {kind: "private-key", line: 3}]);
  expect(JSON.stringify(findings)).not.toContain("AKIAABCDEFGHIJKLMNOP");
});

test("clean text has no findings", () => {
  expect(scanText("const a = 1;\nconsole.log(a)")).toEqual([]);
});
