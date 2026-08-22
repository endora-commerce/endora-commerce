import type { AuditReferenceRegistryPort } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Warehouse } from '../entities/warehouse.entity.js';

/**
 * What a `warehouse` audit row is called, and where the admin app shows it
 * (feature 075, D-87 drain).
 *
 * This is the contribution the inversion was chosen for. `inventory` is the one
 * contributor to `auditReferenceRegistry` whose manifest declares no
 * `activation.nonDeactivatable`, so it is the one an operator can switch off —
 * and `audit_logs` is non-deactivatable, so had it declared this module as a
 * dependency to read a warehouse name, the lifecycle would have refused every
 * attempt to switch this one off. A push costs the operator nothing.
 */
export function registerInventoryAuditReferences(
  registry: AuditReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'inventory',
    referenceType: 'warehouse',
    resolve: async (ids) => {
      const rows = await emFactory().find(
        Warehouse,
        { id: { $in: [...ids] } },
        { fields: ['id', 'name', 'code'] },
      );
      return rows.map((row) => ({
        id: row.id,
        label: row.name.length > 0 ? row.name : row.code,
        url: `/warehouses/${row.id}`,
      }));
    },
  });
}
