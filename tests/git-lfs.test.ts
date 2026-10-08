import {expect, test} from 'bun:test';
import {LFS_MAX_BATCH_OBJECTS, lfsOidOf, validateLfsBatch, verifyLfsObject} from '../src/core/git-lfs';

const ABC_OID = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

test('a well-formed batch is accepted for download and upload with the basic transfer', () => {
  expect(validateLfsBatch({operation: 'upload', transfers: ['basic'], objects: [{oid: ABC_OID, size: 3}]}))
    .toEqual({ok: true, operation: 'upload', objects: [{oid: ABC_OID, size: 3}]});
  expect(validateLfsBatch({operation: 'download', objects: []}).ok).toBe(true);
});

test('unknown operations, unsupported transfers and malformed objects are refused', () => {
  expect(validateLfsBatch({operation: 'delete', objects: []}).ok).toBe(false);
  expect(validateLfsBatch({operation: 'upload', transfers: ['ssh'], objects: []}).ok).toBe(false);
  expect(validateLfsBatch({operation: 'upload'}).ok).toBe(false);
  expect(validateLfsBatch({operation: 'upload', objects: [{oid: 'ABC', size: 3}]}).ok).toBe(false);
  expect(validateLfsBatch({operation: 'upload', objects: [{oid: ABC_OID, size: -1}]}).ok).toBe(false);
  expect(validateLfsBatch({operation: 'upload', objects: [{oid: ABC_OID, size: 1.5}]}).ok).toBe(false);
  expect(validateLfsBatch(null).ok).toBe(false);
});

test('batches over the object count and objects over the size limit are refused before any upload', () => {
  const tooMany = Array.from({length: LFS_MAX_BATCH_OBJECTS + 1}, () => ({oid: ABC_OID, size: 3}));
  expect(validateLfsBatch({operation: 'upload', objects: tooMany})).toEqual({ok: false, status: 413, error: `An LFS batch can list at most ${LFS_MAX_BATCH_OBJECTS} objects`});
  expect(validateLfsBatch({operation: 'upload', objects: [{oid: ABC_OID, size: 11}]}, 10)).toEqual({ok: false, status: 413, error: 'LFS object exceeds the size limit'});
});

test('an object is accepted only when its actual bytes match the declared SHA-256 and size', async () => {
  const bytes = new TextEncoder().encode('abc');
  expect(await lfsOidOf(bytes)).toBe(ABC_OID);
  expect(await verifyLfsObject({oid: ABC_OID, size: 3}, bytes)).toEqual({ok: true});
});

test('a pointer-only claim, wrong bytes, or a wrong size is refused', async () => {
  const other = new TextEncoder().encode('abd');
  expect((await verifyLfsObject({oid: ABC_OID, size: 3}, other))).toEqual({ok: false, error: 'Uploaded LFS object hash does not match its oid'});
  expect((await verifyLfsObject({oid: ABC_OID, size: 4}, new TextEncoder().encode('abc')))).toEqual({ok: false, error: 'Uploaded LFS object size does not match the declared size'});
});
