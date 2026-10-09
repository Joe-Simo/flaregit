import {expect, test} from "bun:test";
import {append, firstBroken} from "../src/core/audit-log";

test("an intact chain verifies and edits or removals are located", async () => {
  let log = await append([], "a", "lock");
  log = await append(log, "b", "pin");
  log = await append(log, "c", "unlock");
  expect(await firstBroken(log)).toBe(-1);
  expect(await firstBroken([log[0]!, {...log[1]!, action: "tampered"}, log[2]!])).toBe(1);
  expect(await firstBroken([log[0]!, log[2]!])).toBe(1);
});
