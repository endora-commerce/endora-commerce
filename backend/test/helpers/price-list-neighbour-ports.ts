import type { EntityManager } from '@mikro-orm/postgresql';
import { CatalogCategoryReadService } from '../../src/modules/catalog/services/catalog-category-read.service.js';
import { CatalogProductReadService } from '../../src/modules/catalog/services/catalog-product-read.service.js';
import { OrganizationDetailsService } from '../../src/modules/organizations/services/organization-details-port.js';
import type { PriceListTargetReads } from '../../src/modules/price_lists/services/price-list-service.js';

/**
 * Feature 075 Phase C — the neighbour read ports `price_lists` resolves.
 *
 * Twenty test files construct `PriceListService` and `PricingService` by hand,
 * so they have to supply what the container supplies in a real composition:
 * `catalog`'s and `organizations`' published read ports, which replaced this
 * module's `em.count(Organization, …)` / `em.findOne(Category, …)` validation
 * of rule and override targets.
 *
 * The implementations are the **owners' own**, bound to the caller's
 * `EntityManager` factory. Both halves of that matter. A stub would have proved
 * less — the point of the cut is that the owners' published implementations
 * answer these questions, and a fake that agrees with the test's expectations
 * cannot show it. And several of these suites run inside an open transaction
 * (`TestDb.beginTx`), so a port on any other fork would not see the rows they
 * have just written.
 */
export function neighbourReadPorts(emFactory: () => EntityManager): PriceListTargetReads {
  return {
    catalogProductRead: new CatalogProductReadService(emFactory),
    catalogCategoryRead: new CatalogCategoryReadService(emFactory),
    organizationDetails: new OrganizationDetailsService(emFactory),
  };
}
