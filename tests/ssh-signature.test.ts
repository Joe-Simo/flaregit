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
