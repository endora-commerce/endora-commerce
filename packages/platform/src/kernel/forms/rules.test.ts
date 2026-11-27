import { describe, expect, it } from 'vitest';
import { byCodePoint } from './rules.js';

/**
 * `specs/193-admin-form-extensions/` D-300.14: every sort of the seal and the
 * effective forms is by code point, so the order does not depend on the
 * machine's locale data.
 */
describe('byCodePoint (193 D-300.14)', () => {
  it('orders by code point, where localeCompare would not', () => {
    const values = ['b', 'B', '_a', 'a', 'acme_ui', 'acmeb'];
    expect([...values].sort(byCodePoint)).toEqual(['B', '_a', 'a', 'acme_ui', 'acmeb', 'b']);
    expect([...values].sort((x, y) => x.localeCompare(y, 'en'))).not.toEqual([...values].sort(byCodePoint));
  });

  it('answers 0 for equal identifiers', () => {
    expect(byCodePoint('widget', 'widget')).toBe(0);
  });
});
