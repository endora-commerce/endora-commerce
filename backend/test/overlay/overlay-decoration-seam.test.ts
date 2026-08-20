import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/bus.js';
import { createRootContainer } from '../../src/kernel/container.js';
import { ForeignDecorationError, type ModuleContext } from '../../src/kernel/module-context.js';
import { composeModules, type ModuleEntry } from '../../src/kernel/compose.js';
import { ApiInterceptorRegistry } from '../../src/http/interceptors/index.js';
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
