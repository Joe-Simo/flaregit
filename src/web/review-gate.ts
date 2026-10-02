/** Optional report availability cannot become an approval dependency. Corrupt
 * identities are rejected regardless of policy; declared required checks fail closed. */
export function blocksExternalAcceptance(input: { required: boolean; known: boolean; readFailed: boolean; identityMismatch: boolean; gate: "passed" | "pending" | "failed"; retryingRequired: boolean }): boolean {
  if (input.identityMismatch) return true;
  return input.required && (!input.known || input.readFailed || input.retryingRequired || input.gate !== "passed");
}
