import { describe, expect, it } from 'vitest';
import {
  isProductEffectivelyAvailable,
  type ProductAudience,
  type ProductVisibility,
} from '@endora-commerce/contracts';
import { availabilityFilter, documentAvailabilityFields } from './search-availability.js';

/**
 * Feature 163 (T048, R8) — what a channel index document carries about
 * availability, and the filter a query adds, so a product off at (C, L), outside
 * its window or outside the effective audience never reaches the hit list the
 * page is cut from (issue #151). Asserted here as a pure evaluation of the
 * filter against the document; the Meilisearch round trip is
 * `backend/test/integration/search/scoped-availability.test.ts` [PG].
 */

const NOW = Date.parse('2031-06-15T12:00:00.000Z');
const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/**
 * A tiny evaluator for the filter grammar this module emits — `=`, `!=`, `<=`,
 * `>=`, `IS EMPTY`, `EXISTS`, `NOT EXISTS`, `AND`, `OR`, parentheses — so the
 * filter can be checked against the rule without a search engine.
 */
function matches(filter: string, doc: object): boolean {
  const tokens = filter.match(/\(|\)|"[^"]*"|[^\s()]+/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++]!;
  const value = (t: string): string => (t.startsWith('"') ? t.slice(1, -1) : t);
  const atom = (): boolean => {
    if (peek() === '(') {
      next();
      const v = or();
      next();
      return v;
    }
    const field = next();
    const op = next();
    const actual = (doc as Record<string, unknown>)[field];
    if (op === 'IS') {
      next(); // EMPTY
      return Array.isArray(actual) && actual.length === 0;
    }
    if (op === 'EXISTS') return actual !== undefined;
    if (op === 'NOT') {
      next(); // EXISTS
      return actual === undefined;
    }
    const rhs = value(next());
    // Meilisearch: `!=` also matches a document without the field.
    if (actual === undefined) return op === '!=';
    if (op === '=') return Array.isArray(actual) ? actual.map(String).includes(rhs) : String(actual) === rhs;
    if (op === '!=') return Array.isArray(actual) ? !actual.map(String).includes(rhs) : String(actual) !== rhs;
    if (op === '<=') return Number(actual) <= Number(rhs);
    if (op === '>=') return Number(actual) >= Number(rhs);
    throw new Error(`unknown operator ${op}`);
  };
  const and = (): boolean => {
    let v = atom();
    while (peek() === 'AND') {
      next();
      const r = atom();
      v = v && r;
    }
    return v;
  };
  const or = (): boolean => {
    let v = and();
    while (peek() === 'OR') {
      next();
      const r = and();
      v = v || r;
    }
    return v;
  };
  return or();
}

const BUYERS: ProductAudience[] = [
  { organizationId: null, authenticated: false },
  { organizationId: null, authenticated: true },
  { organizationId: ORG, authenticated: true },
];

describe('availabilityFilter × documentAvailabilityFields ≡ the rule', () => {
  const visibilities: ProductVisibility[] = ['public', 'logged_in_only', 'organization_restricted'];
  const lists: string[][] = [[], [ORG], [OTHER], [OTHER, ORG]];
  const windows: Array<{ from: Date | null; until: Date | null }> = [
    { from: null, until: null },
    { from: new Date(NOW), until: null },
    { from: new Date(NOW + 1), until: null },
    { from: null, until: new Date(NOW) },
    { from: null, until: new Date(NOW - 1) },
  ];
  const live: string[][] = [['pl-PL'], ['de-DE'], ['pl-PL', 'de-DE']];

  it('admits exactly what isProductEffectivelyAvailable admits, for every audience, window and live set', () => {
    let admitted = 0;
    let refused = 0;
    for (const visibility of visibilities) {
      for (const allowedOrganizationIds of lists) {
        for (const window of windows) {
          for (const liveLanguages of live) {
            const doc = documentAvailabilityFields({
              liveLanguages,
              window,
              audience: { visibility, allowedOrganizationIds },
            });
            for (const audience of BUYERS) {
              const want = isProductEffectivelyAvailable({
                global: {
                  status: liveLanguages.includes('pl-PL') ? 'active' : 'inactive',
                  deletedAt: null,
                  archivedAt: null,
                  window,
                  visibility,
                  allowedOrganizationIds,
                  minOrderQuantity: null,
                  returnable: true,
                },
                isMember: true,
                channel: { id: 'c', languages: ['pl-PL', 'de-DE'], defaultLanguage: 'pl-PL' },
                languageCode: 'pl-PL',
                audience,
                now: new Date(NOW),
              });
              const got = matches(availabilityFilter({ languageCode: 'pl-PL', audience, nowMs: NOW }), doc);
              expect(got, JSON.stringify({ visibility, allowedOrganizationIds, window, liveLanguages, audience })).toBe(want);
              if (want) admitted += 1;
              else refused += 1;
            }
          }
        }
      }
    }
    expect(admitted).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });

  it('serves a document indexed before the deploy (no availability fields) on the global visibility, as before (R8)', () => {
    const legacy = { visibility: 'public' };
    expect(matches(availabilityFilter({ languageCode: 'pl-PL', audience: BUYERS[0]!, nowMs: NOW }), legacy)).toBe(true);
    const restricted = { visibility: 'organization_restricted' };
    expect(matches(availabilityFilter({ languageCode: 'pl-PL', audience: BUYERS[2]!, nowMs: NOW }), restricted)).toBe(false);
  });

  it('quotes the language and the organisation, never splicing raw input', () => {
    const filter = availabilityFilter({
      languageCode: 'pl"PL',
      audience: { organizationId: 'x" OR visibility = "public', authenticated: true },
      nowMs: NOW,
    });
    expect(filter).toContain('liveLanguages = "pl\\"PL"');
    expect(filter).toContain('allowedOrganizationIds = "x\\" OR visibility = \\"public"');
  });
});
