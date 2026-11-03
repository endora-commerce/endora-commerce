import { describe, expect, it } from 'vitest';
import { attributeFilterMatches } from './attribute-filter-match.js';

/**
 * Issue #684 — what one `filter[attr.<key>]` means for one product value, on the
 * page side of the Postgres listing. `#attributeCondition` states the same rule
 * in SQL; `products-list-filtered-paging.test.ts` [PG] holds the two together.
 *
 * A multiselect matches when **any** of its options is among the requested
 * values. It used to be compared as its comma-joined text, so `["a", "b"]`
 * matched neither `a` nor `b`.
 */

describe('attributeFilterMatches', () => {
  it('matches a multiselect holding the requested option among others', () => {
    expect(attributeFilterMatches(['s-146'], ['s-146'])).toBe(true);
    expect(attributeFilterMatches(['steel', 'oak'], ['oak'])).toBe(true);
    expect(attributeFilterMatches(['steel', 'oak'], ['steel'])).toBe(true);
  });

  it('matches a multiselect when any requested value is among its options', () => {
    expect(attributeFilterMatches(['steel', 'oak'], ['plastic', 'oak'])).toBe(true);
    expect(attributeFilterMatches(['steel', 'oak'], ['plastic', 'glass'])).toBe(false);
  });

  it('no longer matches the comma-joined text of a multiselect', () => {
    expect(attributeFilterMatches(['steel', 'oak'], ['steel,oak'])).toBe(false);
    expect(attributeFilterMatches([3.5, 4], ['3.5,4'])).toBe(false);
  });

  it('renders each option as String does', () => {
    const value = [1.5, 2, 1e21, null, true, { a: 1 }];
    for (const wanted of ['1.5', '2', '1e+21', 'null', 'true', '[object Object]']) {
      expect(attributeFilterMatches(value, [wanted]), wanted).toBe(true);
    }
    expect(attributeFilterMatches(value, [''])).toBe(false);
  });

  it('matches nothing for an empty multiselect', () => {
    expect(attributeFilterMatches([], [''])).toBe(false);
    expect(attributeFilterMatches([], ['steel'])).toBe(false);
  });

  it('compares a scalar as String renders it, as before', () => {
    expect(attributeFilterMatches('steel', ['steel'])).toBe(true);
    expect(attributeFilterMatches('steel', ['oak', 'steel'])).toBe(true);
    expect(attributeFilterMatches('steel', ['oak'])).toBe(false);
    expect(attributeFilterMatches(5, ['5'])).toBe(true);
    expect(attributeFilterMatches(1e21, ['1e+21'])).toBe(true);
    expect(attributeFilterMatches(true, ['true'])).toBe(true);
    expect(attributeFilterMatches(null, ['null'])).toBe(true);
    expect(attributeFilterMatches({ finish: 'matte' }, ['[object Object]'])).toBe(true);
  });

  it('matches nothing for a key the product does not carry', () => {
    expect(attributeFilterMatches(undefined, ['undefined'])).toBe(false);
    expect(attributeFilterMatches(undefined, ['null'])).toBe(false);
  });
});
