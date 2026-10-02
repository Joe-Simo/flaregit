import { afterEach, describe, expect, test } from "bun:test";
import { lookupTxt, normalizeDomain, txtHost, txtValue } from "../src/server/dns.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const dns = (body: unknown, status = 200) => { globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch; };

describe("domain verification", () => {
  test("normalizes and rejects domains", () => {
    expect(normalizeDomain(" Example.COM. ")).toBe("example.com");
    for (const bad of ["localhost", "a b.com", "-x.com", "x..com", "example.com/path", "http://example.com", "1.2.3.4", ""]) expect(normalizeDomain(bad)).toBeNull();
  });
  test("builds the record the owner must publish", () => {
    expect(txtHost("example.com")).toBe("_flaregit.example.com");
    expect(txtValue("abc")).toBe("flaregit-site-verification=abc");
  });
  test("reads quoted and split TXT answers", async () => {
    dns({ Status: 0, Answer: [{ type: 16, data: '"flaregit-site-verification=abc"' }, { type: 16, data: '"flaregit-site-" "verification=def"' }, { type: 5, data: "cname." }] });
    expect(await lookupTxt("_flaregit.example.com")).toEqual(["flaregit-site-verification=abc", "flaregit-site-verification=def"]);
  });
  test("a missing record is an empty answer, a resolver failure is an error", async () => {
    dns({ Status: 3 });
    expect(await lookupTxt("_flaregit.nope.example")).toEqual([]);
    dns({ Status: 2 });
    await expect(lookupTxt("x.example")).rejects.toThrow();
    dns({}, 503);
    await expect(lookupTxt("x.example")).rejects.toThrow();
  });
});
