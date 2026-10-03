import { expect, test } from "bun:test";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { workerdChild } from "./support/workerd-child";

test("retired shared-origin preview routes fail closed even with a valid legacy capability", async () => {
  if (await workerdChild("tests/preview-legacy-route.test.ts")) return;
  const output = `/tmp/flaregit-preview-legacy-${crypto.randomUUID()}.js`;
  const build = Bun.spawn([process.execPath, "build", "tests/support/preview-legacy-worker.ts", "--target=browser", "--external=cloudflare:workers", "--external=node:*", `--outfile=${output}`], { stdout: "ignore", stderr: "pipe" });
  let script: string;
  try {
    const [error, code] = await Promise.all([new Response(build.stderr).text(), build.exited]);
    if (code !== 0) throw new Error(error);
    script = await Bun.file(output).text();
  } finally { if (await Bun.file(output).exists()) await Bun.file(output).delete(); }
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: "preview-legacy", modules: true, script, compatibilityDate: "2026-10-02", compatibilityFlags: ["nodejs_compat"], unsafeDirectSockets: [{ host: "127.0.0.1" }] }] }));
  try {
    const base = await mf.unsafeGetDirectURL("preview-legacy");
    const credentials = await (await fetch(new URL("/fixture", base))).json() as { exp: number; sig: string };
    const route = `/preview/abcdef123456/${"a".repeat(40)}/`;
    for (const origin of ["https://preview.flaregit.com", "https://flaregit.com", "https://repo-a.account.workers.dev"]) {
      for (const asset of ["", "main.js", "assets/module.js"]) {
        const target = new URL(`${route}${asset}`, origin);
        target.searchParams.set("exp", String(credentials.exp));
        target.searchParams.set("sig", credentials.sig);
        const call = new URL("/check", base);
        call.searchParams.set("target", target.href);
        const response = await fetch(call, { headers: { Connection: "close", Cookie: `fgp=${credentials.exp}.${credentials.sig}` } });
        expect([404, 410, 503]).toContain(response.status);
        expect(response.headers.get("Set-Cookie")).toBeNull();
        expect(await response.text()).not.toContain("app asset fallback");
      }
    }
  } finally { await mf.dispose(); }
}, 30_000);
