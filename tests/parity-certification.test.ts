import {expect, test} from "bun:test";
import {certify} from "../src/core/parity-certification";

test("tickets without evidence are gaps", () => {
  expect(certify([{id: "F01", evidence: ["receipt"]}, {id: "F02", evidence: []}])).toEqual({complete: false, gaps: ["F02"]});
  expect(certify([{id: "F01", evidence: ["receipt"]}])).toEqual({complete: true, gaps: []});
});
