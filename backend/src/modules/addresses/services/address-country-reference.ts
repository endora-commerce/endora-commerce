import type { DictionaryReferenceRegistryPort } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Who in `addresses` still points at a country (feature 077, D-87).
 *
 * `dictionaries` used to count this table itself and join it a second time
 * for the orphan report, naming it in strings no import-level boundary check
 * can see. An address with a country the platform does not have cannot be
 * validated or rendered, so the reference blocks the delete.
 */
export function registerAddressCountryReferences(
  registry: DictionaryReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'addresses',
    consumer: 'addresses',
    tableName: 'addresses',
    columnName: 'country',
    blocking: true,
    countReferences: async (code) => {
      const rows = (await emFactory().execute(
        `select count(*)::int as n from "addresses" where "country" = ?`,
        [code],
      )) as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    },
    usedCodes: async () =>
      (await emFactory().execute(
        `select "country" as code, count(*)::int as count
           from "addresses" where "country" is not null group by "country"`,
      )) as Array<{ code: string; count: number }>,
  });
}
