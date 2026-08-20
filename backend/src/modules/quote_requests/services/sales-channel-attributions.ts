import type { SalesChannelAttributionRegistryPort } from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * How many quote requests are attributed to a sales channel (feature 075, D-87
 * drain).
 *
 * `SalesChannelsService.delete` used to count them itself, with
 * `select count(*) from "quote_requests" where "sales_channel_id" = ?` — this
 * module's table and this module's column name, spelled in another module's
 * service and invisible to the import-level boundary check because raw SQL
 * names no specifier. It is answered here now.
 *
 * **The count is a raw statement rather than an entity read because this
 * module's entity does not map the column, and that is a defect this drain
 * moved rather than fixed.** Feature 005 / FR-012 added
 * `quote_requests.sales_channel_id` nullable in
 * `20260430T170044_core_sales_channels_promote`, with an `on delete restrict`
 * foreign key, and neither half of what was supposed to follow ever landed: no
 * property on `QuoteRequest`, so nothing on the request path has ever
 * written the column, and no migration flipping it `not null`. Every request
 * created since carries `null`, so this counter answers `0` for all of them and
 * the FR-006 delete guard has never seen an RFQ attribution. Recording the
 * channel an RFQ was raised on is this module's work and needs its own change;
 * the counter is written against the column that exists so that the day the
 * column is populated — including by rows a legacy backfill already filled —
 * the guard is already asking the right module.
 */
export function registerQuoteRequestSalesChannelAttributions(
  registry: SalesChannelAttributionRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'quote_requests',
    consumer: 'quote request(s)',
    tableName: 'quote_requests',
    columnName: 'sales_channel_id',
    countForChannel: async (salesChannelId) => {
      const em = emFactory();
      const rows = await em.getConnection().execute<Array<{ n: string }>>(
        'select count(*)::text as n from "quote_requests" where "sales_channel_id" = ?',
        [salesChannelId],
        'all',
        em.getTransactionContext(),
      );
      return Number(rows[0]?.n ?? '0');
    },
  });
}
