import {expect, test} from "bun:test";
import {matchAdvisories} from "../src/core/dependency-advisories";

const advisory = {id: "A1", package: "left-pad", vulnerable: ">=1.0.0 <1.2.3"};

test("versions inside the range are affected and boundaries are exact", () => {
  const report = matchAdvisories(
    [{name: "left-pad", version: "1.0.0"}, {name: "left-pad", version: "1.2.2"}, {name: "left-pad", version: "1.2.3"}, {name: "other", version: "1.1.0"}],
    [advisory],
  );
  expect(report.affected.map((item) => item.version)).toEqual(["1.0.0", "1.2.2"]);
  expect(report.unparseable).toEqual([]);
});

test("unparseable dependency versions and ranges are reported", () => {
  const report = matchAdvisories([{name: "left-pad", version: "^1.0.0"}], [advisory, {id: "A2", package: "x", vulnerable: "~1"}]);
  expect(report.affected).toEqual([]);
  expect(report.unparseable).toEqual([{subject: "advisory A2", value: "~1"}, {subject: "left-pad", value: "^1.0.0"}]);
});

test("exact and single-bound ranges work", () => {
  const report = matchAdvisories([{name: "p", version: "2.0.0"}], [{id: "B", package: "p", vulnerable: "2.0.0"}, {id: "C", package: "p", vulnerable: "<2.0.0"}]);
  expect(report.affected.map((item) => item.advisoryId)).toEqual(["B"]);
});
