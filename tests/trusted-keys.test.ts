import {expect, test} from 'bun:test';
import {MAX_TRUSTED_KEYS, addTrustedKey, parseTrustedKey, removeTrustedKey, trustedKeyLines} from '../src/core/trusted-keys';
import {verifySshSignature} from '../src/core/ssh-signature';

const BLOB = 'AAAAC3NzaC1lZDI1NTE5AAAAIL+NbGiKGIW7hZQwEIsoQAQo1fH1IVFF7Tm+yeA03BEj';
const LINE = `ssh-ed25519 ${BLOB} fixture@localhost`;
const OTHER_BLOB = Buffer.from(new Uint8Array([0, 0, 0, 11, ...new TextEncoder().encode('ssh-ed25519'), 0, 0, 0, 32, ...new Uint8Array(32).fill(7)])).toString('base64');

test('a valid ssh-ed25519 line is parsed and its comment is kept but not used for trust', () => {
  const parsed = parseTrustedKey(LINE);
  expect(parsed).toEqual({ok: true, keys: [{type: 'ssh-ed25519', blob: BLOB, comment: 'fixture@localhost'}]});
  expect(trustedKeyLines(parsed.ok ? parsed.keys : [])).toEqual([`ssh-ed25519 ${BLOB}`]);
});

test('other key types, malformed base64, wrong blobs and non-text input are refused', () => {
  expect(parseTrustedKey('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ user@host').ok).toBe(false);
  expect(parseTrustedKey('ssh-ed25519 not*base64 user').ok).toBe(false);
  expect(parseTrustedKey(`ssh-ed25519 ${Buffer.from('short').toString('base64')}`).ok).toBe(false);
  expect(parseTrustedKey(42).ok).toBe(false);
  expect(parseTrustedKey('ssh-ed25519').ok).toBe(false);
  expect(parseTrustedKey(`ssh-ed25519 ${BLOB} ${'x'.repeat(201)}`).ok).toBe(false);
});

test('adding a key is idempotent and the registry is capped', () => {
  const once = addTrustedKey([], LINE);
  if (!once.ok) throw new Error('setup failed');
  const again = addTrustedKey(once.keys, LINE);
  expect(again).toEqual({ok: true, keys: once.keys});
  let full: ReturnType<typeof addTrustedKey> = {ok: true, keys: []};
  for (let i = 0; i < MAX_TRUSTED_KEYS; i++) {
    const blob = Buffer.from(new Uint8Array([0, 0, 0, 11, ...new TextEncoder().encode('ssh-ed25519'), 0, 0, 0, 32, ...new Uint8Array(32).fill(i + 1)])).toString('base64');
    if (!full.ok) throw new Error('setup failed');
    full = addTrustedKey(full.keys, `ssh-ed25519 ${blob}`);
  }
  if (!full.ok) throw new Error('setup failed');
  expect(full.keys.length).toBe(MAX_TRUSTED_KEYS);
  expect(addTrustedKey(full.keys, LINE).ok).toBe(false);
});

test('removing a registered key works and removing an unknown key is refused', () => {
  const added = addTrustedKey([], LINE);
  if (!added.ok) throw new Error('setup failed');
  expect(removeTrustedKey(added.keys, BLOB)).toEqual({ok: true, keys: []});
  expect(removeTrustedKey(added.keys, OTHER_BLOB)).toEqual({ok: false, error: 'That signing key is not registered'});
  expect(removeTrustedKey(added.keys, 7).ok).toBe(false);
});

test('a registered key trusts a real ssh-keygen signature, and an unregistered key does not', async () => {
  const signature = [
    '-----BEGIN SSH SIGNATURE-----',
    'U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAgv41saIoYhbuFlDAQiyhABCjV8f',
    'UhUUXtOb7J4DTcESMAAAADZ2l0AAAAAAAAAAZzaGE1MTIAAABTAAAAC3NzaC1lZDI1NTE5',
    'AAAAQNsEyZSFqS9gCW5F9bXqtFHZQWIm3/bvBnjbSOsCCXNd7TbZH3Dj5lz/KL5mPAW/Uj',
    'dTd+bdi162YqBRdApXqAM=',
    '-----END SSH SIGNATURE-----',
  ].join('\n');
  const payload = new TextEncoder().encode('payload\n');
  const registered = addTrustedKey([], LINE);
  if (!registered.ok) throw new Error('setup failed');
  expect((await verifySshSignature({armored: signature, payload, namespace: 'git', trustedKeys: trustedKeyLines(registered.keys)})).ok).toBe(true);
  expect((await verifySshSignature({armored: signature, payload, namespace: 'git', trustedKeys: trustedKeyLines([])})).ok).toBe(false);
});
