export function repositoryRequestSignal(lifetime: AbortSignal, mutation = false): AbortSignal {
  return AbortSignal.any([lifetime, AbortSignal.timeout(mutation ? 30_000 : 15_000)]);
}

/** Creation endpoint validation/authentication rejects before provider allocation. */
export function creationRejectedBeforeAllocation(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 422;
}
