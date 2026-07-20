import { describe, it, expect } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { loadOverlayServiceClasses } from '../../src/overlay/overlay-runtime.js';
import { priceListsModule } from '../../src/modules/price_lists/plugin.js';
import { PricingService as CorePricingService } from '../../src/modules/price_lists/services/pricing-service.js';

const stubEmFactory = (): EntityManager => ({}) as unknown as EntityManager;
const stubRequireAdmin = () => async (): Promise<void> => {};

// US1 (SC-001, scenarios 1-2): the example deployment's overlay PricingService
// resolves for every consumer via the composition seam, and the core class is
// untouched (the overlay extends it — a different class).
describe('US1 — overlay service resolves for consumers (T020/T024/T026)', () => {
  it('loads the overlay pricing class for DEPLOYMENT=example', async () => {
    const map = await loadOverlayServiceClasses({ DEPLOYMENT: 'example' } as NodeJS.ProcessEnv);
    const OverlayPricing = map.get('price_lists/services/pricing-service.ts');
    expect(typeof OverlayPricing).toBe('function');
    // It is a distinct class that extends (delegates to) core — core untouched.
    expect(OverlayPricing).not.toBe(CorePricingService);
    expect(Object.getPrototypeOf(OverlayPricing)).toBe(CorePricingService);
  });

  it('every consumer of the module handle receives the overlay implementation', async () => {
    const map = await loadOverlayServiceClasses({ DEPLOYMENT: 'example' } as NodeJS.ProcessEnv);
    const OverlayPricing = map.get('price_lists/services/pricing-service.ts') as
      | typeof CorePricingService
      | undefined;
    expect(OverlayPricing).toBeDefined();

    const mod = priceListsModule({
      emFactory: stubEmFactory,
      requireAdmin: stubRequireAdmin,
      enableStatusSweeper: false,
      pricingCacheTtlMs: 0,
      ...(OverlayPricing ? { pricingServiceClass: OverlayPricing } : {}),
    });
    // handle.pricingService is what commerce / consumers read.
    expect(mod.handle.pricingService).toBeInstanceOf(OverlayPricing);
    // and it is still a CorePricingService (subclass), so consumers type-check.
    expect(mod.handle.pricingService).toBeInstanceOf(CorePricingService);
    // the override is real — resolveLinePrice differs from core's.
    expect(Object.getPrototypeOf(mod.handle.pricingService).resolveLinePrice).not.toBe(
      CorePricingService.prototype.resolveLinePrice,
    );
  });
});
