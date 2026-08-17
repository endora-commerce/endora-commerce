import { describe, it, expect } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { loadOverlayDecorations } from '../../src/overlay/overlay-runtime.js';
import {
  priceListsModule,
  type PriceListsModuleOptions,
} from '../../src/modules/price_lists/plugin.js';
import { PricingService as CorePricingService } from '../../src/modules/price_lists/services/pricing-service.js';

/**
 * Feature 075 Phase C — `price_lists` reads its neighbours over ports now, and
 * these cases exercise a path that touches none of them. The stubs therefore
 * **throw**: a permissive stub would let a future edit reach `catalog` from
 * here and read as though the neighbour had answered.
 */
function unreachedPort(name: string): never {
  throw new Error(`this test must not reach ${name}`);
}

function refusingPort<T extends object>(name: string): T {
  return new Proxy({} as T, { get: () => () => unreachedPort(name) });
}

const NEIGHBOUR_READS: Pick<PriceListsModuleOptions, 'targetReads'> = {
  targetReads: {
    catalogProductRead: refusingPort('catalogProductReadPort'),
    catalogCategoryRead: refusingPort('catalogCategoryReadPort'),
    organizationDetails: refusingPort('organizationDetailsPort'),
  },
};


const stubEmFactory = (): EntityManager => ({}) as unknown as EntityManager;
const stubRequireAdmin = () => async (): Promise<void> => {};

// US1 scenario 3: a deployment with NO overlay for the service resolves the
// core implementation.
describe('US1 — a deployment without the overlay uses core (T021)', () => {
  it('loads no decoration when DEPLOYMENT is unset (bare core)', async () => {
    const map = await loadOverlayDecorations({} as NodeJS.ProcessEnv);
    expect(map.size).toBe(0);
  });

  it('the module handle uses the core PricingService when no overlay is passed', () => {
    const mod = priceListsModule({
      emFactory: stubEmFactory,
      requireAdmin: stubRequireAdmin,
      enableStatusSweeper: false,
      pricingCacheTtlMs: 0,
      ...NEIGHBOUR_READS,
    });
    expect(mod.handle.pricingService).toBeInstanceOf(CorePricingService);
    expect(mod.handle.pricingService.resolveLinePrice).toBe(
      CorePricingService.prototype.resolveLinePrice,
    );
    // Undecorated, so it is the core instance itself — not a wrapper that
    // happens to forward. Bare core composes as if the mechanism did not exist.
  });
});
