/**
 * The volatile-table collector — feature 109 R4.2, scheduled as T014 of
 * `specs/134-paid-module-extraction/`.
 *
 * Written before the collector exists, and red against its absence. Its subject
 * is the half of `SEEDED_TABLES` that is a module's own business: 100 of the
 * harness's table names are owned by a module package, and while they are
 * written in one file no module can be composed out of a run without editing
 * that file.
 *
 * Both directions of the refusal are proved, because only the pair is evidence:
 * a set nobody contributed is an empty answer and must be distinguishable from a
 * collector that read nothing, and two modules claiming one table is a question
 * about ownership that "whichever came last" does not answer.
 */
import { describe, expect, it } from 'vitest';

import {
  ConflictingVolatileTableError,
  collectVolatileTables,
  type TestSupportContribution,
} from '../src/support/index.js';

const contribution = (
  moduleId: string,
  volatileTables: readonly string[],
): TestSupportContribution => ({ moduleId, volatileTables });

describe('collectVolatileTables', () => {
  it('is the union of what the composed modules contributed, deduped and sorted', () => {
    const collected = collectVolatileTables([
      contribution('ksef', ['ksef_submissions', 'ksef_credentials']),
      contribution('pim_pimcore', ['pimcore_connections']),
    ]);
    expect(collected).toEqual(['ksef_credentials', 'ksef_submissions', 'pimcore_connections']);
  });

  it('collects nothing from a composition whose modules contribute nothing', () => {
    // The empty answer, and it is a legitimate one: a composition of modules
    // that own no transactional table truncates none. It is asserted so that the
    // refusals below are about a *wrong* input rather than about emptiness.
    expect(collectVolatileTables([])).toEqual([]);
    expect(collectVolatileTables([{ moduleId: 'blog' }])).toEqual([]);
  });

  it('refuses two modules claiming one table rather than letting one of them win', () => {
    // R4.3: a table has one owner, and a contribution over somebody else's table
    // empties rows the other module's tests were relying on. "Whichever was
    // collected last" is not an answer a reader can act on.
    expect(() =>
      collectVolatileTables([
        contribution('pim_ergonode', ['products']),
        contribution('catalog', ['products']),
      ]),
    ).toThrow(ConflictingVolatileTableError);
    expect(() =>
      collectVolatileTables([
        contribution('pim_ergonode', ['products']),
        contribution('catalog', ['products']),
      ]),
    ).toThrow(/'products'.*'pim_ergonode'.*'catalog'/s);
  });

  it('refuses a table name that is not one — a blank, or a quoted identifier', () => {
    // The collected set is interpolated into `truncate table … cascade`, so a
    // name carrying a quote or a semicolon is an injection the collector must
    // refuse at the declaration rather than at the statement.
    expect(() => collectVolatileTables([contribution('ksef', ['  '])])).toThrow(
      /'ksef'.*empty/s,
    );
    expect(() => collectVolatileTables([contribution('ksef', ['a"; drop table b --'])])).toThrow(
      /'ksef'.*a"; drop table b --/s,
    );
  });

  it('lets one module name one table twice without calling it a conflict', () => {
    // A module that lists a table in two places in its own declaration has made
    // no ownership claim it did not already make. Only a *second module* is a
    // conflict, and the discrimination is asserted so the refusal above cannot
    // be satisfied by refusing every duplicate.
    expect(collectVolatileTables([contribution('ksef', ['ksef_submissions', 'ksef_submissions'])])).toEqual([
      'ksef_submissions',
    ]);
  });
});
