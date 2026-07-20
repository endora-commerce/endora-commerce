import { describe, it, expect } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { loadOverlayServiceClasses } from '../../src/overlay/overlay-runtime.js';
import { priceListsModule } from '../../src/modules/price_lists/plugin.js';
import { PricingService as CorePricingService } from '../../src/modules/price_lists/services/pricing-service.js';

const stubEmFactory = (): EntityManager => ({}) as unknown as EntityManager;
const stubRequireAdmin = () => async (): Promise<void> => {};

// US1 scenario 3: a deployment with NO overlay for the service resolves the
// core implementation.
describe('US1 — a deployment without the overlay uses core (T021)', () => {
  it('loads no overlay service class when DEPLOYMENT is unset (bare core)', async () => {
    const map = await loadOverlayServiceClasses({} as NodeJS.ProcessEnv);
    expect(map.size).toBe(0);
  });

  it('the module handle uses the core PricingService when no overlay is passed', () => {
    const mod = priceListsModule({
      emFactory: stubEmFactory,
      requireAdmin: stubRequireAdmin,
      enableStatusSweeper: false,
      pricingCacheTtlMs: 0,
    });
    expect(mod.handle.pricingService).toBeInstanceOf(CorePricingService);
    expect(mod.handle.pricingService.resolveLinePrice).toBe(
      CorePricingService.prototype.resolveLinePrice,
    );
  });
});
