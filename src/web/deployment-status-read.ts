/** Bound session acquisition as well as network/body reads; abort alone cannot bound token retrieval. */
export async function deploymentStatusRead<T>(read: (signal: AbortSignal) => Promise<T>, deadlineMs = 15_000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException("Deployment status read timed out. Refresh to retry.", "TimeoutError");
      controller.abort(error);
      reject(error);
    }, deadlineMs);
  });
  try { return await Promise.race([read(controller.signal), timeout]); }
  finally { clearTimeout(timer); }
}
