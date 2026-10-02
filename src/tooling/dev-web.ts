import page from "../../index.html";
import type { BunRequest } from "bun";
import { resolve, sep } from "node:path";

const publicDirectory = resolve("public");

const backend = new URL(process.env.FLAREGIT_API ?? "http://127.0.0.1:8787");
if (!["http:", "https:"].includes(backend.protocol)) throw new Error("FLAREGIT_API must be an HTTP(S) URL");
if (backend.username || backend.password || backend.search || backend.hash) throw new Error("FLAREGIT_API must not contain credentials, query parameters, or a fragment");
if (backend.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(backend.hostname)) throw new Error("Remote FLAREGIT_API targets must use HTTPS before authentication is forwarded");
const proxy = async (request: BunRequest) => {
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const name of ["host", "connection", "transfer-encoding", "content-length"]) headers.delete(name);
  try {
    return await fetch(new URL(url.pathname + url.search, backend), { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body, redirect: "manual" });
  } catch {
    return new Response("The FlareGit Worker could not be reached. Start wrangler dev or set FLAREGIT_API.", { status: 502 });
  }
};
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 5173),
  development: { hmr: true, console: false },
  routes: {
    "/": page,
    "/diff.worker.js": async () => {
      const result = await Bun.build({ entrypoints: ["./src/web/diff.worker.ts"], target: "browser", env: "disable" });
      if (!result.success || !result.outputs[0]) return new Response("Could not compile the diff worker", { status: 500 });
      return new Response(result.outputs[0], { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" } });
    },
    "/api/*": proxy,
    "/auth-config": proxy,
    "/pricing": proxy,
    "/status.json": proxy,
    "/status": proxy,
    "/terms": proxy,
    "/privacy": proxy,
    "/webhooks/*": proxy,
  },
  async fetch(request) {
    const path = resolve(publicDirectory, `.${new URL(request.url).pathname}`);
    if (!path.startsWith(publicDirectory + sep)) return new Response("Not found", { status: 404 });
    const file = Bun.file(path);
    return await file.exists() ? new Response(file) : new Response("Not found", { status: 404 });
  },
});
console.log(`FlareGit frontend: ${server.url}`);
