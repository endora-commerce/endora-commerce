import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AddressReadPort,
  CartWritePort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  DeliveryMethodReadPort,
  InventoryFulfilmentPlanningPort,
  InventoryStockReadPort,
  OrganizationDetailsPort,
  PaymentMethodReadPort,
} from '@b2b/contracts';
import { resolveAllocations, resolveEffectiveFulfilmentStrategy } from '@b2b/contracts';
import { CustomerAccountReadService } from '../../src/modules/customer_accounts/services/customer-account-ports.js';
import { OrganizationDetailsService } from '../../src/modules/organizations/services/organization-details-port.js';
import { CatalogProductReadService } from '../../src/modules/catalog/services/catalog-product-read.service.js';
import { AddressReadService } from '../../src/modules/addresses/services/address-ports.js';
import { DeliveryMethodReadService } from '../../src/modules/delivery_methods/services/delivery-method-read-port.js';
import { PaymentMethodReadService } from '../../src/modules/payment_methods/services/payment-method-read-port.js';
import { InventoryStockReadService } from '../../src/modules/inventory/services/inventory-read-port.js';
import type { OrderServiceNeighbourPorts } from '../../src/modules/orders/services/order-service.js';
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

/**
 * The whole group `OrderService` requires (feature 075).
 *
 * The two method catalogues are accessors on the port side because their
 * owners are deactivatable; a rig that is not testing an off state hands back
 * a live one, and a rig that *is* flips module state against the shared
 * harness, which makes the accessor answer for itself.
 */
export function orderServiceNeighbours(
  emFactory: () => EntityManager,
): OrderServiceNeighbourPorts {
  const base = ordersNeighbourPorts(emFactory);
  const deliveryMethodRead: DeliveryMethodReadPort = new DeliveryMethodReadService(emFactory);
  const paymentMethodRead: PaymentMethodReadPort = new PaymentMethodReadService(emFactory);
  const addressRead: AddressReadPort = new AddressReadService(emFactory);
  return {
    organizationDetails: base.organizationDetails,
    customerAccountRead: base.customerAccountRead,
    catalogProductRead: base.catalogProductRead,
    addressRead,
    deliveryMethodRead: () => deliveryMethodRead,
    paymentMethodRead: () => paymentMethodRead,
    // D-94.4 — the two `inventory` ports the reservation runs on, live. A rig
    // that wants the module *off* returns `null` from this accessor (or flips
    // module state against the shared harness), which is what makes the
    // `degrades-without` declaration testable at all: before the port existed,
    // placement reached `inventory` through dynamic imports and there was
    // nothing for a test to withhold.
    inventory: () => ({
      stockRead: new InventoryStockReadService(emFactory) satisfies InventoryStockReadPort,
      planning: {
        resolveEffectiveStrategy: resolveEffectiveFulfilmentStrategy,
        planAllocations: resolveAllocations,
      } satisfies InventoryFulfilmentPlanningPort,
    }),
  };
}
