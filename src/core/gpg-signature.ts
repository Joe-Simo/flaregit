/** F02: verify an OpenPGP detached signature over a commit payload against trusted armored public keys. */
import * as openpgp from "openpgp";

export type GpgVerifyResult = { readonly ok: true; readonly fingerprint: string } | { readonly ok: false; readonly error: string };

/** Accepts only a signature that verifies against one of the trusted keys; the signing key's fingerprint is returned. */
export async function verifyGpgSignature(options: {
  armored: string;
  payload: Uint8Array;
  trustedKeys: readonly string[];
}): Promise<GpgVerifyResult> {
  if (!options.armored.includes("-----BEGIN PGP SIGNATURE-----")) return {ok: false, error: "Signature is not an OpenPGP signature block"};
  if (options.trustedKeys.length === 0) return {ok: false, error: "No trusted GPG keys are registered"};
  let signature: openpgp.Signature;
  try {
    signature = await openpgp.readSignature({armoredSignature: options.armored});
  } catch {
    return {ok: false, error: "Signature is malformed"};
  }
  const keys: openpgp.Key[] = [];
  for (const armoredKey of options.trustedKeys) {
    try {
      keys.push(await openpgp.readKey({armoredKey}));
    } catch {
      return {ok: false, error: "A trusted GPG key is malformed"};
    }
  }
  const message = await openpgp.createMessage({binary: new Uint8Array(options.payload)});
  let verified;
  try {
    verified = await openpgp.verify({message, signature, verificationKeys: keys});
  } catch {
    return {ok: false, error: "Signature does not verify for this payload"};
  }
  for (const entry of verified.signatures) {
    try {
      await entry.verified;
    } catch {
      continue;
    }
    const key = keys.find((candidate) => candidate.getKeyIDs().some((id) => id.equals(entry.keyID)));
    if (key) return {ok: true, fingerprint: key.getFingerprint().toUpperCase()};
  }
  return {ok: false, error: "Signature does not verify for any trusted key"};
}
