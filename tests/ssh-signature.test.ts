import {expect, test} from 'bun:test';
import {verifySshSignature} from '../src/core/ssh-signature';

// Produced locally with `ssh-keygen -Y sign -n git` over the bytes "payload\n"; checked with `ssh-keygen -Y check-novalidate`.
const TRUSTED = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIL+NbGiKGIW7hZQwEIsoQAQo1fH1IVFF7Tm+yeA03BEj fixture@localhost';
const SIGNATURE = [
  '-----BEGIN SSH SIGNATURE-----',
  'U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgv41saIoYhbuFlDAQiyhABCjV8f',
  'UhUUXtOb7J4DTcESMAAAADZ2l0AAAAAAAAAAZzaGE1MTIAAABTAAAAC3NzaC1lZDI1NTE5',
  'AAAAQNsEyZSFqS9gCW5F9bXqtFHZQWIm3/bvBnjbSOsCCXNd7TbZH3Dj5lz/KL5mPAW/Uj',
  'dTd+bdi162YqBRdApXqAM=',
  '-----END SSH SIGNATURE-----',
].join('\n');
const PAYLOAD = new TextEncoder().encode('payload\n');
const other = 'ssh-ed25519 ' + Buffer.from(new Uint8Array(51)).toString('base64') + ' other@localhost';

test('a signature made by a trusted ssh-ed25519 key verifies over the exact payload', async () => {
  expect(await verifySshSignature({armored: SIGNATURE, payload: PAYLOAD, namespace: 'git', trustedKeys: [TRUSTED]})).toEqual({ok: true, keyType: 'ssh-ed25519'});
});

test('a signature does not verify over a different payload', async () => {
  const result = await verifySshSignature({armored: SIGNATURE, payload: new TextEncoder().encode('payload!\n'), namespace: 'git', trustedKeys: [TRUSTED]});
  expect(result).toEqual({ok: false, error: 'Signature does not verify for this payload'});
});

test('a signature from a key that is not trusted is refused even when it would verify', async () => {
  const result = await verifySshSignature({armored: SIGNATURE, payload: PAYLOAD, namespace: 'git', trustedKeys: [other]});
  expect(result).toEqual({ok: false, error: 'Signing key is not a trusted key'});
});

test('a signature for another namespace is refused', async () => {
  const result = await verifySshSignature({armored: SIGNATURE, payload: PAYLOAD, namespace: 'file', trustedKeys: [TRUSTED]});
  expect(result).toEqual({ok: false, error: 'Signature namespace does not match'});
});

test('a tampered signature body is refused and never reported as verified', async () => {
  const tampered = SIGNATURE.replace('dTd+bdi162YqBRdApXqAM=', 'eTd+bdi162YqBRdApXqAM=');
  const result = await verifySshSignature({armored: tampered, payload: PAYLOAD, namespace: 'git', trustedKeys: [TRUSTED]});
  expect(result.ok).toBe(false);
});

test('input that is not an SSH signature block is refused', async () => {
  const result = await verifySshSignature({armored: '-----BEGIN PGP SIGNATURE-----\nabc\n-----END PGP SIGNATURE-----', payload: PAYLOAD, namespace: 'git', trustedKeys: [TRUSTED]});
  expect(result).toEqual({ok: false, error: 'Signature is not a well-formed SSH signature block'});
});

test('armor must contain exactly one complete signature without surrounding content', async () => {
  for (const armored of [`prefix\n${SIGNATURE}`, `${SIGNATURE}\nsuffix`, `${SIGNATURE}\n${SIGNATURE}`]) {
    expect((await verifySshSignature({armored, payload: PAYLOAD, namespace: 'git', trustedKeys: [TRUSTED]})).ok).toBe(false);
  }
  expect((await verifySshSignature({armored: SIGNATURE.replaceAll('\n', '\r\n') + '\r\n', payload: PAYLOAD, namespace: 'git', trustedKeys: [TRUSTED]})).ok).toBe(true);
});

test('trailing binary data in the envelope, public key or signature is refused', async () => {
  const original = Buffer.from(SIGNATURE.split('\n').slice(1, -1).join(''), 'base64');
  const armor = (bytes: Uint8Array) => `-----BEGIN SSH SIGNATURE-----\n${Buffer.from(bytes).toString('base64')}\n-----END SSH SIGNATURE-----`;
  const insertInString = (offset: number) => {
    const length = original.readUInt32BE(offset);
    const end = offset + 4 + length;
    const mutated = Buffer.concat([original.subarray(0, end), Buffer.from([0]), original.subarray(end)]);
    mutated.writeUInt32BE(length + 1, offset);
    return mutated;
  };
  // SSHSIG magic/version is followed by five length-prefixed strings.
  let signatureOffset = 10;
  for (let index = 0; index < 4; index++) signatureOffset += 4 + original.readUInt32BE(signatureOffset);
  for (const bytes of [Buffer.concat([original, Buffer.from([0])]), insertInString(10), insertInString(signatureOffset)]) {
    expect((await verifySshSignature({armored: armor(bytes), payload: PAYLOAD, namespace: 'git', trustedKeys: [TRUSTED]})).ok).toBe(false);
  }
});

test('noncanonical and incorrectly padded base64 cannot be accepted as an SSH signature', async () => {
  const encoded = SIGNATURE.split('\n').slice(1, -1).join('');
  for (const body of [encoded.replace(/=$/, ''), encoded + '=', encoded.slice(0, -2) + 'N=']) {
    const armored = `-----BEGIN SSH SIGNATURE-----\n${body}\n-----END SSH SIGNATURE-----`;
    expect((await verifySshSignature({armored, payload: PAYLOAD, namespace: 'git', trustedKeys: [TRUSTED]})).ok).toBe(false);
  }
});
