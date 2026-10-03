import { expect, test } from 'bun:test';
import { repositoryDeletionNotice } from '../src/web/repository-deletion-notice';
test('explicit owner deletion notice displays its detail and recovery permission', () => {
  expect(repositoryDeletionNotice(JSON.stringify({status:'deleting',detail:'Cleanup is pending.',canInspectStorage:true}))).toEqual({detail:'Cleanup is pending.',canInspectStorage:true});
});
test('member notices display human detail without owner controls', () => {
  for (const permission of [undefined, false, 'true', 1]) expect(repositoryDeletionNotice(JSON.stringify({status:'deleting',detail:'Cleanup is pending.',canInspectStorage:permission}))).toEqual({detail:'Cleanup is pending.',canInspectStorage:false});
});
test('arbitrary errors do not create storage recovery controls', () => {
  for (const message of ['Not found','Network error','Account deletion is in progress', '{"status":"active","detail":"deleting"}', '{"status":"deleting","detail":null}', '{"status":"deleting","detail":""}', '[]','null','{"status":"deleting","detail":{}}']) expect(repositoryDeletionNotice(message)).toBeNull();
});
