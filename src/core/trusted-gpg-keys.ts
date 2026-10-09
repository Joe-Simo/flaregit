/** F02: trusted GPG public-key registry for commit signatures. Validation uses the same OpenPGP library as the verifier. */
import * as openpgp from "openpgp";

export const MAX_TRUSTED_GPG_KEYS = 20;
const MAX_KEY_CHARACTERS = 20000;

export interface TrustedGpgKey {
  readonly fingerprint: string;
  readonly armored: string;
}

export type TrustedGpgResult = { readonly ok: true; readonly keys: TrustedGpgKey[] } | { readonly ok: false; readonly error: string };

/** Parses one armored PGP public key. Private keys are refused; the fingerprint is returned in uppercase. */
export async function parseTrustedGpgKey(armored: unknown): Promise<{ readonly ok: true; readonly key: TrustedGpgKey } | { readonly ok: false; readonly error: string }> {
  if (typeof armored !== "string" || !armored.includes("-----BEGIN PGP PUBLIC KEY BLOCK-----")) return {ok: false, error: "A GPG key must be an armored PGP public key block"};
  if (armored.length > MAX_KEY_CHARACTERS) return {ok: false, error: "The GPG key is too large"};
  let key: openpgp.Key;
  try {
    key = await openpgp.readKey({armoredKey: armored});
  } catch {
    return {ok: false, error: "The GPG key is malformed"};
  }
  if (key.isPrivate()) return {ok: false, error: "Register only the public key, never a private key"};
  return {ok: true, key: {fingerprint: key.getFingerprint().toUpperCase(), armored: armored.trim() + "\n"}};
}

/** Adds a key; adding the same fingerprint again is idempotent; the registry is capped. */
export function addTrustedGpgKey(keys: readonly TrustedGpgKey[], key: TrustedGpgKey): TrustedGpgResult {
  if (keys.some((existing) => existing.fingerprint === key.fingerprint)) return {ok: true, keys: [...keys]};
  if (keys.length >= MAX_TRUSTED_GPG_KEYS) return {ok: false, error: `A user can trust at most ${MAX_TRUSTED_GPG_KEYS} GPG keys`};
  return {ok: true, keys: [...keys, key]};
}

/** Removes the key with the given fingerprint; removing an unknown key is refused. */
export function removeTrustedGpgKey(keys: readonly TrustedGpgKey[], fingerprint: unknown): TrustedGpgResult {
  if (typeof fingerprint !== "string") return {ok: false, error: "Remove a GPG key by its fingerprint"};
  const normalized = fingerprint.toUpperCase();
  if (!keys.some((key) => key.fingerprint === normalized)) return {ok: false, error: "That GPG key is not registered"};
  return {ok: true, keys: keys.filter((key) => key.fingerprint !== normalized)};
}
