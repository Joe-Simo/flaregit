import { expect, test } from 'bun:test';
import { storageRepositoryId } from '../src/web/storage-repository-input';
const id = 'pbd425298ee02';
test('storage input accepts the repository ID and local hash routes', () => {
  for (const value of [id, `  ${id}  `, `#/p/${id}`, `/#/p/${id}/settings?view=storage`, `/p/${id}`]) expect(storageRepositoryId(value, 'http://localhost:4329')).toBe(id);
});
test('storage input accepts trusted FlareGit links without following them', () => {
  for (const value of [`https://flaregit.com/#/p/${id}/settings`, `https://www.flaregit.com/#/p/${id}`, `http://localhost:4329/#/p/${id}`]) expect(storageRepositoryId(value, 'http://localhost:4329')).toBe(id);
});
test('storage input rejects foreign origins, credentials, unsafe schemes, and other routes', () => {
  for (const value of [`https://evil.example/#/p/${id}`, `https://flaregit.com.evil.example/#/p/${id}`, `https://user:secret@flaregit.com/#/p/${id}`, `javascript:alert(1)#/p/${id}`, `https://flaregit.com/#/account?repo=${id}`, `#/p/${id}/settings/extra`, `#/p/%70bd425298ee02`, 'bad', `http://flaregit.com/#/p/${id}`]) expect(storageRepositoryId(value, 'http://localhost:4329')).toBeNull();
});
