import { describe, expect, it } from 'vitest';
import { isDraftEqual } from '@endora-commerce/admin-kit/lib';

/** Issue #1446 (DS-13) — the comparison an editor's `dirty` is computed with. */
describe('isDraftEqual', () => {
  it('ignores key order and undefined-valued keys, as JSON does', () => {
    expect(isDraftEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(isDraftEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });

  it('sees a changed value, a changed array order and a type change', () => {
    expect(isDraftEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(isDraftEqual([1, 2], [2, 1])).toBe(false);
    expect(isDraftEqual({ a: [] }, { a: {} })).toBe(false);
    expect(isDraftEqual({ a: null }, { a: undefined })).toBe(false);
    expect(isDraftEqual('', null)).toBe(false);
  });
});
