import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Country } from '../../../src/modules/dictionaries/entities/country.entity.js';
import { DictionaryTranslation } from '../../../src/modules/dictionaries/entities/dictionary-translation.entity.js';
import { DictionaryReadService } from '../../../src/modules/dictionaries/services/dictionary-read-service.js';
import { dictionaryReadPortsFor } from '../../helpers/dictionary-services.js';

/**
 * Issue #142 — the cold registry build is a constant number of round trips.
 *
 * The build used to resolve one label per entry, and each resolution issued its
 * own canonical lookup plus a translation lookup plus a fallback-language
 * lookup: ~170 sequential statements over a 72-entry registry, all of them on
 * one connection, which is what put the cold p95 over its own budget.
 *
 * The property this test pins is not "fewer queries" but "a count that does not
 * grow with the dictionary": it measures the same read twice, once over the
 * seeded reference data and once with 40 more countries and their translations
 * added, and requires the two counts to be equal. A count that tracks the row
 * count is the defect, whatever its absolute value.
 */

/** Statements one cold build is allowed to issue, whatever the dictionary holds. */
const COLD_BUILD_STATEMENT_CEILING = 7;

/** Extra ISO alpha-2 codes the seed does not use, so the fixture collides with nothing. */
const EXTRA_COUNTRY_CODES = Array.from({ length: 40 }, (_, i) =>
  i < 20 ? `Q${String.fromCharCode(65 + i)}` : `X${String.fromCharCode(65 + (i - 20))}`,
).filter((code) => code !== 'XK');

describe('dictionary registry — cold build round trips (issue #142)', () => {
  let h: BackendServerHandle;
  let service: DictionaryReadService;

  beforeAll(async () => {
    h = await setupBackendServer();
    // No cache: every read is a cold build, which is the path under test.
    //
    // Feature 075, Phase C — the currency and language rows come from their
    // owners' read ports now. Both run on the same connection this test counts
    // statements on, and each port call is one statement, so the ceiling below
    // still measures the whole build.
    const ports = dictionaryReadPortsFor(() => h.em());
    service = new DictionaryReadService(() => h.em(), ports.currencies, ports.languages, undefined);
  }, 60_000);

  afterAll(async () => {
    const conn = h.em().getConnection();
    const placeholders = EXTRA_COUNTRY_CODES.map(() => '?').join(',');
    await conn.execute(
      `delete from "dictionary_translations" where "entry_type" = 'country' ` +
        `and "entry_code" in (${placeholders})`,
      EXTRA_COUNTRY_CODES,
      'run',
    );
    await conn.execute(
      `delete from "countries" where "code" in (${placeholders})`,
      EXTRA_COUNTRY_CODES,
      'run',
    );
    await teardownBackendServer(h);
  });

  /** Statements the read issued, counted on the shared knex connection. */
  async function roundTripsFor<T>(run: () => Promise<T>): Promise<{ result: T; queries: number }> {
    const knex: Knex = h.em().getConnection().getKnex();
    let queries = 0;
    const onQuery = (): void => {
      queries += 1;
    };
    knex.on('query', onQuery);
    try {
      const result = await run();
      return { result, queries };
    } finally {
      knex.off('query', onQuery);
    }
  }

  it('issues the same number of statements for a bigger dictionary', async () => {
    const before = await roundTripsFor(() => service.getRegistry({ locale: 'pl-PL' }));
    const baselineEntries = entriesOf(before.result);
    // The measurement is worth nothing over an empty registry (issue #140): the
    // seeded reference data is what the N+1 multiplied.
    expect(baselineEntries).toBeGreaterThanOrEqual(50);
    expect(before.queries).toBeGreaterThan(0);
    // The channel, the four registry tables, the language table the fallback
    // chain is walked in, and the translations. Raising this ceiling means a
    // statement was added to the build, so say so deliberately.
    expect(before.queries).toBeLessThanOrEqual(COLD_BUILD_STATEMENT_CEILING);

    const em = h.em();
    for (const [index, code] of EXTRA_COUNTRY_CODES.entries()) {
      em.persist(
        em.create(Country, {
          code,
          alpha3Code: `Z${code}`,
          numericCode: String(900 + index).slice(0, 3),
          label: `Bench country ${code}`,
          region: 'Europe',
          isActive: true,
          sortOrder: 900 + index,
        }),
      );
      // Half of them carry a `pl-PL` translation and half fall back, so both
      // branches of the resolver are represented in the bigger dictionary.
      if (index % 2 === 0) {
        em.persist(
          em.create(DictionaryTranslation, {
            entryType: 'country',
            entryCode: code,
            languageCode: 'pl-PL',
            label: `Kraj ${code}`,
          }),
        );
      }
    }
    await em.flush();

    const after = await roundTripsFor(() => service.getRegistry({ locale: 'pl-PL' }));
    process.stdout.write(
      `[dictionary cold build] entries ${baselineEntries} -> ${entriesOf(after.result)}, ` +
        `statements ${before.queries} -> ${after.queries}\n`,
    );
    expect(entriesOf(after.result)).toBe(baselineEntries + EXTRA_COUNTRY_CODES.length);
    expect(after.queries).toBe(before.queries);
  }, 60_000);
});

function entriesOf(registry: {
  data: { countries: unknown[]; currencies: unknown[]; languages: unknown[] };
}): number {
  const { countries, currencies, languages } = registry.data;
  return countries.length + currencies.length + languages.length;
}
