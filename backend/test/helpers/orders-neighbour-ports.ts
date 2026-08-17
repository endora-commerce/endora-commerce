import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CartWritePort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  OrganizationDetailsPort,
} from '@b2b/contracts';
import { CustomerAccountReadService } from '../../src/modules/customer_accounts/services/customer-account-ports.js';
import { OrganizationDetailsService } from '../../src/modules/organizations/services/organization-details-port.js';
import { CatalogProductReadService } from '../../src/modules/catalog/services/catalog-product-read.service.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * The neighbouring modules' ports an `orders` service needs when a test builds
 * it by hand (feature 075, Phase C).
 *
 * Modelled on `price-list-neighbour-ports.ts` and `customer-account-ports.ts`:
 * the **real** implementations rather than stubs, because they are the classes
 * the container registers, so a hand-built service exercises the same read path
 * the composed one does. What the container adds on top is the effective-state
 * gate, and a test that wants the 503 flips module state against the shared
 * harness instead of substituting a fake here.
 */
export function ordersNeighbourPorts(emFactory: () => EntityManager): {
  customerAccountRead: CustomerAccountReadPort;
  organizationDetails: OrganizationDetailsPort;
  catalogProductRead: CatalogProductReadPort;
} {
  return {
    customerAccountRead: new CustomerAccountReadService(emFactory),
    organizationDetails: new OrganizationDetailsService(emFactory),
    catalogProductRead: new CatalogProductReadService(emFactory),
  };
}

/**
 * `carts`' write surface, taken off the booted container rather than rebuilt.
 *
 * Unlike the three above, this one is not a thin wrapper over an
 * `EntityManager`: `cartWritePort` delegates to the composed `CartService`,
 * which carries the pricing engine, the Redis recompute cache and the
 * sales-channel resolution. Reconstructing that in a test rig would be a
 * second composition, and it would drift.
 */
export function cartWritePortOf(h: BackendServerHandle): CartWritePort {
  return (h.container.cradle as unknown as { cartWritePort: CartWritePort }).cartWritePort;
}
