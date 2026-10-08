import {expect, test} from 'bun:test';
import {resolveMergeMethod, validateMergeMethodPolicy, type MergeMethodPolicy} from '../src/core/merge-method-policy';

const squashOnly: MergeMethodPolicy = {allowMerge: false, allowSquash: true, allowRebase: false, defaultMethod: 'squash'};
const all: MergeMethodPolicy = {allowMerge: true, allowSquash: true, allowRebase: true, defaultMethod: 'merge'};

test('an omitted method uses the repository default, and an enabled method is accepted', () => {
  expect(resolveMergeMethod(all, undefined)).toEqual({ok: true, method: 'merge'});
  expect(resolveMergeMethod(all, 'rebase')).toEqual({ok: true, method: 'rebase'});
  expect(resolveMergeMethod(squashOnly, undefined)).toEqual({ok: true, method: 'squash'});
});

test('a disabled method is refused even when it is requested explicitly', () => {
  expect(resolveMergeMethod(squashOnly, 'merge')).toEqual({ok: false, error: 'merge merges are disabled for this repository'});
  expect(resolveMergeMethod(squashOnly, 'rebase')).toEqual({ok: false, error: 'rebase merges are disabled for this repository'});
});

test('unknown method names and non-text requests are refused', () => {
  expect(resolveMergeMethod(all, 'fast-forward').ok).toBe(false);
  expect(resolveMergeMethod(all, 42).ok).toBe(false);
});

test('a policy that enables no method, or whose default is disabled, is refused', () => {
  expect(validateMergeMethodPolicy({allowMerge: false, allowSquash: false, allowRebase: false, defaultMethod: 'merge'})).toEqual({ok: false, error: 'At least one merge method must be enabled'});
  expect(validateMergeMethodPolicy({allowMerge: true, allowSquash: false, allowRebase: false, defaultMethod: 'squash'})).toEqual({ok: false, error: 'The default merge method must be enabled'});
  expect(resolveMergeMethod({allowMerge: false, allowSquash: false, allowRebase: false, defaultMethod: 'merge'}, undefined).ok).toBe(false);
});
