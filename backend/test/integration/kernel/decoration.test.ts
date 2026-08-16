import { describe, expect, it, vi } from 'vitest';
import type { ListingPrice } from '@b2b/contracts';
import { EventBus } from '../../../src/events/bus.js';
import {
  AmbiguousDecorationError,
  composeModules,
  type ModuleEntry,
} from '../../../src/kernel/compose.js';
import { createRootContainer, type KernelContainer } from '../../../src/kernel/container.js';
import type { ModuleContext } from '../../../src/kernel/module-context.js';
import type {
  ListingPricesInput,
  PricingEngineResult,
  PricingLineResult,
  PricingResolutionInput,
  PricingServiceContract,
} from '../../../src/modules/price_lists/services/pricing-service.interface.js';

/**
 * Decoration — a client customises core without forking (feature 072, US7 /
 * D-28).
 *
 * The subject is `PricingServiceContract`, and it is the subject because it is
 * the one core service that already has a written contract: the interface file
 * feature 057 added so an overlay could replace the pricing engine and keep
 * every consumer type-checking. What changes here is the *mechanism*. Feature
 * 057 replaced the class — file shadowing, resolved by path, wired by a
 * hardcoded `if` in `composition.ts`. Replacement means a client override stops
 * receiving core fixes the moment it is written: whatever core does to
 * `resolveLinePrice` next month happens in a file this deployment no longer
 * runs.
 *
 * Decoration inverts that. The override *wraps* core and delegates, so a core
 * fix flows through the client's own layer unless the client deliberately
 * intercepts that method. The properties worth pinning are therefore about
 * delegation and composition, not about "the override ran".
 */

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** A core pricing engine, reduced to the two facts these tests read. */
class CorePricingService implements PricingServiceContract {
  calls = 0;

  async resolveEngine(_input: PricingResolutionInput): Promise<PricingEngineResult> {
    this.calls += 1;
    return {
      base: { listId: 'core', listName: 'Core', bracket: null },
      sale: null,
      displayMode: 'net_only',
      currencyCode: 'PLN',
    } as PricingEngineResult;
  }

  async resolveLinePrice(_input: PricingResolutionInput): Promise<PricingLineResult | null> {
    this.calls += 1;
    return {
      amount: '100.00',
      currency: 'PLN',
      priceListId: 'core',
      isSale: false,
      bracketStartQuantity: 1,
      displayMode: 'net_only',
    } as PricingLineResult;
  }

  async listBracketMinQuantities(_productId: string, _currencyCode: string): Promise<number[]> {
    return [1, 10];
  }

  async resolveListingPrices(): Promise<Map<string, ListingPrice>> {
    return new Map();
  }

  async namedListPrices(): Promise<Map<string, string>> {
    return new Map();
  }
}

/**
 * A client override, written the way D-28 requires: it wraps an inner
 * implementation of the **contract**, not a subclass of the core class. That
 * distinction is the whole mechanism — `inner` may itself already be another
 * client's decoration.
 */
class TaggingPricingService implements PricingServiceContract {
  constructor(
    private readonly inner: PricingServiceContract,
    private readonly tag = 'acme',
  ) {}

  async resolveEngine(input: PricingResolutionInput): Promise<PricingEngineResult> {
    return this.inner.resolveEngine(input);
  }

  async resolveLinePrice(input: PricingResolutionInput): Promise<PricingLineResult | null> {
    const base = await this.inner.resolveLinePrice(input);
    return base === null ? null : { ...base, priceListId: `${this.tag}:${base.priceListId}` };
  }

  async listBracketMinQuantities(productId: string, currencyCode: string): Promise<number[]> {
    return this.inner.listBracketMinQuantities(productId, currencyCode);
  }

  async resolveListingPrices(
    input: ListingPricesInput,
  ): Promise<Map<string, ListingPrice>> {
    return this.inner.resolveListingPrices(input);
  }

  async namedListPrices(input: {
    priceListId: string;
    currencyCode: string;
    productIds: readonly string[];
  }): Promise<Map<string, string>> {
    return this.inner.namedListPrices(input);
  }
}

const INPUT = {} as PricingResolutionInput;

function coreModule(): ModuleEntry {
  return {
    id: 'price_lists',
    version: '1.0.0',
    registerModule: (ctx: ModuleContext) => {
      ctx.di.register({ pricingService: ctx.asClass(CorePricingService).singleton() });
    },
  };
}

function decoratingModule(id: string, tag: string): ModuleEntry {
  return {
    id,
    version: '1.0.0',
    registerModule: (ctx: ModuleContext) => {
      ctx.di.decorate<PricingServiceContract>(
        'pricingService',
        (inner) => new TaggingPricingService(inner, tag),
      );
    },
  };
}

function compose(
  entries: readonly ModuleEntry[],
  extra: { decorationOrder?: Readonly<Record<string, readonly string[]>> } = {},
): { container: KernelContainer; composed: ReturnType<typeof composeModules> } {
  const container = createRootContainer();
  const composed = composeModules(entries, {
    container,
    eventBus: new EventBus(),
    log,
    ...(extra.decorationOrder ? { decorationOrder: extra.decorationOrder } : {}),
  });
  return { container, composed };
}

describe('T062 — a client wraps core instead of replacing it', () => {
  it('the consumer resolves the decorated implementation under the core name', async () => {
    const { container } = compose([coreModule(), decoratingModule('acme_pricing', 'acme')]);

    const pricing = container.cradle['pricingService'] as PricingServiceContract;
    const line = await pricing.resolveLinePrice(INPUT);

    // The consumer asked for `pricingService`. It never learns that a client
    // module exists, which is the point: 40-odd call sites stay untouched.
    expect(line?.priceListId).toBe('acme:core');
  });

  it('core still runs — the override delegates rather than reimplementing', async () => {
    const { container } = compose([coreModule(), decoratingModule('acme_pricing', 'acme')]);

    const pricing = container.cradle['pricingService'] as PricingServiceContract;
    await pricing.resolveLinePrice(INPUT);

    // This is the property replacement cannot have. A core fix to
    // `resolveLinePrice` reaches this deployment because core's method is
    // still the one producing the value the override adjusts.
    const inner = container.cradle['pricingService$undecorated$1'] as CorePricingService;
    expect(inner).toBeInstanceOf(CorePricingService);
    expect(inner.calls).toBe(1);
  });

  it('a method the override does not touch is core, not a copy of core', async () => {
    const { container } = compose([coreModule(), decoratingModule('acme_pricing', 'acme')]);

    const pricing = container.cradle['pricingService'] as PricingServiceContract;
    expect(await pricing.listBracketMinQuantities('p1', 'PLN')).toEqual([1, 10]);
  });

  it('preserves the inner registration lifetime, so a singleton stays one instance', async () => {
    const { container } = compose([coreModule(), decoratingModule('acme_pricing', 'acme')]);

    const first = container.cradle['pricingService'] as PricingServiceContract;
    const second = container.cradle['pricingService'] as PricingServiceContract;
    await first.resolveLinePrice(INPUT);
    await second.resolveLinePrice(INPUT);

    // Decoration silently turning a singleton into a per-resolution instance
    // is the kind of change that shows up as a cache that never hits.
    const inner = container.cradle['pricingService$undecorated$1'] as CorePricingService;
    expect(inner.calls).toBe(2);
  });

  it('chains: two decorations compose in registration order, innermost first', async () => {
    const { container } = compose(
      [coreModule(), decoratingModule('acme_pricing', 'acme'), decoratingModule('beta_pricing', 'beta')],
      { decorationOrder: { pricingService: ['acme_pricing', 'beta_pricing'] } },
    );

    const pricing = container.cradle['pricingService'] as PricingServiceContract;
    const line = await pricing.resolveLinePrice(INPUT);

    // beta wraps acme wraps core — the composer's topological order, made
    // explicit by the declaration rather than inferred from package loading.
    expect(line?.priceListId).toBe('beta:acme:core');
  });

  it('decorating a name nothing registers fails, naming the module and the name', () => {
    expect(() => compose([decoratingModule('acme_pricing', 'acme')])).toThrow(
      /acme_pricing[\s\S]*pricingService/,
    );
  });
});

describe('T064 — two modules decorating one name must declare their order', () => {
  it('fails when two modules decorate the same name with no declared order', () => {
    let thrown: unknown;
    try {
      compose([
        coreModule(),
        decoratingModule('acme_pricing', 'acme'),
        decoratingModule('beta_pricing', 'beta'),
      ]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AmbiguousDecorationError);
    // Both claimants, never just the loser: which one is "wrong" is the
    // operator's call, and it cannot be made from an error naming one of them.
    expect((thrown as Error).message).toContain('acme_pricing');
    expect((thrown as Error).message).toContain('beta_pricing');
    expect((thrown as Error).message).toContain('pricingService');
  });

  it('one module decorating the same name twice is not ambiguous', () => {
    // Nothing is undetermined: the module wrote both wraps, in the order it
    // wrote them. Requiring a declaration here would be ceremony.
    const { container } = compose([
      coreModule(),
      {
        id: 'acme_pricing',
        version: '1.0.0',
        registerModule: (ctx) => {
          ctx.di.decorate<PricingServiceContract>(
            'pricingService',
            (inner) => new TaggingPricingService(inner, 'one'),
          );
          ctx.di.decorate<PricingServiceContract>(
            'pricingService',
            (inner) => new TaggingPricingService(inner, 'two'),
          );
        },
      },
    ]);

    return expect(
      (container.cradle['pricingService'] as PricingServiceContract).resolveLinePrice(INPUT),
    ).resolves.toMatchObject({ priceListId: 'two:one:core' });
  });

  it('fails when the declared order does not list every decorating module', () => {
    expect(() =>
      compose(
        [coreModule(), decoratingModule('acme_pricing', 'acme'), decoratingModule('beta_pricing', 'beta')],
        { decorationOrder: { pricingService: ['acme_pricing'] } },
      ),
    ).toThrow(/beta_pricing/);
  });

  it('fails when composition order contradicts the declared order', () => {
    // A declaration that does not bind is worse than none: it reads as a
    // decision and behaves as a comment.
    expect(() =>
      compose(
        [coreModule(), decoratingModule('acme_pricing', 'acme'), decoratingModule('beta_pricing', 'beta')],
        { decorationOrder: { pricingService: ['beta_pricing', 'acme_pricing'] } },
      ),
    ).toThrow(AmbiguousDecorationError);
  });
});

describe('T065 — the override report', () => {
  it('lists every active decoration, with its target, module and depth', () => {
    const { composed } = compose(
      [coreModule(), decoratingModule('acme_pricing', 'acme'), decoratingModule('beta_pricing', 'beta')],
      { decorationOrder: { pricingService: ['acme_pricing', 'beta_pricing'] } },
    );

    expect(composed.decorations).toEqual([
      { name: 'pricingService', moduleId: 'acme_pricing', owner: 'price_lists', depth: 1 },
      { name: 'pricingService', moduleId: 'beta_pricing', owner: 'price_lists', depth: 2 },
    ]);
  });

  it('is empty for a build with no client overrides, and says so by being empty', () => {
    const { composed } = compose([coreModule()]);
    expect(composed.decorations).toEqual([]);
  });

  it('names the owning module of the decorated registration, not only the decorator', () => {
    // "Who is overriding what" is two questions. A report answering only the
    // first sends the reader back to grep for the second.
    const { composed } = compose([coreModule(), decoratingModule('acme_pricing', 'acme')]);
    expect(composed.decorations[0]?.owner).toBe('price_lists');
  });
});
