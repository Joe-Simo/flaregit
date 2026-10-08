import {expect, test} from 'bun:test';
import {ARCHIVED_WRITE_MESSAGE, archivedWriteRefusal} from '../src/server/archive-guard';

const project = (state: string) => ({repositoryLifecycle: async () => ({state})});

test('an archived repository refuses every non-GET write with the read-only message', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const refusal = await archivedWriteRefusal(project('archived'), method);
    expect(refusal?.status).toBe(409);
    expect(await refusal!.text()).toBe(ARCHIVED_WRITE_MESSAGE);
  }
});

test('reads are never refused, even while archived', async () => {
  expect(await archivedWriteRefusal(project('archived'), 'GET')).toBeNull();
  expect(await archivedWriteRefusal(project('archived'), 'HEAD')).toBeNull();
});

test('an active repository accepts writes', async () => {
  expect(await archivedWriteRefusal(project('active'), 'POST')).toBeNull();
});
