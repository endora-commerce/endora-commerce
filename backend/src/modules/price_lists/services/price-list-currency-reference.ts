import type { DictionaryReferenceRegistryPort } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Who in `price_lists` still points at a currency (feature 077, D-87).
 *
 * `currencies` used to ask this with `select count(*) from "price_lists"` of
 * its own — this module's table, named in a string no import-level boundary
 * check can see. A price list denominated in a currency the platform no
 * longer has is not a price list, so the reference blocks the delete.
 */
export function registerPriceListCurrencyReferences(
  registry: DictionaryReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'price_lists',
    consumer: 'price_lists',
    tableName: 'price_lists',
    columnName: 'currency',
    blocking: true,
    countReferences: async (code) => {
      const rows = (await emFactory().execute(
        `select count(*)::int as n from "price_lists" where "currency" = ?`,
        [code],
      )) as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    },
    usedCodes: async () =>
      (await emFactory().execute(
        `select "currency" as code, count(*)::int as count
           from "price_lists" where "currency" is not null group by "currency"`,
      )) as Array<{ code: string; count: number }>,
  });
}
