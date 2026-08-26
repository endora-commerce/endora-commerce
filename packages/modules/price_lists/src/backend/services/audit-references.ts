import type { AuditReferenceRegistryPort } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PriceList } from '../entities/price-list.entity.js';

/**
 * What a `price_list` audit row is called, and where the admin app shows it
 * (feature 075, D-87 drain).
 *
 * `audit_logs` used to run `select id, name, code from price_lists` and spell
 * `/price-lists/{id}` into its own switch statement.
 */
export function registerPriceListAuditReferences(
  registry: AuditReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'price_lists',
    referenceType: 'price_list',
    resolve: async (ids) => {
      const rows = await emFactory().find(
        PriceList,
        { id: { $in: [...ids] } },
        { fields: ['id', 'name', 'code'] },
      );
      return rows.map((row) => ({
        id: row.id,
        label: row.name.length > 0 ? row.name : row.code,
        url: `/price-lists/${row.id}`,
      }));
    },
  });
}
