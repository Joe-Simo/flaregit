import {expect, test} from 'bun:test';
import {MAX_REPOSITORY_TOPICS, normalizeTopics} from '../src/core/repository-topics';

test('valid topics are sorted and de-duplicated', () => {
  expect(normalizeTopics(['typescript', 'agents', 'agents', 'git-hosting', '3d'])).toEqual({ok: true, topics: ['3d', 'agents', 'git-hosting', 'typescript']});
  expect(normalizeTopics([])).toEqual({ok: true, topics: []});
});

test('non-list input and oversized lists are refused', () => {
  expect(normalizeTopics('typescript')).toEqual({ok: false, error: 'Topics must be a list'});
  expect(normalizeTopics(null)).toEqual({ok: false, error: 'Topics must be a list'});
  const tooMany = Array.from({length: MAX_REPOSITORY_TOPICS + 1}, (_, i) => `topic-${i}`);
  expect(normalizeTopics(tooMany).ok).toBe(false);
});

test('uppercase, spaces, leading hyphens, non-strings and over-long topics are refused', () => {
  for (const bad of ['TypeScript', 'two words', '-leading', 'trailing_under', 42, null, 'a'.repeat(51)]) {
    expect(normalizeTopics([bad]).ok).toBe(false);
  }
  expect(normalizeTopics(['a'.repeat(50)]).ok).toBe(true);
});
