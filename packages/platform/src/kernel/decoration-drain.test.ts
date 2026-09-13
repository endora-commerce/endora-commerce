import { describe, expect, it } from 'vitest';
import { EventBus } from '../events/index.js';
import {
  createRootContainer,
  registerValues,
  type KernelContainer,
  type KernelCradle,
} from './container.js';
import {
  AmbiguousDecorationError,
  ForeignDecorationError,
  PackageDecorationNotOfferedError,
  composeModules,
  type ModuleEntry,
} from './compose.js';
import type { ModuleContext } from './module-context.js';

/**
 * D-176 — `ctx.di.decorate` enqueues, and `composeModules` drains the queue
 * after the last module has registered.
 *
 * Registration order used to decide whether a decoration was possible at all:
 * `decorate` wrote into the container while the pass was still running, so a
 * module wrapping a name the array had not reached yet was refused for a reason
 * that had nothing to do with the wrap. D-45 says registration order is
 * meaningless because registration resolves nothing — true of every other seam,
 * and `decorate` was the one that read and rewrote the container without
 * resolving anything, so the `registering` guard never saw it.
 *
 * One pass, then one drain. No sort and no dependency graph: what the drain
 * removes is the *dependency* on order, not the order itself.
 *
 * The two costs the ruling names are both pinned below — the refusal is raised
 * at the drain and must still name the decorating module, and the queue must
 * preserve call order, which is what `AmbiguousDecorationError` already
 * promises for one module's repeat decorations.
 */

function log(): { info: () => void; warn: () => void; error: () => void } {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function compose(entries: readonly ModuleEntry[]): {
  container: KernelContainer;
  composed: ReturnType<typeof composeModules>;
} {
  const container = createRootContainer();
  const composed = composeModules(entries, { container, eventBus: new EventBus(), log: log() });
  return { container, composed };
}

/** A core module registering the name the cases below wrap. */
function owner(id = 'price_lists', value = 'core'): ModuleEntry {
  return {
    id,
    version: '1.0.0',
    registerModule: (ctx: ModuleContext): void => {
      ctx.di.register({ label: ctx.asValue(value) });
    },
  };
}

/** A deployment's overlay module — `overlay: true` is set from its root. */
function overlayDecorator(id: string, ...tags: readonly string[]): ModuleEntry {
  return {
    id,
    version: '1.0.0',
    overlay: true,
    registerModule: (ctx: ModuleContext): void => {
      for (const tag of tags) ctx.di.decorate<string>('label', (inner) => `${inner}+${tag}`);
    },
  };
}

/** An installed extension package, as the host's loader marks one. */
function installedPackage(id: string, registerModule: (ctx: ModuleContext) => void): ModuleEntry {
  return { id, version: '1.0.0', installedPackage: true, registerModule };
}

function packageOwningGreeter(id = 'crm'): ModuleEntry {
  return installedPackage(id, (ctx) => {
    ctx.di.register({ greeter: ctx.asValue({ greeting: (): string => 'package' }) });
  });
}

describe('D-176 — decoration is applied after every module has registered', () => {
  it('applies a decoration written before the owner was composed', () => {
    // The whole finding, reduced: the array is in the order that used to
    // refuse. Nothing about the wrap changed — only when it runs.
    const { container } = compose([overlayDecorator('acme_overlay', 'acme'), owner()]);

    expect(container.resolve<string>('label')).toBe('core+acme');
  });

  it('answers identically whichever order the array holds', () => {
    const before = compose([overlayDecorator('acme_overlay', 'acme'), owner()]);
    const after = compose([owner(), overlayDecorator('acme_overlay', 'acme')]);

    expect(before.container.resolve<string>('label')).toBe(
      after.container.resolve<string>('label'),
    );
    expect(before.composed.decorations).toEqual(after.composed.decorations);
  });

  it("preserves one module's call order across the drain", () => {
    // The queue's second cost, and the reason it is a queue rather than a map:
    // `AmbiguousDecorationError` exempts a module decorating one name twice
    // *because* it wrote both wraps in the order it wrote them. Deferring them
    // must not reorder them — and the case that could is this one, where the
    // decorations are queued before the registration they wrap exists.
    const { container, composed } = compose([
      overlayDecorator('acme_overlay', 'one', 'two'),
      owner(),
    ]);

    expect(container.resolve<string>('label')).toBe('core+one+two');
    expect(composed.decorations.map((entry) => entry.depth)).toEqual([1, 2]);
  });

  it('applies two modules’ decorations in composition order when one is declared', () => {
    const container = createRootContainer();
    composeModules(
      [overlayDecorator('beta_overlay', 'beta'), owner(), overlayDecorator('acme_overlay', 'acme')],
      {
        container,
        eventBus: new EventBus(),
        log: log(),
        decorationOrder: { label: ['beta_overlay', 'acme_overlay'] },
      },
    );

    // `beta_overlay` is composed first, so it wraps first — the drain replays
    // the calls in the order they were made, which for two modules is still
    // the order the composer emitted them.
    expect(container.resolve<string>('label')).toBe('core+beta+acme');
  });

  it('still refuses a name no module in the composition ever registers, naming the module', () => {
    // `hasRegistration`'s real job, and after the drain it is the only thing it
    // can mean. It used to mean "not yet", which is why its remedy told the
    // reader to get the owner composed first.
    let thrown: unknown;
    try {
      compose([overlayDecorator('acme_overlay', 'acme')]);
    } catch (err) {
      thrown = err;
    }

    const message = (thrown as Error).message;
    expect(message).toContain('acme_overlay');
    expect(message).toContain('label');
    expect(message).toContain('nothing is registered');
    // The remedy must not send the reader back to composition order: there is
    // no order in which this succeeds, and the previous message said there was.
    expect(message).not.toMatch(/composed before this one|topological/);
  });

  it('raises the ambiguity refusal at the drain, still naming both modules', () => {
    let thrown: unknown;
    try {
      compose([overlayDecorator('acme_overlay', 'acme'), owner(), overlayDecorator('beta_overlay', 'beta')]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AmbiguousDecorationError);
    expect((thrown as Error).message).toContain('acme_overlay');
    expect((thrown as Error).message).toContain('beta_overlay');
    expect((thrown as Error).message).toContain('label');
  });

  it('raises the ownership refusal at the drain, still naming decorator and owner', () => {
    // The first cost the ruling names: the refusal no longer happens inside the
    // decorating module's `registerModule`, so the queued entry has to carry
    // the module id or the message loses it.
    let thrown: unknown;
    try {
      compose([
        {
          id: 'promotions',
          version: '1.0.0',
          registerModule: (ctx) => ctx.di.decorate<string>('label', (inner) => `${inner}+x`),
        },
        owner(),
      ]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ForeignDecorationError);
    expect((thrown as Error).message).toContain('promotions');
    expect((thrown as Error).message).toContain('price_lists');
    expect((thrown as Error).message).toContain('label');
  });

  it('leaves the container as it was when the drain refuses', () => {
    const container = createRootContainer();
    expect(() =>
      composeModules(
        [
          {
            id: 'promotions',
            version: '1.0.0',
            registerModule: (ctx) => ctx.di.decorate<string>('label', (inner) => `${inner}+x`),
          },
          owner(),
        ],
        { container, eventBus: new EventBus(), log: log() },
      ),
    ).toThrow(ForeignDecorationError);

    expect(container.resolve<string>('label')).toBe('core');
  });

  it('applies nothing while the modules are still registering', () => {
    // The property that makes the drain a phase rather than a reordering: no
    // decoration has touched the container while the pass is still running, so
    // a module composed after the decorating one cannot be looking at a
    // half-decorated one.
    //
    // Observed through `hasRegistration` for the private inner name a
    // decoration parks the wrapped resolver under — the one visible trace an
    // applied decoration leaves — because *resolving* during registration is
    // itself refused (`EagerResolutionError`), which is the guard next door.
    const container = createRootContainer();
    let wrappedDuringRegistration: boolean | undefined;

    composeModules(
      [
        overlayDecorator('acme_overlay', 'acme'),
        owner(),
        {
          id: 'late_module',
          version: '1.0.0',
          registerModule: (): void => {
            wrappedDuringRegistration = container.hasRegistration('label$undecorated$1');
          },
        },
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    expect(wrappedDuringRegistration).toBe(false);
    // …and it is there once the drain has run, so the assertion above is about
    // timing rather than about a name nothing ever registers.
    expect(container.hasRegistration('label$undecorated$1')).toBe(true);
    expect(container.resolve<string>('label')).toBe('core+acme');
  });
});

/**
 * D-176 Q3, ruled by the owner on 2026-08-25: **a per-deployment overlay may
 * not decorate a registration owned by an installed package.**
 *
 * It is refused by the ownership guard, and it has to be — before the drain it
 * was refused by accident, because `composition.ts` composes overlays before
 * packages and the name was not there yet. The drain removes that accident, so
 * without this the same change would silently grant the capability the owner
 * declined.
 */
describe('D-176 Q3 — an overlay may not decorate an installed package’s registration', () => {
  it('refuses, naming the overlay, the package and the registration', () => {
    let thrown: unknown;
    try {
      compose([
        {
          id: 'acme_overlay',
          version: '1.0.0',
          overlay: true,
          registerModule: (ctx) =>
            ctx.di.decorate<{ greeting: () => string }>('greeter', (inner) => ({
              greeting: () => `overlay:${inner.greeting()}`,
            })),
        },
        packageOwningGreeter(),
      ]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(PackageDecorationNotOfferedError);
    const message = (thrown as Error).message;
    expect(message).toContain('acme_overlay');
    expect(message).toContain('crm');
    expect(message).toContain('greeter');
    // "Not offered yet", not "forbidden" — and the exit is named, because the
    // owner ruled that a package may later declare which of its registrations
    // are decoratable.
    expect(message).toContain('not offered yet');
    expect(message).toContain('./ports');
  });

  it('leaves the package’s own registration untouched when it refuses', () => {
    const container = createRootContainer();
    expect(() =>
      composeModules(
        [
          {
            id: 'acme_overlay',
            version: '1.0.0',
            overlay: true,
            registerModule: (ctx) =>
              ctx.di.decorate<{ greeting: () => string }>('greeter', (inner) => ({
                greeting: () => `overlay:${inner.greeting()}`,
              })),
          },
          packageOwningGreeter(),
        ],
        { container, eventBus: new EventBus(), log: log() },
      ),
    ).toThrow(PackageDecorationNotOfferedError);

    expect(container.resolve<{ greeting: () => string }>('greeter').greeting()).toBe('package');
  });

  it('still lets the same overlay decorate a core registration', () => {
    // The discrimination that makes the case above a statement about the
    // **owner** rather than about the overlay seam. Without it, deleting the
    // exemption altogether would pass.
    const { container } = compose([
      overlayDecorator('acme_overlay', 'acme'),
      owner(),
      packageOwningGreeter(),
    ]);

    expect(container.resolve<string>('label')).toBe('core+acme');
  });

  it('still lets a package decorate what it registered itself', () => {
    // The other discrimination: the refusal is about wrapping across the
    // package boundary, not about a package's registrations being undecoratable.
    const { container } = compose([
      installedPackage('crm', (ctx) => {
        ctx.di.register({ greeter: ctx.asValue({ greeting: (): string => 'package' }) });
        ctx.di.decorate<{ greeting: () => string }>('greeter', (inner) => ({
          greeting: () => `own:${inner.greeting()}`,
        }));
      }),
    ]);

    expect(container.resolve<{ greeting: () => string }>('greeter').greeting()).toBe('own:package');
  });

  it('refuses a core module wrapping a package’s registration for the same reason', () => {
    // Refused before this error existed (`ForeignDecorationError`) and refused
    // after it. What moves is the reason the author is given: the remedy
    // `ForeignDecorationError` names is "write it as an overlay module", which
    // for a package owner is advice that leads to the refusal above.
    let thrown: unknown;
    try {
      compose([
        {
          id: 'promotions',
          version: '1.0.0',
          registerModule: (ctx) =>
            ctx.di.decorate<{ greeting: () => string }>('greeter', (inner) => inner),
        },
        packageOwningGreeter(),
      ]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(PackageDecorationNotOfferedError);
    expect((thrown as Error).message).toContain('promotions');
  });

  it('records no decoration for a refused wrap', () => {
    let composed: ReturnType<typeof composeModules> | undefined;
    try {
      composed = compose([
        {
          id: 'acme_overlay',
          version: '1.0.0',
          overlay: true,
          registerModule: (ctx) =>
            ctx.di.decorate<{ greeting: () => string }>('greeter', (inner) => inner),
        },
        packageOwningGreeter(),
      ]).composed;
    } catch {
      composed = undefined;
    }

    expect(composed).toBeUndefined();
  });
});

/**
 * D-156.4 and `specs/124-instance-customisation-gap/` FR-003 — a decorated
 * `asValue` registration is resolvable **from a singleton**, which is where the
 * defect was invisible.
 *
 * D-156.4 sanctions a deployment overlay wrapping the root-supplied names by
 * name — `commandBus`, `auditLogService`, `eventBus`, `emFactory` — and every
 * one of them is registered through `registerValues`, i.e. `asValue`. In
 * `awilix@13.0.5` `asValue` is the pair `{ resolve, isLeakSafe: true }` with no
 * `lifetime`, and `throwIfLifetimeLeakage` short-circuits on `isLeakSafe`. The
 * drain used to re-register the wrapper as
 * `asFunction(…).setLifetime(inner.lifetime ?? Lifetime.TRANSIENT)`, which reads
 * the missing `lifetime` and drops its partner: the wrapper asserted TRANSIENT
 * and was no longer leak-safe, so the first SINGLETON ancestor to resolve the
 * name raised `AwilixResolutionError: … has a shorter lifetime than its
 * ancestor` and the boot died.
 *
 * **Both shapes are pinned below on purpose.** Resolving the decorated name
 * straight off the container never threw — the leak check compares against a
 * resolving *ancestor* and there is none — so a test written that way goes green
 * over the bug. It is kept as the discrimination rather than deleted.
 */
describe('FR-003 — a wrapped asValue survives resolution through a singleton', () => {
  /**
   * A module whose service is a `singleton()` taking one name off the cradle
   * **while the factory runs**.
   *
   * Reading the cradle lazily from a method instead would resolve the
   * dependency with an empty `resolutionStack`, where `throwIfLifetimeLeakage`
   * has no ancestor to compare against — green over the bug, for the same
   * reason a direct `container.resolve` is. Measured: the first draft of this
   * fixture deferred the read and all three cases below passed unrepaired.
   */
  function singletonConsumer(id: string, dependency: string): ModuleEntry {
    return {
      id,
      version: '1.0.0',
      registerModule: (ctx: ModuleContext): void => {
        ctx.di.register({
          consumer: ctx
            .asFunction((cradle: KernelCradle) => {
              const resolved = cradle[dependency];
              return { read: (): unknown => resolved };
            })
            .singleton(),
        });
      },
    };
  }

  it('resolves a root-supplied name an overlay wrapped, through a singleton ancestor', () => {
    // The measured red, in its smallest form: `commandBus` behind a module that
    // resolves it. This is A8's own pair.
    const container = createRootContainer();
    registerValues(container, { commandBus: 'the-audited-write-path' });

    composeModules(
      [
        {
          id: 'acme_overlay',
          version: '1.0.0',
          overlay: true,
          registerModule: (ctx) =>
            ctx.di.decorate<string>('commandBus', (inner) => `${inner}+wrapped`),
        },
        singletonConsumer('catalog', 'commandBus'),
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    expect(container.resolve<{ read: () => unknown }>('consumer').read()).toBe(
      'the-audited-write-path+wrapped',
    );
  });

  it('resolves the same name straight off the container — which never broke', () => {
    // Kept because it is the shape that hid the defect: no resolving ancestor,
    // no leak check, green either way.
    const container = createRootContainer();
    registerValues(container, { commandBus: 'the-audited-write-path' });

    composeModules(
      [
        {
          id: 'acme_overlay',
          version: '1.0.0',
          overlay: true,
          registerModule: (ctx) =>
            ctx.di.decorate<string>('commandBus', (inner) => `${inner}+wrapped`),
        },
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    expect(container.resolve<string>('commandBus')).toBe('the-audited-write-path+wrapped');
  });

  it('resolves a module-owned asValue an overlay wrapped, through a singleton ancestor', () => {
    // `registerValues` is not the only producer of an `asValue`: `ctx.asValue`
    // is one too, and `storefrontBaseUrl` behind `organizations` was the second
    // measured pair. The repair is about the resolver's shape, not about who
    // registered it.
    const container = createRootContainer();

    composeModules(
      [
        owner('price_lists', 'core'),
        overlayDecorator('acme_overlay', 'acme'),
        singletonConsumer('organizations', 'label'),
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    expect(container.resolve<{ read: () => unknown }>('consumer').read()).toBe('core+acme');
  });

  it('resolves a chain of two wraps over one asValue, in call order', () => {
    // The second wrap's inner is the first wrap — a SINGLETON, not an `asValue`
    // — so it takes the ordinary `inner.lifetime` branch. Nothing is
    // special-cased for a second decoration, and this is what says so.
    const container = createRootContainer();

    composeModules(
      [
        owner('price_lists', 'core'),
        overlayDecorator('acme_overlay', 'one', 'two'),
        singletonConsumer('organizations', 'label'),
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    expect(container.resolve<{ read: () => unknown }>('consumer').read()).toBe('core+one+two');
  });

  it('gives one object to every resolution of a wrapped asValue', () => {
    // The property a consumer of an `asValue` actually relies on, and the
    // reason SINGLETON is the right answer rather than a way past the guard:
    // two resolutions of a name whose whole contract is "one object" must not
    // hand back two wrappers.
    const container = createRootContainer();
    registerValues(container, { auditLogService: { write: (): void => {} } });

    composeModules(
      [
        {
          id: 'acme_overlay',
          version: '1.0.0',
          overlay: true,
          registerModule: (ctx) =>
            ctx.di.decorate<object>('auditLogService', (inner) => ({ ...inner, wrapped: true })),
        },
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    expect(container.resolve<object>('auditLogService')).toBe(
      container.resolve<object>('auditLogService'),
    );
  });
});

/**
 * FR-004 — every **other** inner resolver keeps the lifetime it had.
 *
 * The repair is about `asValue` alone. A wrap over a transient stays transient,
 * and a wrap that reaches for a genuinely scoped registration still throws —
 * that guard doing its job is the thing the `.singleton()` branch must not buy
 * its way past.
 */
describe('FR-004 — the wrapper keeps a non-asValue inner’s lifetime', () => {
  it('stays transient over a transient inner', () => {
    const container = createRootContainer();

    composeModules(
      [
        {
          id: 'price_lists',
          version: '1.0.0',
          registerModule: (ctx) =>
            ctx.di.register({ ticket: ctx.asFunction(() => ({ id: {} })).transient() }),
        },
        {
          id: 'acme_overlay',
          version: '1.0.0',
          overlay: true,
          registerModule: (ctx) => ctx.di.decorate<object>('ticket', (inner) => inner),
        },
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    expect(container.resolve<object>('ticket')).not.toBe(container.resolve<object>('ticket'));
  });

  it('still refuses a singleton that reaches through a wrap for a scoped inner', () => {
    const container = createRootContainer();

    composeModules(
      [
        {
          id: 'price_lists',
          version: '1.0.0',
          registerModule: (ctx) =>
            ctx.di.register({ perScope: ctx.asFunction(() => ({ id: {} })).scoped() }),
        },
        {
          id: 'acme_overlay',
          version: '1.0.0',
          overlay: true,
          registerModule: (ctx) => ctx.di.decorate<object>('perScope', (inner) => inner),
        },
        {
          id: 'catalog',
          version: '1.0.0',
          registerModule: (ctx) =>
            ctx.di.register({
              consumer: ctx
                .asFunction((cradle: KernelCradle) => {
                  const resolved = cradle['perScope'];
                  return { read: (): unknown => resolved };
                })
                .singleton(),
            }),
        },
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    expect(() => container.resolve<{ read: () => unknown }>('consumer')).toThrow(
      /shorter lifetime/,
    );
  });
});
