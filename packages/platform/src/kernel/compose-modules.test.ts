import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../events/index.js';
import { getTenantContext } from '../tenancy/tenant-context.js';
import { createRootContainer, registerValues } from './container.js';
import {
  DuplicateRegistrationError,
  EagerResolutionError,
  createRegistrationOwnership,
  type ModuleContext,
} from './module-context.js';
import {
  ContributionWindowClosedError,
  composeModules,
  type ModuleEntry,
} from './compose.js';

/**
 * The two composition-time checks (feature 072, T042 / T043).
 *
 * Both guard failures that are silent by default, which is why they are runtime
 * checks in the composer rather than review items:
 *
 *  - **Two modules, one registration name.** Awilix's own behaviour is
 *    last-wins, so the platform runs whichever implementation the composer
 *    happened to emit second. Both modules look correct in isolation and
 *    nothing reports the collision — the bug surfaces months later as
 *    "sometimes it uses the other one".
 *  - **Resolving while registering.** It succeeds whenever the dependency
 *    happens to have registered already, so it passes today and breaks the day
 *    the topological order shifts for an unrelated reason.
 */

function log(): { info: () => void; warn: () => void; error: () => void } {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function entry(id: string, registerModule: (ctx: ModuleContext) => void): ModuleEntry {
  return { id, version: '1.0.0', registerModule };
}

function compose(entries: readonly ModuleEntry[]): ReturnType<typeof composeModules> {
  const container = createRootContainer();
  registerValues(container, { hostValue: 'host' });
  return composeModules(entries, { container, eventBus: new EventBus(), log: log() });
}

describe('T042 — two modules cannot register the same name', () => {
  it('fails naming both module ids and the name', () => {
    const collide = (ctx: ModuleContext): void => {
      ctx.di.register({ pricingService: ctx.asValue({}) });
    };

    let thrown: unknown;
    try {
      compose([entry('price_lists', collide), entry('promotions', collide)]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(DuplicateRegistrationError);
    const message = (thrown as Error).message;
    expect(message).toContain('price_lists');
    expect(message).toContain('promotions');
    expect(message).toContain('pricingService');
    // The sanctioned alternative has to be in the message, or the next author
    // renames their service and the collision comes back under another name.
    expect(message).toContain('decorate');
  });

  it('never silently lets the later module win', () => {
    const container = createRootContainer();
    expect(() =>
      composeModules(
        [
          entry('first', (ctx) => ctx.di.register({ thing: ctx.asValue('from-first') })),
          entry('second', (ctx) => ctx.di.register({ thing: ctx.asValue('from-second') })),
        ],
        { container, eventBus: new EventBus(), log: log() },
      ),
    ).toThrow(DuplicateRegistrationError);
  });

  it('allows decoration, which is how a deployment changes another module’s registration', () => {
    // The remedy the collision error names, and it is the deployment's:
    // `client_module` here is one of the active deployment's overlay modules,
    // so it carries `overlay: true`. A *core* module wrapping another core
    // module's registration is refused (issue #203) —
    // `test/integration/kernel/decoration.test.ts` holds both halves.
    const container = createRootContainer();
    composeModules(
      [
        entry('core_module', (ctx) => ctx.di.register({ label: ctx.asValue('core') })),
        {
          ...entry('client_module', (ctx) =>
            ctx.di.decorate<string>('label', (inner) => `${inner}+client`),
          ),
          overlay: true,
        },
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    expect(container.resolve<string>('label')).toBe('core+client');
  });

  it('lets one module register the same name twice — it cannot collide with itself', () => {
    const container = createRootContainer();
    expect(() =>
      composeModules(
        [
          entry('one_module', (ctx) => {
            ctx.di.register({ thing: ctx.asValue('a') });
            ctx.di.register({ thing: ctx.asValue('b') });
          }),
        ],
        { container, eventBus: new EventBus(), log: log() },
      ),
    ).not.toThrow();
  });

  it('shares one ledger across separate composeModules calls', () => {
    const container = createRootContainer();
    const ownership = createRegistrationOwnership();
    const options = { container, eventBus: new EventBus(), log: log(), ownership };

    composeModules([entry('batch_one', (ctx) => ctx.di.register({ thing: ctx.asValue(1) }))], options);
    expect(() =>
      composeModules(
        [entry('batch_two', (ctx) => ctx.di.register({ thing: ctx.asValue(2) }))],
        options,
      ),
    ).toThrow(/batch_one.*batch_two|batch_two.*batch_one/s);
  });
});

describe('T043 — registration resolves nothing', () => {
  it('refuses a resolution during registerModule, naming the module and the name', () => {
    let thrown: unknown;
    try {
      compose([
        entry('eager_module', (ctx) => {
          ctx.cradle<{ hostValue: string }>().hostValue;
        }),
      ]);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(EagerResolutionError);
    expect((thrown as Error).message).toContain('eager_module');
    expect((thrown as Error).message).toContain('hostValue');
  });

  it('refuses it even for a name that is already registered — order is the point, not availability', () => {
    expect(() =>
      compose([
        entry('provider', (ctx) => ctx.di.register({ thing: ctx.asValue('present') })),
        entry('consumer', (ctx) => {
          ctx.cradle<{ thing: string }>().thing;
        }),
      ]),
    ).toThrow(EagerResolutionError);
  });

  it('still refuses through a cradle captured during registration', () => {
    // The guard is on the property read, not on the call, so stashing the
    // object and reading it a line later does not slip past.
    expect(() =>
      compose([
        entry('sneaky_module', (ctx) => {
          const cradle = ctx.cradle<{ hostValue: string }>();
          ctx.di.register({ thing: ctx.asValue(cradle.hostValue) });
        }),
      ]),
    ).toThrow(EagerResolutionError);
  });

  it('allows the same cradle to resolve once composition is over', () => {
    let read: (() => string) | undefined;
    compose([
      entry('deferred_module', (ctx) => {
        const cradle = ctx.cradle<{ hostValue: string }>();
        read = () => cradle.hostValue;
      }),
    ]);

    expect(read?.()).toBe('host');
  });

  it('reopens the guard for the next composition pass', () => {
    // `registering` is per-call, not process-global: a root that composes in
    // batches must not leave the guard permanently off after the first batch.
    expect(() =>
      compose([
        entry('late_module', (ctx) => {
          ctx.cradle<{ hostValue: string }>().hostValue;
        }),
      ]),
    ).toThrow(EagerResolutionError);
  });
});

describe('composeModules — the boot phase', () => {
  it('runs hooks in registration order, after every module has registered', async () => {
    const order: string[] = [];
    const container = createRootContainer();
    const composed = composeModules(
      [
        entry('first', (ctx) => {
          ctx.di.register({ firstThing: ctx.asValue('1') });
          ctx.onBoot(() => {
            // Resolving the *second* module's registration proves the phase
            // runs after the whole pass, not after this module's own turn.
            order.push(`first sees ${ctx.cradle<{ secondThing: string }>().secondThing}`);
          });
        }),
        entry('second', (ctx) => {
          ctx.di.register({ secondThing: ctx.asValue('2') });
          ctx.onBoot(() => {
            order.push('second');
          });
        }),
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    expect(order).toEqual([]);
    await composed.runBootHooks();
    expect(order).toEqual(['first sees 2', 'second']);
  });

  it('runs each hook inside a system scope that names the module', async () => {
    // `test/tenancy-setup.ts` already puts every test in a system context, so
    // asserting the mode alone would be vacuous — the reason is what proves
    // *this* scope was entered here rather than inherited.
    const container = createRootContainer();
    const seen = vi.fn();
    const composed = composeModules(
      [
        entry('scoped_module', (ctx) => {
          ctx.onBoot(() => {
            const tenant = getTenantContext();
            seen(`${tenant?.mode ?? 'none'}:${tenant?.reason ?? 'none'}`);
          });
        }),
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    await composed.runBootHooks();
    expect(seen).toHaveBeenCalledWith('system:boot: scoped_module');
  });
});

/**
 * The contribution window (D-45, issue #52).
 *
 * A root's contribution over a name a module defaults has exactly one legal
 * slot: after `composeModules(MODULES, …)` and before `runBootHooks()`. Earlier
 * and the module's own registration overwrites it; later and a boot hook has
 * already read the default it was meant to replace.
 *
 * That was a convention two composition roots had to remember identically, so
 * it is a method on what `composeModules` returns. The **early** half is then
 * structural rather than checked: there is no object to call `contribute` on
 * until the registration pass is over. The **late** half is what these tests
 * pin, because the object outlives the window.
 */
describe('issue #52 — the contribution window is a method, not a convention', () => {
  function moduleWithDefault(): ModuleEntry {
    return entry('defaulting_module', (ctx) => {
      ctx.di.register({ mailer: ctx.asValue('module-default') });
    });
  }

  it('overwrites the default a module registered', () => {
    const container = createRootContainer();
    const composed = composeModules([moduleWithDefault()], {
      container,
      eventBus: new EventBus(),
      log: log(),
    });

    expect(container.resolve<string>('mailer')).toBe('module-default');
    composed.contribute({ mailer: 'root-contribution' });
    expect(container.resolve<string>('mailer')).toBe('root-contribution');
  });

  it('is visible to every boot hook, which is what the window is for', async () => {
    const seen: string[] = [];
    const container = createRootContainer();
    const composed = composeModules(
      [
        entry('defaulting_module', (ctx) => {
          ctx.di.register({ mailer: ctx.asValue('module-default') });
          ctx.onBoot(() => {
            seen.push(ctx.cradle<{ mailer: string }>().mailer);
          });
        }),
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    composed.contribute({ mailer: 'root-contribution' });
    await composed.runBootHooks();

    expect(seen).toEqual(['root-contribution']);
  });

  it('refuses a contribution once the boot phase has started', async () => {
    const container = createRootContainer();
    const composed = composeModules([moduleWithDefault()], {
      container,
      eventBus: new EventBus(),
      log: log(),
    });

    await composed.runBootHooks();

    let thrown: unknown;
    try {
      composed.contribute({ mailer: 'too-late' });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ContributionWindowClosedError);
    // The message states the rule, because the reader who hits this is holding a
    // value and no idea where it should have gone.
    const message = (thrown as Error).message;
    expect(message).toContain('mailer');
    expect(message).toContain('composeModules');
    expect(message).toContain('runBootHooks');
    // And the value did not land: a refusal that still writes is worse than none.
    expect(container.resolve<string>('mailer')).toBe('module-default');
  });

  it('refuses one made from inside a boot hook — the window closes when the phase starts', async () => {
    const container = createRootContainer();
    let thrown: unknown;
    const composed = composeModules(
      [
        moduleWithDefault(),
        entry('late_contributor', (ctx) => {
          ctx.onBoot(() => {
            try {
              composed.contribute({ mailer: 'from-a-boot-hook' });
            } catch (err) {
              thrown = err;
            }
          });
        }),
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    await composed.runBootHooks();

    // Not merely stylistic: hooks run in registration order, so a contribution
    // made from one is invisible to every hook that already ran. "After the
    // phase finished" and "during it" are the same defect.
    expect(thrown).toBeInstanceOf(ContributionWindowClosedError);
    expect(container.resolve<string>('mailer')).toBe('module-default');
  });

  it('contributes every name it is given, so a root writes one call per cluster', () => {
    const container = createRootContainer();
    const composed = composeModules([moduleWithDefault()], {
      container,
      eventBus: new EventBus(),
      log: log(),
    });

    composed.contribute({ mailer: 'a', extraPort: 'b' });

    expect(container.resolve<string>('mailer')).toBe('a');
    expect(container.resolve<string>('extraPort')).toBe('b');
  });
});

/**
 * D-156.6 — a module may not register over a name a composition root supplies.
 *
 * The composition-level half of the guard, driven through the real
 * `composeModules` rather than a hand-built context: the refusal has to hold in
 * the shape a deployment actually runs, and it has to be attributed to the
 * module that wrote it, which is what `ModuleCompositionError` does for every
 * other registration failure.
 *
 * The set it refuses is derived on every composition — a name the container
 * holds that no module claimed — so a root that starts or stops supplying a
 * name changes the answer in the same run and there is no list to keep true
 * (D-100, D-156.5).
 */
describe('D-156.6 — a root-supplied name is not a module to take', () => {
  it('refuses the registration, naming the module and the name', () => {
    let thrown: unknown;
    try {
      compose([
        entry('promotions', (ctx) => {
          ctx.di.register({ hostValue: ctx.asValue('mine') });
        }),
      ]);
    } catch (err) {
      thrown = err;
    }

    const message = (thrown as Error).message;
    expect(message).toContain('promotions');
    expect(message).toContain('hostValue');
  });

  it('leaves the root value resolving, so a refused composition changes nothing', () => {
    const container = createRootContainer();
    registerValues(container, { commandBus: 'the-audited-write-path' });

    expect(() =>
      composeModules(
        [
          entry('promotions', (ctx) => {
            ctx.di.register({ commandBus: ctx.asValue('mine') });
          }),
        ],
        { container, eventBus: new EventBus(), log: log() },
      ),
    ).toThrow();

    expect(container.resolve<string>('commandBus')).toBe('the-audited-write-path');
  });

  it('does not catch the contribution window, which overwrites a default on purpose', () => {
    // D-45's one slot. `contribute()` runs *after* every module registered, so
    // the name it writes over is one a module owns — the opposite direction to
    // the guard, and legal by design. A guard that read "the container already
    // holds this" without asking who claimed it would break every root.
    const container = createRootContainer();
    const composed = composeModules(
      [
        entry('defaulting_module', (ctx) => {
          ctx.di.register({ mailer: ctx.asValue('module-default') });
        }),
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    composed.contribute({ mailer: 'root-contribution' });

    expect(container.resolve<string>('mailer')).toBe('root-contribution');
  });

  it('lets a later module register a name an earlier one did not take', () => {
    // The discrimination at composition scale: 291 module registrations stand
    // against 17 root-supplied names, and every one of the 291 must still land.
    const container = createRootContainer();
    registerValues(container, { hostValue: 'host' });

    composeModules(
      [
        entry('price_lists', (ctx) => ctx.di.register({ pricingService: ctx.asValue('core') })),
        entry('promotions', (ctx) => ctx.di.register({ promotionService: ctx.asValue('promo') })),
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    expect(container.resolve<string>('pricingService')).toBe('core');
    expect(container.resolve<string>('promotionService')).toBe('promo');
    expect(container.resolve<string>('hostValue')).toBe('host');
  });
});
