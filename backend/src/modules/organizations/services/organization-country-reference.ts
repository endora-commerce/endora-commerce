import type { DictionaryReferenceRegistryPort } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Who in `organizations` still points at a country (feature 077, D-87).
 *
 * The country sits inside the `registered_address` JSONB column, which is
 * why `dictionaries` used to reach for `->>'country'` against this module's
 * table directly. The path lives here now, next to the column it is about.
 */
export function registerOrganizationCountryReferences(
  registry: DictionaryReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'organizations',
    consumer: 'organizations',
    tableName: 'organizations',
    columnName: 'registered_address.country',
    blocking: true,
    countReferences: async (code) => {
      const rows = (await emFactory().execute(
        `select count(*)::int as n from "organizations" where "registered_address"->>'country' = ?`,
        [code],
      )) as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    },
    usedCodes: async () =>
      (await emFactory().execute(
        `select "registered_address"->>'country' as code, count(*)::int as count
           from "organizations" where "registered_address"->>'country' is not null
          group by "registered_address"->>'country'`,
      )) as Array<{ code: string; count: number }>,
  });
}
