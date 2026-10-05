import type { SalesChannelAttributionRegistryPort } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * How many Opportunities are attributed to a Sales Channel — the counter
 * `sales_channels` asks before it deletes one.
 *
 * `crm_opportunities.sales_channel_id` is an attribution an administrator sets
 * (or leaves empty), with an `on delete restrict` foreign key. Without this
 * counter the delete guard would not know about it, and the operator would get
 * a raw constraint violation instead of a refusal naming what still points at
 * the channel.
 *
 * **A raw statement, deliberately.** `CrmOpportunity` is organization-scoped,
 * so a count through the entity would take the tenant filter and answer "how
 * many of *this caller's* Opportunities point at the channel". A channel is
 * deleted for everyone, so the question has to be platform-wide; a filtered
 * count would under-report and let a channel go that other tenants'
 * Opportunities still name. The statement reads this module's own table.
 */
export function registerOpportunitySalesChannelAttributions(
  registry: SalesChannelAttributionRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'crm',
    consumer: 'sales opportunity(ies)',
    tableName: 'crm_opportunities',
    columnName: 'sales_channel_id',
    countForChannel: async (salesChannelId) => {
      const em = emFactory();
      const rows = await em.getConnection().execute<Array<{ n: string }>>(
        'select count(*)::text as n from "crm_opportunities" where "sales_channel_id" = ?',
        [salesChannelId],
        'all',
        em.getTransactionContext(),
      );
      return Number(rows[0]?.n ?? '0');
    },
  });
}
