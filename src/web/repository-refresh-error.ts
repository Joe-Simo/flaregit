import { ApiError,StaleRepositoryReadError } from "./api";
import { repositoryDeletionNotice } from "./repository-deletion-notice";
/** Only our local mutation-invalidation sentinel can retain the mounted private view. */
export function repositoryRefreshFailure(cause:unknown):"superseded"|"access"|"unavailable"{
  if(cause instanceof StaleRepositoryReadError)return "superseded";
  if(cause instanceof ApiError&&[401,403,404].includes(cause.status))return "access";
  if((cause instanceof Error||cause instanceof DOMException)&&(cause.name==="AbortError"||repositoryDeletionNotice(cause.message)!==null))return "access";
  return "unavailable";
}
