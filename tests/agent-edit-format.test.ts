import { expect, test } from "bun:test";
import { applyAgentEdits, EditRejectedError, parseAgentResponse } from "../src/agents/edit-format";

const answer = `<plan>
- Guard empty carts
- Add a helper
</plan>
<edit path="src/cart.ts">
<search>
  return total;
</search>
<replace>
  return items.length ? total : 0;
</replace>
<search>
export const VERSION = 1;
</search>
<replace>
export const VERSION = 2;
</replace>
</edit>
<create path="src/helper.ts">
export const helper = () => 1;
</create>
<reasoning>Empty carts returned NaN.</reasoning>`;
const cart = "export const VERSION = 1;\nexport function total(items: number[]) {\n  const total = items.reduce((a, b) => a + b, 0) / items.length;\n  return total;\n}\n";

test("parses plan, reasoning, multi-hunk edits and new files", () => {
  const parsed = parseAgentResponse(answer);
  expect(parsed.plan).toEqual(["Guard empty carts", "Add a helper"]);
  expect(parsed.reasoning).toBe("Empty carts returned NaN.");
  expect(parsed.edits).toHaveLength(2);
  expect(parsed.edits[0]).toMatchObject({ kind: "replace", path: "src/cart.ts" });
  expect(parsed.edits[0]!.kind === "replace" && parsed.edits[0]!.replacements).toHaveLength(2);
  expect(parsed.edits[1]).toEqual({ kind: "create", path: "src/helper.ts", content: "export const helper = () => 1;" });
});

test("applies validated hunks against the current file only", () => {
  const changed = applyAgentEdits({ "src/cart.ts": cart }, parseAgentResponse(answer).edits);
  expect(changed["src/cart.ts"]).toContain("return items.length ? total : 0;");
  expect(changed["src/cart.ts"]).toContain("VERSION = 2");
  expect(changed["src/helper.ts"]).toBe("export const helper = () => 1;\n");
});

test("rejects stale, ambiguous, unseen and recreated files without partial results", () => {
  const edit = (search: string) => [{ kind: "replace" as const, path: "src/cart.ts", replacements: [{ search, replace: "x" }] }];
  expect(() => applyAgentEdits({ "src/cart.ts": cart }, edit("not in the file"))).toThrow(EditRejectedError);
  expect(() => applyAgentEdits({ "src/cart.ts": cart }, edit("total"))).toThrow(/more than once/);
  expect(() => applyAgentEdits({}, edit("return total;"))).toThrow(/not one of the files/);
  expect(() => applyAgentEdits({ "src/cart.ts": cart }, [{ kind: "create", path: "src/cart.ts", content: "new" }])).toThrow(/already exists/);
  const replacementWithDollar = applyAgentEdits({ "a.ts": "x = 1;\n" }, [{ kind: "replace", path: "a.ts", replacements: [{ search: "1", replace: "'$&$1'" }] }]);
  expect(replacementWithDollar["a.ts"]).toBe("x = '$&$1';\n");
});

test("refuses duplicated paths and edit blocks without hunks; tolerates answers with no edits", () => {
  expect(() => parseAgentResponse(`<edit path="a.ts">\n<search>\na\n</search>\n<replace>\nb\n</replace>\n</edit>\n<edit path="a.ts">\n<search>\nc\n</search>\n<replace>\nd\n</replace>\n</edit>`)).toThrow(/more than once/);
  expect(() => parseAgentResponse(`<edit path="a.ts">\nwhole file\n</edit>`)).toThrow(/no <search>/);
  expect(parseAgentResponse("<think>hidden</think>I could not find anything to change.").edits).toEqual([]);
});
