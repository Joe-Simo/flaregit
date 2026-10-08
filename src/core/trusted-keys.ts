/** F02: trusted signing-key registry for SSH commit signatures. Pure validation; storage is wired separately. */

export const MAX_TRUSTED_KEYS = 20;

export interface TrustedKey {
  readonly type: "ssh-ed25519";
  /** Base64 of the public-key blob, exactly as in an authorized_keys line. */
  readonly blob: string;
  readonly comment: string;
}

export type TrustedKeyResult = { readonly ok: true; readonly keys: TrustedKey[] } | { readonly ok: false; readonly error: string };

/** Parses one authorized_keys-style line. Only ssh-ed25519 is accepted; the comment is kept but never trusted. */
export function parseTrustedKey(line: unknown): TrustedKeyResult {
  if (typeof line !== "string") return {ok: false, error: "A key must be a text line"};
  const parts = line.trim().split(/\s+/);
  if (parts.length < 2 || parts.length > 3) return {ok: false, error: "A key line must be 'ssh-ed25519 <base64> [comment]'"};
  const [type, blob, comment = ""] = parts as [string, string, string?];
  if (type !== "ssh-ed25519") return {ok: false, error: "Only ssh-ed25519 keys can be trusted"};
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(blob)) return {ok: false, error: "The key is not valid base64"};
  const decoded = new Uint8Array(Buffer.from(blob, "base64"));
  const expected = 4 + "ssh-ed25519".length + 4 + 32;
  const typeLength = decoded.length >= 4 ? new DataView(decoded.buffer).getUint32(0) : -1;
  if (decoded.length !== expected || typeLength !== "ssh-ed25519".length || new TextDecoder().decode(decoded.slice(4, 4 + typeLength)) !== "ssh-ed25519") {
    return {ok: false, error: "The key blob is not an ssh-ed25519 public key"};
  }
  if (comment.length > 200) return {ok: false, error: "The key comment is too long"};
  return {ok: true, keys: [{type: "ssh-ed25519", blob, comment}]};
}

/** Adds a key to the registry. Adding the same key again is idempotent; the registry is capped. */
export function addTrustedKey(keys: readonly TrustedKey[], line: unknown): TrustedKeyResult {
  const parsed = parseTrustedKey(line);
  if (!parsed.ok) return parsed;
  const [key] = parsed.keys;
  if (keys.some((existing) => existing.blob === key!.blob)) return {ok: true, keys: [...keys]};
  if (keys.length >= MAX_TRUSTED_KEYS) return {ok: false, error: `A user can trust at most ${MAX_TRUSTED_KEYS} signing keys`};
  return {ok: true, keys: [...keys, key!]};
}

/** Removes the key with the given blob. Removing an unknown key is refused so callers see the mismatch. */
export function removeTrustedKey(keys: readonly TrustedKey[], blob: unknown): TrustedKeyResult {
  if (typeof blob !== "string") return {ok: false, error: "Remove a key by its base64 blob"};
  if (!keys.some((key) => key.blob === blob)) return {ok: false, error: "That signing key is not registered"};
  return {ok: true, keys: keys.filter((key) => key.blob !== blob)};
}

/** The authorized_keys lines the SSH verifier trusts; comments are not part of trust. */
export function trustedKeyLines(keys: readonly TrustedKey[]): string[] {
  return keys.map((key) => `${key.type} ${key.blob}`);
}
