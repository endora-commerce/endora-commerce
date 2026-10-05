import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditReferenceRegistryPort } from '@endora-commerce/contracts';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';

/**
 * What a `crm_opportunity` audit row is called, and where the admin shows it.
 *
 * Every Command of this module is recorded against `crm_opportunity` and the
 * Opportunity's id, so the dashboard's recent activity names an Opportunity by
 * its title and links to its screen through this one resolver.
 *
 * It reads this module's own table and nothing else, **through the scoped
 * EntityManager**: a reader who may not see an Opportunity gets no title for it
 * — the audit row falls back to its snapshot and renders no link.
 *
 * `crm` is operator-switchable, and `audit_logs` is not; the registry skips a
 * contributor that is not effectively present, which is why this is a push and
 * not a port `audit_logs` resolves.
 */
export function registerCrmAuditReferences(
  registry: AuditReferenceRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'crm',
    referenceType: 'crm_opportunity',
    resolve: async (ids) => {
      const rows = await emFactory().find(
        CrmOpportunity,
        { id: { $in: [...ids] } },
        { fields: ['id', 'title', 'number'] },
      );
      return rows.map((row) => ({
        id: row.id,
        label: row.title.length > 0 ? row.title : row.number,
        url: `/crm/opportunities/${row.id}`,
      }));
    },
  });
}
