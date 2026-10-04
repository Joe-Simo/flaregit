import { expect, test } from "bun:test";
import { artifactStorageSlots } from "../src/server/storage-allocation";

test("public storage capacity uses the same validated allocation limit", () => {
  expect(artifactStorageSlots("32")).toBe(32);
  expect(artifactStorageSlots("0")).toBe(0);
  for (const value of [undefined, "", "-1", "1.5", "032", "9007199254740992"]) expect(artifactStorageSlots(value)).toBeNull();
});
