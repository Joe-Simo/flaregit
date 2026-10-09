import {expect, test} from "bun:test";
import {publishRelease, type Release} from "../src/core/release-rules";

const digest = "a".repeat(64);
const base: Release = {tag: "v1.0.0", draft: false, assets: [{name: "app.zip", sha256: digest}]};

test("valid releases publish once per tag", () => {
  const first = publishRelease([], base);
  expect(first.ok).toBe(true);
  expect(publishRelease(first.ok ? first.releases : [], base).ok).toBe(false);
});

test("bad tags, duplicate assets and missing digests are refused", () => {
  expect(publishRelease([], {...base, tag: "latest"}).ok).toBe(false);
  expect(publishRelease([], {...base, assets: [base.assets[0]!, base.assets[0]!]}).ok).toBe(false);
  expect(publishRelease([], {...base, assets: [{name: "x", sha256: "bad"}]}).ok).toBe(false);
});
