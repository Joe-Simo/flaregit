import {expect, test} from "bun:test";
import {missingAccessibleNames} from "../src/core/accessible-names";

test("elements without text or label are reported by index", () => {
  expect(missingAccessibleNames([{role: "button", text: "Save"}, {role: "button"}, {role: "link", ariaLabel: " "}, {role: "textbox", ariaLabel: "Title"}])).toEqual([1, 2]);
});
