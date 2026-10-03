import child, { type PreviewWorkerEnv } from "../../src/server/preview-worker";
export default {
  fetch(request: Request, env: PreviewWorkerEnv) {
    const target = new URL(request.url).searchParams.get("target");
    if (!target) return new Response("Missing fixture target", { status: 400 });
    return child.fetch(new Request(target, { method: request.method, headers: request.headers }), env);
  },
};
