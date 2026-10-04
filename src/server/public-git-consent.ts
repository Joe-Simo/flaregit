import { z } from "zod";

/** No repository is enabled by metadata visibility or by this validator. */
export const PUBLIC_GIT_AUTHOR_ACKNOWLEDGEMENT = "Publish accepted Git history including original author names and email addresses";
export const publicGitConsentInput = z.object({
  incarnation: z.string().uuid(),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  tree: z.string().regex(/^[a-f0-9]{40}$/),
  publicationVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  acknowledgement: z.literal(PUBLIC_GIT_AUTHOR_ACKNOWLEDGEMENT),
  confirmed: z.literal(true),
}).strict();
export type PublicGitConsentInput = z.infer<typeof publicGitConsentInput>;

export interface PublicGitConsentScope {
  incarnation: string;
  commit: string;
  tree: string;
  publicationVersion: number;
}

/** Scope validation only; no persistence, authorization, export or public route. */
export function validatePublicGitConsent(value: unknown, current: Readonly<PublicGitConsentScope>): PublicGitConsentInput {
  const input = publicGitConsentInput.parse(value);
  if (input.incarnation !== current.incarnation || input.commit !== current.commit || input.tree !== current.tree || input.publicationVersion !== current.publicationVersion) {
    throw new Error("Accepted repository publication changed; reload before confirming Git sharing");
  }
  return input;
}
