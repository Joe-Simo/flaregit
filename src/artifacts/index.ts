import type { ArtifactsClient } from "./types.js";
import { LocalGitArtifactsClient } from "./local-git.js";
import { CloudflareArtifactsClient } from "./cloudflare.js";

export * from "./types.js";
export * from "./local-git.js";
export * from "./cloudflare.js";

export function getArtifactsClient(opts?: {
  accountId?: string;
  namespace?: string;
  apiToken?: string;
  forceLocal?: boolean;
  baseDir?: string;
}): ArtifactsClient {
  const accountId = opts?.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? "9888fed381861dcc35a37b026ff176e9";
  const namespace = opts?.namespace ?? process.env.ARTIFACTS_NAMESPACE ?? "flaregit-default";
  const apiToken = opts?.apiToken ?? process.env.CLOUDFLARE_API_TOKEN;

  if (!opts?.forceLocal && apiToken) {
    return new CloudflareArtifactsClient(accountId, namespace, apiToken);
  }

  return new LocalGitArtifactsClient(opts?.baseDir);
}
