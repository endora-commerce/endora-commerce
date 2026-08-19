import type { DictionaryReferenceRegistryPort } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * This module's own reference into `currencies` (feature 077, D-87).
 *
 * `countries.default_currency_code` is a foreign key with `on delete set
 * null`, so it is reported but does not block: an operator deleting the
 * currency is blanking a column, not orphaning a row. That decision belongs
 * to this module, which owns the table and wrote the key, which is why it
 * travels on the descriptor rather than in `currencies`' exception list.
 */
export function registerCountryCurrencyReference(
  registry: DictionaryReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'dictionaries',
    consumer: 'countries',
    tableName: 'countries',
    columnName: 'default_currency_code',
    blocking: false,
    countReferences: async (code) => {
      const rows = (await emFactory().execute(
        `select count(*)::int as n from "countries" where "default_currency_code" = ?`,
        [code],
      )) as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    },
    usedCodes: async () =>
      (await emFactory().execute(
        `select "default_currency_code" as code, count(*)::int as count
           from "countries" where "default_currency_code" is not null group by "default_currency_code"`,
      )) as Array<{ code: string; count: number }>,
  });
}
