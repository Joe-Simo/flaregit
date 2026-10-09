/** F02: verify an SSHSIG commit signature (ssh-keygen -Y sign) against a trusted authorized key. Ed25519 only. */

export type SshVerifyResult = { readonly ok: true; readonly keyType: "ssh-ed25519" } | { readonly ok: false; readonly error: string };

const MAGIC = new TextEncoder().encode("SSHSIG");

interface Reader {
  bytes: Uint8Array;
  offset: number;
}

function readU32(reader: Reader): number {
  if (reader.offset + 4 > reader.bytes.length) throw new Error("truncated");
  const value = new DataView(reader.bytes.buffer, reader.bytes.byteOffset + reader.offset, 4).getUint32(0);
  reader.offset += 4;
  return value;
}

function readString(reader: Reader): Uint8Array {
  const length = readU32(reader);
  if (reader.offset + length > reader.bytes.length) throw new Error("truncated");
  const value = reader.bytes.slice(reader.offset, reader.offset + length);
  reader.offset += length;
  return value;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function encodeString(value: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + value.length);
  new DataView(out.buffer).setUint32(0, value.length);
  out.set(value, 4);
  return out;
}

const text = (value: Uint8Array) => new TextDecoder().decode(value);

function decodeArmor(armored: string): Uint8Array | null {
  const match = /^-----BEGIN SSH SIGNATURE-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END SSH SIGNATURE-----(?:\r?\n)?$/.exec(armored);
  if (!match) return null;
  const body = match[1]!.replace(/[\r\n]/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body) || body.length === 0) return null;
  const decoded = Buffer.from(body, "base64");
  if (decoded.toString("base64") !== body) return null;
  return new Uint8Array(decoded);
}

/** Verifies an armored SSHSIG over `payload` in `namespace` against authorized-key lines. Only ssh-ed25519 is accepted. */
export async function verifySshSignature(options: {
  armored: string;
  payload: Uint8Array;
  namespace: string;
  trustedKeys: readonly string[];
}): Promise<SshVerifyResult> {
  const blob = decodeArmor(options.armored);
  if (!blob) return {ok: false, error: "Signature is not a well-formed SSH signature block"};
  let publicKeyBlob: Uint8Array, namespace: Uint8Array, reserved: Uint8Array, hashAlgorithm: Uint8Array, signatureBlob: Uint8Array;
  try {
    const reader: Reader = {bytes: blob, offset: 0};
    if (!equalBytes(reader.bytes.slice(0, 6), MAGIC)) return {ok: false, error: "Signature magic is not SSHSIG"};
    reader.offset = 6;
    if (readU32(reader) !== 1) return {ok: false, error: "Unsupported SSHSIG version"};
    publicKeyBlob = readString(reader);
    namespace = readString(reader);
    reserved = readString(reader);
    hashAlgorithm = readString(reader);
    signatureBlob = readString(reader);
    if (reader.offset !== reader.bytes.length) return {ok: false, error: "Signature contains trailing data"};
  } catch {
    return {ok: false, error: "Signature is truncated or malformed"};
  }
  if (text(namespace) !== options.namespace) return {ok: false, error: "Signature namespace does not match"};
  if (reserved.length !== 0) return {ok: false, error: "Signature reserved field must be empty"};
  const hashName = text(hashAlgorithm) === "sha512" ? "SHA-512" : text(hashAlgorithm) === "sha256" ? "SHA-256" : null;
  if (!hashName) return {ok: false, error: "Unsupported signature hash algorithm"};

  const keyReader: Reader = {bytes: publicKeyBlob, offset: 0};
  let keyType: Uint8Array, rawKey: Uint8Array;
  try {
    keyType = readString(keyReader);
    rawKey = readString(keyReader);
    if (keyReader.offset !== keyReader.bytes.length) return {ok: false, error: "Signing key contains trailing data"};
  } catch {
    return {ok: false, error: "Signing key is malformed"};
  }
  if (text(keyType) !== "ssh-ed25519" || rawKey.length !== 32) return {ok: false, error: "Only ssh-ed25519 keys are accepted"};
  const trusted = options.trustedKeys.some((line) => {
    const [type, encoded] = line.trim().split(/\s+/);
    return type === "ssh-ed25519" && encoded !== undefined && equalBytes(new Uint8Array(Buffer.from(encoded, "base64")), publicKeyBlob);
  });
  if (!trusted) return {ok: false, error: "Signing key is not a trusted key"};

  const sigReader: Reader = {bytes: signatureBlob, offset: 0};
  let sigAlgorithm: Uint8Array, signature: Uint8Array;
  try {
    sigAlgorithm = readString(sigReader);
    signature = readString(sigReader);
    if (sigReader.offset !== sigReader.bytes.length) return {ok: false, error: "Signature value contains trailing data"};
  } catch {
    return {ok: false, error: "Signature value is malformed"};
  }
  if (text(sigAlgorithm) !== "ssh-ed25519" || signature.length !== 64) return {ok: false, error: "Only 64-byte ssh-ed25519 signatures are accepted"};

  const digest = new Uint8Array(await crypto.subtle.digest(hashName, new Uint8Array(options.payload)));
  const signedData = concat([MAGIC, encodeString(namespace), encodeString(reserved), encodeString(hashAlgorithm), encodeString(digest)]);
  const key = await crypto.subtle.importKey("raw", new Uint8Array(rawKey), {name: "Ed25519"}, false, ["verify"]);
  const valid = await crypto.subtle.verify("Ed25519", key, new Uint8Array(signature), new Uint8Array(signedData));
  return valid ? {ok: true, keyType: "ssh-ed25519"} : {ok: false, error: "Signature does not verify for this payload"};
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
