import {expect, test} from 'bun:test';
import {addDraftComment, publishDrafts, resolveThread, visibleComments, type ReviewThread} from '../src/core/review-threads';

const start = (authorId: string, body: unknown = 'Check this', path = 'src/app.ts', line = 3) =>
  addDraftComment([], {path, line, authorId, body});

test('a draft starts a thread anchored to a path and line, and stays private to its author until published', () => {
  const started = start('alice');
  if (!started.ok) throw new Error('setup failed');
  const thread = started.thread;
  expect(thread.path).toBe('src/app.ts');
  expect(thread.line).toBe(3);
  expect(visibleComments(thread, 'alice').length).toBe(1);
  expect(visibleComments(thread, 'bob')).toEqual([]);
  expect(visibleComments(thread, null)).toEqual([]);
  const published = publishDrafts(thread, 'alice');
  if (!published.ok) throw new Error('setup failed');
  expect(visibleComments(published.thread, 'bob').length).toBe(1);
});

test('publishing publishes only the given author’s drafts, leaving other authors’ drafts private', () => {
  const alice = start('alice');
  if (!alice.ok) throw new Error('setup failed');
  const bob = addDraftComment([alice.thread], {threadId: alice.thread.id, authorId: 'bob', body: 'Agreed'});
  if (!bob.ok) throw new Error('setup failed');
  const publishedAlice = publishDrafts(bob.thread, 'alice');
  if (!publishedAlice.ok) throw new Error('setup failed');
  expect(visibleComments(publishedAlice.thread, 'carol').map((comment) => comment.authorId)).toEqual(['alice']);
  expect(visibleComments(publishedAlice.thread, 'bob').map((comment) => comment.authorId)).toEqual(['alice', 'bob']);
  expect(publishDrafts(publishedAlice.thread, 'alice').ok).toBe(false);
});

test('empty comments, oversized comments, traversal paths, bad lines and unknown threads are refused', () => {
  expect(start('alice', '   ').ok).toBe(false);
  expect(start('alice', 42).ok).toBe(false);
  expect(start('alice', 'x'.repeat(65537)).ok).toBe(false);
  expect(start('alice', 'ok', '../secret').ok).toBe(false);
  expect(start('alice', 'ok', '/etc/passwd').ok).toBe(false);
  expect(start('alice', 'ok', 'src/app.ts', 0).ok).toBe(false);
  expect(start('alice', 'ok', 'src/app.ts', 1.5).ok).toBe(false);
  expect(addDraftComment([], {threadId: 'thread-9', path: 'a', line: 1, authorId: 'alice', body: 'x'}).ok).toBe(false);
});

test('only a participant who has published can resolve a thread, and only once', () => {
  const alice = start('alice');
  if (!alice.ok) throw new Error('setup failed');
  const draftOnly = alice.thread as ReviewThread;
  expect(resolveThread(draftOnly, 'alice')).toEqual({ok: false, error: 'Only a participant can resolve a thread'});
  const published = publishDrafts(draftOnly, 'alice');
  if (!published.ok) throw new Error('setup failed');
  const resolved = resolveThread(published.thread, 'bob');
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) throw new Error('setup failed');
  expect(resolved.thread.resolved).toBe(true);
  expect(resolveThread(resolved.thread, 'alice')).toEqual({ok: false, error: 'The thread is already resolved'});
});
