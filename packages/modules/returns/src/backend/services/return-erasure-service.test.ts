import { describe, expect, it } from 'vitest';
import { isAlreadyGone } from './return-erasure-service.js';

/**
 * `specs/180-off-platform-complaints/` FR-B43 — an erasure re-run after a rollback meets
 * objects whose bytes it already deleted; the stores say so in their own ways.
 */
describe('isAlreadyGone', () => {
  it('reads a missing object through the store’s wrapping error', () => {
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    expect(isAlreadyGone(Object.assign(new Error('cannot remove'), { cause: enoent }))).toBe(true);
    expect(isAlreadyGone({ cause: { code: 404 } })).toBe(true);
    expect(isAlreadyGone({ cause: { name: 'NoSuchKey' } })).toBe(true);
    expect(isAlreadyGone({ cause: { $metadata: { httpStatusCode: 404 } } })).toBe(true);
  });

  it('does not excuse any other failure', () => {
    expect(isAlreadyGone(new Error('timeout'))).toBe(false);
    expect(isAlreadyGone({ cause: { code: 'EACCES' } })).toBe(false);
    expect(isAlreadyGone({ cause: { statusCode: 503 } })).toBe(false);
    expect(isAlreadyGone(undefined)).toBe(false);
  });
});
