/** F02 slice: parse a Git commit's signature header and rebuild its exact signed payload. Cryptographic verification is separate. */

export type CommitSignatureFormat = "gpg" | "ssh" | "x509" | "unknown";

export type CommitSignature =
  | { readonly signed: false; readonly status: "unsigned" }
  | { readonly signed: true; readonly status: "signed_unverified"; readonly format: CommitSignatureFormat; readonly signature: string; readonly signedPayload: string };

export type CommitSignatureResult = { readonly ok: true; readonly value: CommitSignature } | { readonly ok: false; readonly error: string };

const SIGNATURE_HEADERS = ["gpgsig ", "gpgsig-sha256 "];

function formatOf(signature: string): CommitSignatureFormat {
  if (signature.includes("-----BEGIN PGP SIGNATURE-----")) return "gpg";
  if (signature.includes("-----BEGIN SSH SIGNATURE-----")) return "ssh";
  if (signature.includes("-----BEGIN SIGNED MESSAGE-----")) return "x509";
  return "unknown";
}

/** Parses a commit object. The signed payload is the object with each signature header removed, byte for byte. */
export function parseCommitSignature(commit: string): CommitSignatureResult {
  const lines = commit.split("\n");
  const offsets: number[] = [];
  let position = 0;
  for (const line of lines) {
    offsets.push(position);
    position += line.length + 1;
  }
  const blocks: string[] = [];
  const removed: Array<[number, number]> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === "") break;
    const prefix = SIGNATURE_HEADERS.find((header) => line.startsWith(header));
    if (prefix === undefined) continue;
    const block = [line.slice(prefix.length)];
    let last = i;
    while (last + 1 < lines.length && lines[last + 1]!.startsWith(" ")) {
      last += 1;
      block.push(lines[last]!.slice(1));
    }
    const end = last + 1 < lines.length ? offsets[last + 1]! : commit.length;
    removed.push([offsets[i]!, end]);
    blocks.push(block.join("\n") + "\n");
    i = last;
  }
  if (blocks.length === 0) return {ok: true, value: {signed: false, status: "unsigned"}};
  if (blocks.length > 1) return {ok: false, error: "A commit must carry exactly one signature header"};
  const signature = blocks[0]!;
  if (!signature.includes("-----BEGIN ")) return {ok: false, error: "Signature header does not contain a recognisable signature block"};
  let signedPayload = "";
  let cursor = 0;
  for (const [start, end] of removed) {
    signedPayload += commit.slice(cursor, start);
    cursor = end;
  }
  signedPayload += commit.slice(cursor);
  return {ok: true, value: {signed: true, status: "signed_unverified", format: formatOf(signature), signature, signedPayload}};
}
