import type { SalesChannelAttributionRegistryPort } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Order } from '../entities/order.entity.js';

/**
 * How many orders are attributed to a sales channel (feature 075, D-87 drain).
 *
 * `SalesChannelsService.delete` used to count them itself, with
 * `select count(*) from "orders" where "sales_channel_id" = ?` — this module's
 * table and this module's column name, spelled in another module's service and
 * invisible to the import-level boundary check because raw SQL names no
 * specifier. It is answered here now, over this module's own entity.
 *
 * The count is what refuses the delete, so it has to be right rather than
 * cheap: `orders.sales_channel_id` is `not null` and carries **no** foreign key,
 * so nothing under this guard would stop an operator from orphaning every order
 * on a channel. The index on the column is what keeps it a point query.
 */
export function registerOrderSalesChannelAttributions(
  registry: SalesChannelAttributionRegistryPort,
  emFactory: () => EntityManager,
): void {
  registry.register({
    ownerModuleId: 'orders',
    consumer: 'order(s)',
    tableName: 'orders',
    columnName: 'sales_channel_id',
    countForChannel: (salesChannelId) => emFactory().count(Order, { salesChannelId }),
  });
}
