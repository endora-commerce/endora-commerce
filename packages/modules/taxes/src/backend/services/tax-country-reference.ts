import type { DictionaryReferenceRegistryPort } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Who in `taxes` still points at a country (feature 077, D-87).
 *
 * `dictionaries` used to count this table itself and join it a second time
 * for the orphan report, naming it in strings no import-level boundary check
 * can see. A tax rule is scoped by country, so a country the platform drops
 * leaves the rule unapplicable.
 */
export function registerTaxCountryReferences(
  registry: DictionaryReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'taxes',
    consumer: 'taxes',
    tableName: 'taxes',
    columnName: 'country',
    blocking: true,
    countReferences: async (code) => {
      const rows = (await emFactory().execute(
        `select count(*)::int as n from "taxes" where "country" = ?`,
        [code],
      )) as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    },
    usedCodes: async () =>
      (await emFactory().execute(
        `select "country" as code, count(*)::int as count
           from "taxes" where "country" is not null group by "country"`,
      )) as Array<{ code: string; count: number }>,
  });
}
