import { expect, test } from 'bun:test';
import { contextCommentRequest, observeContextComments, saveReceipt } from '../src/cli/acceptance';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
test('context request identity survives receipt persistence and differs by subject', async () => {
  const receipt = {version:1 as const,origin:'https://example.com',createdAt:'2026-10-03',tasks:[],agentRuns:[],observations:[],contextCommentRequests:{}};
  const first = contextCommentRequest(receipt,'change:one');
  expect(contextCommentRequest(receipt,'change:one')).toBe(first);
  expect(contextCommentRequest(receipt,'change:two')).not.toBe(first);
  const dir = await mkdtemp(join(tmpdir(),'context-receipt-'));
  try { await saveReceipt(join(dir,'receipt.json'),receipt); const saved = JSON.parse(await readFile(join(dir,'receipt.json'),'utf8')) as typeof receipt; expect(contextCommentRequest(saved,'change:one')).toBe(first); }
  finally { await rm(dir,{recursive:true,force:true}); }
});
test('context observation follows pages and declares complete only at the end', async () => {
  const seen: Array<string|null> = [];
  const result = await observeContextComments('change:one',async cursor => {seen.push(cursor);return cursor ? {comments:[{id:2}],nextCursor:null} : {comments:[{id:1}],nextCursor:'second'};});
  expect(seen).toEqual([null,'second']); expect(result.complete).toBe(true); expect(result.count).toBe(2);
});
test('bounded or interrupted context observations preserve evidence without total claims', async () => {
  let count = 0;
  const bounded = await observeContextComments('change:one',async () => ({comments:[{id:++count}],nextCursor:String(count)}));
  expect(bounded.pages).toBe(5); expect(bounded.complete).toBe(false); expect(bounded.count).toBeNull(); expect(bounded.observedCount).toBe(5);
  let attempt = 0;
  const interrupted = await observeContextComments('change:one',async () => { if (++attempt>1) throw new Error('offline'); return {comments:[{id:8}],nextCursor:'next'}; });
  expect(interrupted.commentIds).toEqual([8]); expect(interrupted.complete).toBe(false); expect(interrupted.count).toBeNull();
});
