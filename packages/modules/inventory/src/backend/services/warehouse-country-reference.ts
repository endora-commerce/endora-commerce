import type { DictionaryReferenceRegistryPort } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Who in `inventory` still points at a country (feature 077, D-87).
 *
 * `dictionaries` joined `warehouses` for its orphan report but deliberately
 * counted **zero** of them before a delete: the country is inside the
 * `address` JSONB column, and its comment said covering that path "requires
 * a separate scan that v1 of the Dictionary feature defers". The scan is one
 * expression against a table this module owns, so moving the question to the
 * module that can answer it closed the gap as a side effect.
 */
export function registerWarehouseCountryReferences(
  registry: DictionaryReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'inventory',
    consumer: 'warehouses',
    tableName: 'warehouses',
    columnName: 'address.countryCode',
    blocking: true,
    countReferences: async (code) => {
      const rows = (await emFactory().execute(
        `select count(*)::int as n from "warehouses" where "address"->>'countryCode' = ?`,
        [code],
      )) as Array<{ n: number }>;
      return rows[0]?.n ?? 0;
    },
    usedCodes: async () =>
      (await emFactory().execute(
        `select "address"->>'countryCode' as code, count(*)::int as count
           from "warehouses" where "address"->>'countryCode' is not null
          group by "address"->>'countryCode'`,
      )) as Array<{ code: string; count: number }>,
  });
}
