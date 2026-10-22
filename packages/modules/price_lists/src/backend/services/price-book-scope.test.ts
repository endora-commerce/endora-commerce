import { describe, expect, it } from 'vitest';
import {
  audienceKindWritable,
  bookVisible,
  bookWritable,
  organizationInScope,
  visibleBookSql,
  type PriceBookScope,
} from './price-book-scope.js';

/**
 * Feature 160 (FR-034) — a representative's reach over price books: an
 * organization book exists for them only when every member is in scope;
 * everyone and customer-group books are visible and read-only; a platform
 * administrator reaches everything.
 */
const ALL: PriceBookScope = { all: true, organizationIds: new Set() };
const REP: PriceBookScope = { all: false, organizationIds: new Set(['a']) };

const book = (audienceKind: 'everyone' | 'customer_groups' | 'organizations', organizationIds: string[] = [], isSystem = false) => ({
  audienceKind,
  organizationIds,
  isSystem,
});

describe('price-book scope (feature 160)', () => {
  it('A3.1 / A3.2 — an organization book is visible only with every member in scope', () => {
    expect(bookVisible(REP, book('organizations', ['a']))).toBe(true);
    expect(bookVisible(REP, book('organizations', ['a', 'b']))).toBe(false);
    expect(bookVisible(REP, book('organizations', ['b']))).toBe(false);
    expect(bookVisible(ALL, book('organizations', ['b']))).toBe(true);
  });

  it('A3.3 — everyone, customer-group and base books are visible and read-only for a representative', () => {
    for (const b of [book('everyone'), book('customer_groups'), book('everyone', [], true)]) {
      expect(bookVisible(REP, b)).toBe(true);
      expect(bookWritable(REP, b)).toBe(false);
      expect(bookWritable(ALL, b)).toBe(true);
    }
    expect(bookWritable(REP, book('organizations', ['a']))).toBe(true);
    expect(audienceKindWritable(REP, 'everyone')).toBe(false);
    expect(audienceKindWritable(REP, 'organizations')).toBe(true);
  });

  it('A4 — only organizations in scope may be named', () => {
    expect(organizationInScope(REP, 'a')).toBe(true);
    expect(organizationInScope(REP, 'b')).toBe(false);
    expect(organizationInScope(ALL, 'b')).toBe(true);
  });

  it('the list predicate is absent for a platform administrator and binds the scope otherwise', () => {
    expect(visibleBookSql(ALL)).toBeNull();
    expect(visibleBookSql(REP)).toMatchObject({ params: ['{a}'] });
  });
});
