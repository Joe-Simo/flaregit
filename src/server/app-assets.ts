/** SPA fallback must never masquerade as a JavaScript, CSS or font response. */
export async function appAssetResponse(request: Request, assets: { fetch(request: Request): Promise<Response> }): Promise<Response> {
  let response = await assets.fetch(request);
  const requestedPath = new URL(request.url).pathname;
  if (response.status === 404 && ["GET", "HEAD"].includes(request.method) && request.headers.get("Accept")?.includes("text/html") && !requestedPath.startsWith("/assets/") && !/\.[^/]+$/.test(requestedPath)) {
    await response.body?.cancel();
    response = await assets.fetch(new Request(new URL("/index.html", request.url), request));
  }
  const html = response.headers.get("Content-Type")?.toLowerCase().includes("text/html");
  const path = new URL(request.url).pathname;
  if (html && (path.startsWith("/assets/") || path === "/diff.worker.js")) {
    await response.body?.cancel();
    return new Response(request.method === "HEAD" ? null : "Application asset unavailable. Reload to get the current application.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  if (html) headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
