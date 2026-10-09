import {expect, test} from 'bun:test';
import {parseCommitSignature} from '../src/core/commit-signature';

const tree = 'tree ' + 'a'.repeat(40) + '\n';
const parent = 'parent ' + 'b'.repeat(40) + '\n';
const author = 'author Fixture <fixture@localhost> 1700000000 +0000\n';
const committer = 'committer Fixture <fixture@localhost> 1700000000 +0000\n';
const message = '\nAdd feature\n';
const plain = tree + parent + author + committer + message;

const pgpBlock = [
  'gpgsig -----BEGIN PGP SIGNATURE-----',
  ' ',
  ' iQEzBAABCAAdFiEEfixturefixturefixtureAAAAAAAAAAAAAAAAAAA',
  ' -----END PGP SIGNATURE-----',
].join('\n') + '\n';

test('an unsigned commit is reported as unsigned with no payload', () => {
  expect(parseCommitSignature(plain)).toEqual({ok: true, value: {signed: false, status: 'unsigned'}});
});

test('a PGP-signed commit yields the format, the full signature and the exact payload without the header', () => {
  const signed = tree + parent + author + committer + pgpBlock + message;
  const result = parseCommitSignature(signed);
  expect(result.ok).toBe(true);
  if (!result.ok || !result.value.signed) throw new Error('expected a signed commit');
  expect(result.value.format).toBe('gpg');
  expect(result.value.status).toBe('signed_unverified');
  expect(result.value.signature.startsWith('-----BEGIN PGP SIGNATURE-----\n')).toBe(true);
  expect(result.value.signature.endsWith('-----END PGP SIGNATURE-----\n')).toBe(true);
  expect(result.value.signedPayload).toBe(plain);
});

test('SSH and X.509 signature blocks are recognised, and an unknown block is reported as unknown', () => {
  const ssh = 'gpgsig-sha256 -----BEGIN SSH SIGNATURE-----\n AAAA\n -----END SSH SIGNATURE-----\n';
  const x509 = 'gpgsig -----BEGIN SIGNED MESSAGE-----\n MIIB\n -----END SIGNED MESSAGE-----\n';
  const other = 'gpgsig -----BEGIN WHATEVER-----\n X\n -----END WHATEVER-----\n';
  const formats = [ssh, x509, other].map((block) => {
    const result = parseCommitSignature(tree + parent + author + committer + block + message);
    return result.ok && result.value.signed ? result.value.format : 'error';
  });
  expect(formats).toEqual(['ssh', 'x509', 'unknown']);
});

test('a commit with two signature headers, or a header without a signature block, is refused', () => {
  expect(parseCommitSignature(tree + parent + author + committer + pgpBlock + pgpBlock + message).ok).toBe(false);
  expect(parseCommitSignature(tree + parent + author + committer + 'gpgsig not-a-block\n' + message).ok).toBe(false);
});

test('a signed commit with no message body still rebuilds its payload exactly', () => {
  const signed = tree + parent + author + committer + pgpBlock.replace(/\n$/, '');
  const result = parseCommitSignature(signed);
  expect(result.ok && result.value.signed && result.value.signedPayload).toBe(tree + parent + author + committer);
});
