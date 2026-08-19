import type { CatalogCategoryReadPort, CatalogProductReadPort } from '@b2b/contracts';
import type { SalesChannelMembershipPort } from '../../src/kernel/ports/sales-channel.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * The three neighbour reads `SearchIndexer` takes, resolved from the composed
 * container (feature 075 — Phase C for the products, D-87 for the other two).
 *
 * Four suites build an indexer by hand, and each carried its own copy of the
 * `catalogProductReadPort` lookup. The copies were one line each, which is why
 * there were four of them and why adding a second port to the indexer would
 * have made eight. They resolve rather than stub on purpose: the point of the
 * cut is that the *owners'* published implementations answer these questions,
 * and a fake that agrees with the test's expectations cannot show it.
 *
 * `salesChannelMembershipPort` is the kernel's, contributed by the composition
 * root — it is the sanctioned bridge accessor of Constitution XII, and the
 * indexer's two `sales_channel_products` statements are what it replaced.
 */
export function searchIndexerNeighbourPorts(handle: BackendServerHandle): {
  products: CatalogProductReadPort;
  categories: CatalogCategoryReadPort;
  channelMembership: SalesChannelMembershipPort;
} {
  const cradle = handle.container.cradle as never as {
    catalogProductReadPort: CatalogProductReadPort;
    catalogCategoryReadPort: CatalogCategoryReadPort;
    salesChannelMembershipPort: SalesChannelMembershipPort;
  };
  return {
    products: cradle.catalogProductReadPort,
    categories: cradle.catalogCategoryReadPort,
    channelMembership: cradle.salesChannelMembershipPort,
  };
}
