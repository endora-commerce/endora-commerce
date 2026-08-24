import type { DictionaryReferenceRegistryPort } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Who in `promotions` still points at a currency (feature 077, D-87).
 *
 * `currencies` used to ask this with `select count(*) from "promotions"` of
 * its own — this module's table, named in a string no import-level boundary
 * check can see. The question is answered here now, against the table this
 * module owns, and pushed into `currencyReferenceRegistry` from the boot
 * hook.
 */
export function registerPromotionCurrencyReferences(
  registry: DictionaryReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'promotions',
    consumer: 'promotions',
    tableName: 'promotions',
    columnName: 'currency',
    blocking: true,
    countReferences: async (code) => {
      const rows = (await emFactory().execute(
        `select count(*)::int as n from "promotions" where "currency" = ?`,
        [code],
      )) as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    },
    usedCodes: async () =>
      (await emFactory().execute(
        `select "currency" as code, count(*)::int as count
           from "promotions" where "currency" is not null group by "currency"`,
      )) as Array<{ code: string; count: number }>,
  });
}
