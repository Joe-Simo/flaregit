import {expect, test} from "bun:test";
import {canPublish, visiblePackages, type PackageRecord} from "../src/core/package-visibility";

const pkgs: PackageRecord[] = [
  {name: "a", version: "1.0.0", private: false, ownerId: "org"},
  {name: "b", version: "1.0.0", private: true, ownerId: "org"},
];

test("private packages are hidden from outsiders and anonymous viewers", () => {
  expect(visiblePackages(pkgs, undefined, []).map((pkg) => pkg.name)).toEqual(["a"]);
  expect(visiblePackages(pkgs, "x", []).map((pkg) => pkg.name)).toEqual(["a"]);
  expect(visiblePackages(pkgs, "x", ["org"]).map((pkg) => pkg.name)).toEqual(["a", "b"]);
});

test("published versions are immutable", () => {
  expect(canPublish(pkgs, "a", "1.0.0")).toBe(false);
  expect(canPublish(pkgs, "a", "1.0.1")).toBe(true);
});
