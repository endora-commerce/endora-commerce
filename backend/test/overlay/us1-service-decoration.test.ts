import { describe, it, expect } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { loadOverlayDecorations } from '../../src/overlay/overlay-runtime.js';
import {
  priceListsModule,
  type PriceListsModuleOptions,
} from '../../src/modules/price_lists/plugin.js';
import { PricingService as CorePricingService } from '../../src/modules/price_lists/services/pricing-service.js';
import type {
  PricingLineResult,
  PricingResolutionInput,
  PricingServiceContract,
} from '../../src/modules/price_lists/services/pricing-service.interface.js';

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

const NEIGHBOUR_READS: Pick<PriceListsModuleOptions, 'targetReads' | 'customerAccountRead'> = {
  targetReads: {
    catalogProductRead: refusingPort('catalogProductReadPort'),
    catalogCategoryRead: refusingPort('catalogCategoryReadPort'),
    organizationDetails: refusingPort('organizationDetailsPort'),
    customerGroupRead: refusingPort('customerGroupReadPort'),
  },
  customerAccountRead: refusingPort('customerAccountReadPort'),
};


const stubEmFactory = (): EntityManager => ({}) as unknown as EntityManager;
const stubRequireAdmin = () => async (): Promise<void> => {};

/**
 * The example deployment's client override, end to end (feature 072, T066).
 *
 * This replaces the service-class override of feature 057, which is why the
 * assertions are different in kind rather than in detail. That mechanism was
 * asserted by *identity*: the resolved engine was a subclass of core, so the
 * test checked which class it was. This one is asserted by *behaviour*, because
 * a decoration deliberately is not an instance of the core class — checking the
 * class would be checking the thing that stopped being true, and would pass for
 * an override that reimplemented core rather than delegating to it.
 */
describe('US1 — the example deployment decorates the pricing engine', () => {
  it('discovers the decoration by registration name, not by file path', async () => {
    const map = await loadOverlayDecorations({ DEPLOYMENT: 'example' } as NodeJS.ProcessEnv);
    // `apps/example/decorations/pricing-service.ts` → `pricingService`. The key
    // is the registration it wraps, so core moving the file breaks nothing.
    expect([...map.keys()]).toEqual(['pricingService']);
    expect(typeof map.get('pricingService')).toBe('function');
  });

  it('every consumer of the module handle receives the wrapped engine', async () => {
    const map = await loadOverlayDecorations({ DEPLOYMENT: 'example' } as NodeJS.ProcessEnv);
    const decorate = map.get('pricingService') as (
      inner: PricingServiceContract,
    ) => PricingServiceContract;

    const mod = priceListsModule({
      emFactory: stubEmFactory,
      requireAdmin: stubRequireAdmin,
      enableStatusSweeper: false,
      pricingCacheTtlMs: 0,
      ...NEIGHBOUR_READS,
      decoratePricingService: decorate,
    });

    // `handle.pricingService` is what commerce and every other consumer reads,
    // and it is the wrapper — not a subclass of core, which is the point.
    expect(mod.handle.pricingService).not.toBeInstanceOf(CorePricingService);
  });

  it('delegates to core and adjusts its result, rather than replacing it', async () => {
    const map = await loadOverlayDecorations({ DEPLOYMENT: 'example' } as NodeJS.ProcessEnv);
    const decorate = map.get('pricingService') as (
      inner: PricingServiceContract,
    ) => PricingServiceContract;

    // A core stand-in, so the assertion is about the wrapper's behaviour and
    // not about the database the real engine would read.
    let coreCalls = 0;
    const core: PricingServiceContract = {
      resolveEngine: async () => {
        throw new Error('not used here');
      },
      resolveLinePrice: async (): Promise<PricingLineResult | null> => {
        coreCalls += 1;
        return { priceListId: 'core-list' } as PricingLineResult;
      },
      listBracketMinQuantities: async () => [1, 5],
      resolveListingPrices: async () => new Map(),
      namedListPrices: async () => new Map(),
    };

    const decorated = decorate(core);
    const line = await decorated.resolveLinePrice({} as PricingResolutionInput);

    // Core ran, and the client adjusted what core produced. This is the
    // property the replaced mechanism could not have: a core fix to
    // `resolveLinePrice` reaches this deployment.
    expect(coreCalls).toBe(1);
    expect(line?.priceListId).toBe('overlay:core-list');
    // A method the override does not touch is core's, not a copy of it.
    expect(await decorated.listBracketMinQuantities('p1', 'PLN')).toEqual([1, 5]);
  });
});
