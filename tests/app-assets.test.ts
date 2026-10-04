import { expect, test } from "bun:test";
import { appAssetResponse } from "../src/server/app-assets";
test("missing entry and worker scripts cannot receive SPA HTML", async () => {
  for (const path of ["/assets/index-old.js", "/diff.worker.js"]) {
    const response = await appAssetResponse(new Request(`https://flaregit.com${path}`), { fetch: async () => new Response("<html>shell</html>", { headers: { "Content-Type": "text/html" } }) });
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
  }
});
test("HTML shell cannot be stored while valid scripts retain asset caching", async () => {
  for (const [path, type, cache] of [["/", "text/html", "no-store"], ["/assets/current.js", "application/javascript", "public,max-age=3600"]]) {
    const response = await appAssetResponse(new Request(`https://flaregit.com${path}`), { fetch: async () => new Response("content", { headers: { "Content-Type": type!, "Cache-Control": "public,max-age=3600" } }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(cache!);
    expect(await response.text()).toBe("content");
  }
});
test("only HTML navigation receives the explicit shell, never missing assets", async () => {
  const paths: string[] = [];
  const assets = { fetch: async (request: Request) => { const path = new URL(request.url).pathname; paths.push(path); return path === "/index.html" ? new Response("shell", { headers: { "Content-Type": "text/html" } }) : new Response(null, { status: 404 }); } };
  const navigation = await appAssetResponse(new Request("https://flaregit.com/docs", { headers: { Accept: "text/html" } }), assets);
  expect(await navigation.text()).toBe("shell");
  expect(paths).toEqual(["/docs", "/index.html"]);
  paths.length = 0;
  const missing = await appAssetResponse(new Request("https://flaregit.com/assets/old.js", { headers: { Accept: "text/html" } }), assets);
  expect(missing.status).toBe(404);
  expect(paths).toEqual(["/assets/old.js"]);
});
