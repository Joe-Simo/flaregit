import {expect, test} from 'bun:test';
import {CODE_SEARCH_MAX_MATCHES, CODE_SEARCH_PAGE_SIZE, searchCode, validateCodeSearchQuery} from '../src/core/code-search';

const files = [
  {path: 'src/price.ts', text: 'export const Price = 40;\nconst total = Price * 2;', access: 'members' as const},
  {path: 'private/keys.ts', text: 'const secret = "price-token";', access: 'owner' as const},
  {path: 'README.md', text: 'Price list\nnothing else', access: 'members' as const},
];

test('a search matches case-insensitively, reports line numbers, and returns a complete result for a small tree', () => {
  const result = searchCode({files, query: 'PRICE', actor: {role: 'member'}});
  expect(result).toEqual({
    ok: true,
    matches: [
      {path: 'README.md', line: 1, text: 'Price list'},
      {path: 'src/price.ts', line: 1, text: 'export const Price = 40;'},
      {path: 'src/price.ts', line: 2, text: 'const total = Price * 2;'},
    ],
    nextCursor: null,
    complete: true,
    reason: null,
    scannedFiles: 2,
  });
});

test('owner-only files are never searched or returned to a member, and a non-member sees nothing', () => {
  const member = searchCode({files, query: 'secret', actor: {role: 'member'}});
  expect(member.ok && member.matches).toEqual([]);
  expect(member.ok && member.complete).toBe(true);
  const owner = searchCode({files, query: 'secret', actor: {role: 'owner'}});
  expect(owner.ok && owner.matches.map((match) => match.path)).toEqual(['private/keys.ts']);
  const outsider = searchCode({files, query: 'price', actor: {role: null}});
  expect(outsider.ok && outsider.scannedFiles).toBe(0);
});

test('results are paged with a cursor and every page is reported as incomplete until the last one', () => {
  const many = [{path: 'big.txt', text: Array.from({length: CODE_SEARCH_PAGE_SIZE + 5}, () => 'hit').join('\n'), access: 'members' as const}];
  const first = searchCode({files: many, query: 'hit', actor: {role: 'member'}});
  if (!first.ok) throw new Error('setup failed');
  expect(first.matches.length).toBe(CODE_SEARCH_PAGE_SIZE);
  expect(first.complete).toBe(false);
  expect(first.nextCursor).toBe(String(CODE_SEARCH_PAGE_SIZE));
  const second = searchCode({files: many, query: 'hit', actor: {role: 'member'}, cursor: first.nextCursor});
  if (!second.ok) throw new Error('setup failed');
  expect(second.matches.length).toBe(5);
  expect(second.nextCursor).toBeNull();
  expect(second.complete).toBe(true);
});

test('a search over the match cap says it is truncated instead of reporting a complete result', () => {
  const huge = [{path: 'huge.txt', text: Array.from({length: CODE_SEARCH_MAX_MATCHES + 10}, () => 'needle').join('\n'), access: 'members' as const}];
  const result = searchCode({files: huge, query: 'needle', actor: {role: 'member'}});
  if (!result.ok) throw new Error('setup failed');
  expect(result.complete).toBe(false);
  expect(result.reason).toBe(`Only the first ${CODE_SEARCH_MAX_MATCHES} matches are returned; narrow the query`);
});

test('empty, over-long and non-text queries and invalid cursors are refused', () => {
  expect(validateCodeSearchQuery('   ').ok).toBe(false);
  expect(validateCodeSearchQuery(42).ok).toBe(false);
  expect(validateCodeSearchQuery('x'.repeat(201)).ok).toBe(false);
  expect(searchCode({files, query: 'price', actor: {role: 'member'}, cursor: '-1'}).ok).toBe(false);
  expect(searchCode({files, query: 'price', actor: {role: 'member'}, cursor: 'abc'}).ok).toBe(false);
});
