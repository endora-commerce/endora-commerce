import { describe, expect, it } from 'vitest';
import { EventBus } from '@endora-commerce/platform/events';
import { createRootContainer } from '@endora-commerce/platform/composition';
import {
  ForeignDecorationError,
  PackageDecorationNotOfferedError,
} from '@endora-commerce/platform/composition';
import { type ModuleContext } from '@endora-commerce/platform/kernel';
import { composeModules, type ModuleEntry } from '@endora-commerce/platform/composition';
import { ApiInterceptorRegistry } from '@endora-commerce/platform/composition';
import { loadOverlayModuleEntries } from '../../src/overlay/overlay-runtime.js';

/**
 * T-A / T-A′ — the decoration seam an overlay module reaches, and the rule it
 * is the only exemption to.
 *
 * `ctx.di.decorate` refuses a module wrapping a registration it does not own
 * (`ForeignDecorationError`) and exempts a deployment's overlay module, which is
 * the sanctioned per-deployment customisation seam. `!705` came within an
 * owner-check of removing that exemption — a change that would have passed the
 * entire suite and broken the first client deployment to use the path, because
 * nothing exercised it.
 *
 * **These two cases are one test in two halves and neither is worth anything
 * alone.** T-A passes on its own if the exemption is widened to every module;
 * T-A′ passes on its own if decoration is broken entirely. One proof per shape
 * the seam refuses (issue #130), applied to a seam rather than to a check.
 *
 * Both take the overlay entry from `loadOverlayModuleEntries`, never from a
 * hand-built `{ overlay: true }` literal: a literal would test the exemption
 * while skipping the derivation, and "from the root the module was discovered
 * under, never from anything the module says about itself" is half of what
 * makes the exemption safe.
 *
 * The **owner** side of that derivation is asserted next door, in
 * `packaged-owner-decoration.test.ts` (D-177's Case A). Nothing here can carry
 * it: the stand-in below is hand-built with `id: 'price_lists'`, so the real
 * generated entry may change underneath it, and T-A″ sets `installedPackage`
 * by hand, so it asserts the guard and never the derivation that decides which
 * owners reach it.
 */

const log = (): { info: () => void; warn: () => void; error: () => void } => ({
  info: () => {},
  warn: () => {},
  error: () => {},
});

/** A stand-in for `price_lists`, registering the name the overlay decorates. */
function corePricingModule(calls: { count: number }): ModuleEntry {
  return {
    id: 'price_lists',
    version: '1.0.0',
    registerModule: (ctx: ModuleContext): void => {
      ctx.di.register({
        pricingService: ctx.asValue({
          resolveLinePrice: async (): Promise<{ priceListId: string }> => {
            calls.count += 1;
            return { priceListId: 'core-list' };
          },
          listBracketMinQuantities: async (): Promise<number[]> => [1, 5],
        }),
      });
    },
  };
}

async function exampleOverlayEntry(): Promise<ModuleEntry> {
  const entries = await loadOverlayModuleEntries({ DEPLOYMENT: 'example' } as NodeJS.ProcessEnv);
  const entry = entries.find((e) => e.id === 'example_overlay');
  if (!entry) throw new Error('the example deployment ships no example_overlay module');
  return entry;
}

function compose(entries: readonly ModuleEntry[]): {
  cradle: Record<string, unknown>;
} {
  const container = createRootContainer();
  composeModules(entries, {
    container,
    eventBus: new EventBus(),
    log: log(),
    // The overlay module registers one; a root that mounts no registry refuses
    // the registration, which would make every case here fail for that reason.
    interceptorRegistry: new ApiInterceptorRegistry(),
  });
  return { cradle: container.cradle as unknown as Record<string, unknown> };
}

describe('T-A — a deployment’s overlay module decorates a core registration it does not own', () => {
  it('resolves the decorated implementation, and the inner one is still called', async () => {
    const calls = { count: 0 };
    const { cradle } = compose([corePricingModule(calls), await exampleOverlayEntry()]);

    const pricing = cradle['pricingService'] as {
      resolveLinePrice(input: unknown): Promise<{ priceListId: string } | null>;
      listBracketMinQuantities(): Promise<number[]>;
    };
    const line = await pricing.resolveLinePrice({});

    // Core ran, and the client adjusted what core produced — delegation, not
    // replacement (D-28). This is the property that makes a core fix to
    // `resolveLinePrice` reach the deployment.
    expect(calls.count).toBe(1);
    expect(line?.priceListId).toBe('overlay:core-list');
    // A method the decoration does not touch is core's, not a copy of it.
    expect(await pricing.listBracketMinQuantities()).toEqual([1, 5]);
  });
});

describe('T-A′ — the same module, without the overlay marking, is refused', () => {
  it('throws ForeignDecorationError naming the decorator and the owner', async () => {
    const calls = { count: 0 };
    // The *same* registerModule, with only the derived marking stripped. If the
    // exemption were widened to everyone, this would pass and T-A would still
    // be green — which is exactly why the two are kept apart.
    const { overlay: _overlay, ...asIfCore } = await exampleOverlayEntry();

    let thrown: unknown;
    try {
      compose([corePricingModule(calls), asIfCore]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ForeignDecorationError);
    expect((thrown as ForeignDecorationError).registrationName).toBe('pricingService');
    expect((thrown as ForeignDecorationError).moduleId).toBe('example_overlay');
    expect((thrown as ForeignDecorationError).owner).toBe('price_lists');
  });
});

/**
 * T-A″ — the same overlay module, over an owner that is an **installed
 * package** (D-176 Q3, ruled by the owner on 2026-08-25).
 *
 * The third half of the pair above, and it needs both of them to mean anything:
 * T-A says the exemption exists, T-A′ says it is not everyone's, and this says
 * where it stops. A deployment may wrap what core registers and not what a
 * stranger's package registers — because a package's `exports` map publishes
 * `registerModule`, its entities, its migrations and `./ports`, and the
 * container names it registers internally are published by none of them.
 *
 * Until the decoration drain landed this case was refused **by accident**:
 * `composition.ts` composes overlays before packages, so the wrap ran against a
 * container the package had not registered into yet and `hasRegistration` said
 * no. The drain removes that accident, which is exactly why the refusal has to
 * be a rule — the same change would otherwise have granted the capability
 * silently.
 *
 * The entry carries the real derived `overlay: true` for the same reason T-A
 * does, and its counterpart is marked the way the host's package loader marks
 * one.
 */
describe('T-A″ — the same overlay module cannot wrap an installed package’s registration', () => {
  it('throws PackageDecorationNotOfferedError naming the overlay, the package and the name', async () => {
    const calls = { count: 0 };
    const packagedPricing: ModuleEntry = {
      ...corePricingModule(calls),
      id: 'vendor_pricing',
      installedPackage: true,
    };

    let thrown: unknown;
    try {
      compose([packagedPricing, await exampleOverlayEntry()]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(PackageDecorationNotOfferedError);
    expect((thrown as PackageDecorationNotOfferedError).registrationName).toBe('pricingService');
    expect((thrown as PackageDecorationNotOfferedError).moduleId).toBe('example_overlay');
    expect((thrown as PackageDecorationNotOfferedError).owner).toBe('vendor_pricing');
    // "Not offered yet", with the exit named: a package may later declare which
    // of its registrations are decoratable. A refusal that reads as permanent
    // sends its author to fork.
    expect((thrown as Error).message).toContain('not offered yet');
    expect((thrown as Error).message).toContain('./ports');
  });

  it('is about the owner, not about the seam — the same overlay still wraps core', async () => {
    // The discrimination. Without it, deleting the overlay exemption outright
    // would satisfy the case above.
    const calls = { count: 0 };
    const { cradle } = compose([corePricingModule(calls), await exampleOverlayEntry()]);

    const pricing = cradle['pricingService'] as {
      resolveLinePrice(input: unknown): Promise<{ priceListId: string } | null>;
    };
    expect((await pricing.resolveLinePrice({}))?.priceListId).toBe('overlay:core-list');
  });
});
