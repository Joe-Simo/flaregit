/** Native Git Smart HTTP transport. Authorization and durable admission precede this layer. */
export type GitService = "git-upload-pack" | "git-receive-pack";
export interface GitHttpRoute { projectId: string; taskId: string | null; endpoint: "info/refs" | GitService; service: GitService; write: boolean }
export function parseGitHttpRoute(request: Request): GitHttpRoute | null {
  const url = new URL(request.url);
  const match = /^\/git\/([a-zA-Z0-9_-]+)\/(canonical|tasks\/([a-z0-9-]{3,41}))\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(url.pathname);
  if (!match) return null;
  const endpoint = match[4] as GitHttpRoute["endpoint"];
  const service = endpoint === "info/refs" ? url.searchParams.get("service") : endpoint;
  if (service !== "git-upload-pack" && service !== "git-receive-pack") throw new Error("Invalid Git service");
  if (endpoint === "info/refs" ? request.method !== "GET" || url.search !== `?service=${service}` : request.method !== "POST" || !!url.search) throw new Error("Invalid Git request");
  if (request.headers.has("Content-Encoding") || request.headers.has("X-HTTP-Method-Override")) throw new Error("Invalid Git request");
  if (endpoint !== "info/refs" && request.headers.get("Content-Type") !== `application/x-${service}-request`) throw new Error("Invalid Git content type");
  const protocol = request.headers.get("Git-Protocol");
  if (protocol && protocol !== "version=2" && protocol !== "version=1") throw new Error("Unsupported Git protocol");
  return { projectId: match[1]!, taskId: match[3] ?? null, endpoint, service, write: service === "git-receive-pack" };
}
export function gitHttpCredential(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  if (header.length > 4096) return null;
  const bearer = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header);
  if (bearer) return bearer[1]!;
  const basic = /^Basic ([A-Za-z0-9+/=]+)$/.exec(header);
  if (!basic) return null;
  try { const decoded = atob(basic[1]!); const colon = decoded.indexOf(":"); const token = decoded.slice(colon + 1); return colon > 0 && /^[A-Za-z0-9_-]+$/.test(token) ? token : null; } catch { return null; }
}
export interface GitHttpProxyOptions {
  remote: string; providerToken: string; providerOrigin: string; writeAllowed: boolean;
  maxRequestBytes: number; maxResponseBytes: number; timeoutMs: number;
  fetcher?: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>;
  /** Called on completion, cancellation, or failure; never receives provider response text. */
  finish: () => Promise<void>;
  /** Header fences are unconditional; chunk fences may apply a bounded window. */
  authorize?: (phase:"dispatch"|"response"|"chunk",bytes:number)=>Promise<boolean>;
}
export async function proxyGitHttp(request: Request, route: GitHttpRoute, options: GitHttpProxyOptions): Promise<Response> {
  const remote = new URL(options.remote);
  if (remote.protocol !== "https:" || remote.origin !== options.providerOrigin || remote.username || remote.password || remote.search || remote.hash || /%|\/\//.test(remote.pathname)) throw new Error("Unsafe Git provider remote");
  if (route.write && (!options.writeAllowed || route.taskId === null)) { await options.finish(); return new Response("Git writes are not permitted", { status: 403 }); }
  for (const limit of [options.maxRequestBytes, options.maxResponseBytes, options.timeoutMs]) if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Invalid Git transport limit");
  const abort = new AbortController();
  let finished = false;
  const finish = async () => { if (finished) return; finished = true; clearTimeout(timer); request.signal.removeEventListener("abort", cancel); abort.abort(); await options.finish(); };
  const cancel = () => { abort.abort(); void finish().catch(() => {}); };
  const timer = setTimeout(cancel, options.timeoutMs);
  request.signal.addEventListener("abort", cancel, { once: true });
  const bounded = (stream: ReadableStream<Uint8Array>, max: number, checkAuthority=false) => {
    let bytes = 0;
    return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ async transform(chunk, controller) { bytes += chunk.byteLength; if (bytes > max) { abort.abort(); throw new Error("Git transfer limit exceeded"); } for(let offset=0;offset<chunk.byteLength;offset+=65_536){const part=chunk.subarray(offset,Math.min(offset+65_536,chunk.byteLength));if(checkAuthority&&!await authorized("chunk",part.byteLength)){abort.abort();throw new Error("Git authority revoked");}controller.enqueue(part);} } }));
  };
  const authorized=(phase:"dispatch"|"response"|"chunk",bytes=0)=>options.authorize?.(phase,bytes)??Promise.resolve(true);
  try {
    if(request.signal.aborted){await finish();return new Response("Git request was cancelled",{status:499});}
    const length = request.headers.get("Content-Length");
    if (length && (!/^\d+$/.test(length) || Number(length) > options.maxRequestBytes)) { await finish(); return new Response("Git transfer limit exceeded", { status: 413 }); }
    const target = `${remote.href.replace(/\/$/, "")}/${route.endpoint}${route.endpoint === "info/refs" ? `?service=${route.service}` : ""}`;
    const headers = new Headers({ Authorization: `Bearer ${options.providerToken}`, Accept: `application/x-${route.service}-${route.endpoint === "info/refs" ? "advertisement" : "result"}` });
    if (route.endpoint !== "info/refs") headers.set("Content-Type", `application/x-${route.service}-request`);
    const protocol = request.headers.get("Git-Protocol"); if (protocol) headers.set("Git-Protocol", protocol);
    if(!await authorized("dispatch")){await finish();return new Response("Git access changed; request was not forwarded",{status:403});}
    const upstream = await (options.fetcher ?? fetch)(target, { method: request.method, headers, body: request.body ? bounded(request.body, options.maxRequestBytes,true) : null, redirect: "manual", signal: abort.signal });
    const type = `application/x-${route.service}-${route.endpoint === "info/refs" ? "advertisement" : "result"}`;
    if (upstream.status !== 200 || upstream.headers.get("Content-Type")?.split(";")[0] !== type || !upstream.body) { await upstream.body?.cancel(); await finish(); return new Response("Git provider unavailable; retry the operation", { status: 502 }); }
    if(!await authorized("response")){await upstream.body.cancel();await finish();return new Response("Git access changed; response was withheld",{status:403});}
    const reader = bounded(upstream.body, options.maxResponseBytes).getReader();
    let pending:Uint8Array|undefined,offset=0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) { try {
        if(!pending||offset===pending.byteLength){const next=await reader.read();if(next.done){await finish();controller.close();return;}pending=next.value;offset=0;}
        const part=pending.subarray(offset,Math.min(offset+65_536,pending.byteLength));
        if(!await authorized("chunk",part.byteLength)){await reader.cancel().catch(()=>{});throw new Error("Git authority revoked");}
        offset+=part.byteLength;controller.enqueue(part);
      } catch { await finish().catch(() => {}); controller.error(new Error("Git transfer interrupted; inspect remote refs before retrying")); } },
      async cancel() { await reader.cancel().catch(() => {}); await finish(); },
    });
    return new Response(body, { headers: { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { await finish().catch(() => {}); return new Response("Git provider unavailable; inspect remote refs before retrying", { status: 502 }); }
}
