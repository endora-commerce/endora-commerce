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
 * **The column this counts is populated since issue #266.** Feature 005 /
 * FR-012 added `quote_requests.sales_channel_id` nullable in
 * `20260430T170044_core_sales_channels_promote`, with an `on delete restrict`
 * foreign key, and neither half of what was supposed to follow ever landed: no
 * property on `QuoteRequest`, so nothing on the request path wrote the column,
 * and no migration flipping it `not null`. This counter therefore answered `0`
 * for every request ever raised and the FR-006 delete guard had never seen an
 * RFQ attribution. `QuoteRequest.salesChannelId` now carries the resolved
 * request channel, so the guard reads real evidence.
 *
 * **The count stays a raw statement, and not because the property is missing.**
 * `QuoteRequest` is `@OrgScoped`, so an `em.count` would take the always-on
 * tenant filter and answer "how many of *this tenant's* requests point at the
 * channel". The delete guard is platform-wide — a channel is deleted for
 * everyone — so the question it asks has to be too, and a filtered count would
 * silently under-report and let an operator delete a channel other tenants'
 * requests still point at. The statement names this module's own table, so the
 * boundary check has nothing to object to.
 *
 * **Rows raised before #266 stay `null` on the owner's ruling** and are counted
 * by nobody; they are developer data, and projecting them onto the system
 * default would have this guard refuse a delete on an attribution the platform
 * invented rather than observed.
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
