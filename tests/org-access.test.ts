import {expect, test} from "bun:test";
import {can, effectiveRole, removeMember} from "../src/core/org-access";

const members = [{id: "boss", owner: true}, {id: "dev", owner: false}];

test("the highest grant wins and owners are admin", () => {
  const grants = [{subject: "dev", role: "read" as const}, {subject: "core", role: "write" as const}];
  expect(effectiveRole("dev", members, grants, ["core"])).toBe("write");
  expect(effectiveRole("dev", members, grants, [])).toBe("read");
  expect(effectiveRole("boss", members, [], [])).toBe("admin");
  expect(effectiveRole("stranger", members, grants, [])).toBe("none");
});

test("role comparison", () => {
  expect(can("write", "triage")).toBe(true);
  expect(can("read", "write")).toBe(false);
});

test("the last owner cannot be removed", () => {
  expect(removeMember(members, "boss").ok).toBe(false);
  expect(removeMember(members, "dev").ok).toBe(true);
  expect(removeMember(members, "ghost").ok).toBe(false);
});
