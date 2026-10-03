export interface PreviewWorkerEnv {
  REPOSITORY_ID: string;
  ASSET_BROKER: Fetcher;
}

/** Untrusted builds receive only this stateless, repository-specific asset gateway. */
export default {
  async fetch(request: Request, env: PreviewWorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (!/^[a-z0-9]{12,16}$/.test(env.REPOSITORY_ID) || !/^\/preview\/[0-9a-f]{40}\/[0-9]+\/[0-9a-f]{64}\//.test(url.pathname)) {
      return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
    }
    // Never forward browser credentials, user-controlled binding identity, or client IP metadata.
    return env.ASSET_BROKER.fetch(new Request(url, {
      method: request.method,
      headers: { "x-preview-repository-id": env.REPOSITORY_ID },
      redirect: "manual",
    }));
  },
};
