import { expect, test } from 'bun:test';
import { creationRejectedBeforeAllocation, repositoryRequestSignal } from '../src/web/repo-request';
test('repository reads and mutations retain navigation cancellation', () => {
 const lifetime = new AbortController();
 const read = repositoryRequestSignal(lifetime.signal);
 const write = repositoryRequestSignal(lifetime.signal, true);
 expect(read.aborted).toBe(false);expect(write.aborted).toBe(false);
 lifetime.abort();expect(read.aborted).toBe(true);expect(write.aborted).toBe(true);
});
test('only definite pre-allocation validation or authorization rejections allow corrected creation', () => {
 for(const status of [400,401,403,422])expect(creationRejectedBeforeAllocation(status)).toBe(true);
 for(const status of [0,200,201,202,409,429,500,502,503,504])expect(creationRejectedBeforeAllocation(status)).toBe(false);
});
