import {expect, test} from 'bun:test';
import {verifyGpgSignature} from '../src/core/gpg-signature';

// Produced by GnuPG 2.5 (`gpg --detach-sign --armor`, Ed25519) over the bytes "payload\n"; checked with `gpg --verify`.
const SIGNATURE = `-----BEGIN PGP SIGNATURE-----

iJEEABYKADkWIQQUvXS2x2baV/n7FonfiJEESC7rEAUCascDABsUgAAAAAAEAA5t
YW51MiwyLjUrMS4xMiwwLDMACgkQ34iRBEgu6xDdVQEAqcKStvBrkkTcfrYZUN21
9rmrBOrhJ2jQCkpCx1lLwTEBAJa/vpi1lc3rQJBGesZfYgtENp/c1ElUAwWw1Pgg
qAoI
=5vRc
-----END PGP SIGNATURE-----
`;
const PUBLIC_KEY = `-----BEGIN PGP PUBLIC KEY BLOCK-----

mDMEascC/xYJKwYBBAHaRw8BAQdAHFwYf7/wicl8pPpZMNsMgyhnYfIgFFIjWUHu
CObHvZ60G0ZpeHR1cmUgPGZpeHR1cmVAbG9jYWxob3N0PoivBBMWCgBXFiEEFL10
tsdm2lf5+xaJ34iRBEgu6xAFAmrHAv8bFIAAAAAABAAObWFudTIsMi41KzEuMTIs
MCwzAhsDBQsJCAcCAiICBhUKCQgLAgQWAgMBAh4HAheAAAoJEN+IkQRILusQy/oA
/3K9iK/6Gv0qghW2uZgjz2eNiuDkxQx1z6PRnC4VQ17OAP0cXjcaySuvxr8vXBYa
Lf+ItKHhUUC2Jda8De+6BhkeCQ==
=fqMl
-----END PGP PUBLIC KEY BLOCK-----
`;
const PAYLOAD = new TextEncoder().encode('payload\n');
const FINGERPRINT = '14BD74B6C766DA57F9FB1689DF889104482EEB10';

test('a GnuPG signature verifies against its trusted key and reports that key fingerprint', async () => {
  expect(await verifyGpgSignature({armored: SIGNATURE, payload: PAYLOAD, trustedKeys: [PUBLIC_KEY]})).toEqual({ok: true, fingerprint: FINGERPRINT});
});

test('a signature does not verify over a different payload', async () => {
  const result = await verifyGpgSignature({armored: SIGNATURE, payload: new TextEncoder().encode('payload!\n'), trustedKeys: [PUBLIC_KEY]});
  expect(result.ok).toBe(false);
});

test('a signature is refused when no trusted key is registered, or the only key is not the signer', async () => {
  expect(await verifyGpgSignature({armored: SIGNATURE, payload: PAYLOAD, trustedKeys: []})).toEqual({ok: false, error: 'No trusted GPG keys are registered'});
  const unrelated = PUBLIC_KEY.replace(/[A-Za-z0-9+/]{20}/, 'AAAAAAAAAAAAAAAAAAAA');
  expect((await verifyGpgSignature({armored: SIGNATURE, payload: PAYLOAD, trustedKeys: [unrelated]})).ok).toBe(false);
});

test('a non-PGP block and a malformed signature are refused', async () => {
  expect(await verifyGpgSignature({armored: '-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----', payload: PAYLOAD, trustedKeys: [PUBLIC_KEY]})).toEqual({ok: false, error: 'Signature is not an OpenPGP signature block'});
  expect((await verifyGpgSignature({armored: '-----BEGIN PGP SIGNATURE-----\nnot base64 !!\n-----END PGP SIGNATURE-----', payload: PAYLOAD, trustedKeys: [PUBLIC_KEY]})).ok).toBe(false);
});
