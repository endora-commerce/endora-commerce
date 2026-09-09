import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { Worker } from 'bullmq';
import { registerErrorEnvelope } from '../../../src/http/error-envelope.js';
import { EventBus } from '@endora-commerce/platform/events';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { createRootContainer, registerValues } from '../../../src/kernel/container.js';
import {
  createModuleContext,
  createModuleRegistrationSink,
  createRegistrationOwnership,
  DuplicateRegistrationError,
  ForeignDecorationError,
  ForeignRegistrationError,
  type ModuleContext,
  type ModuleRegistrationSink,
} from '../../../src/kernel/module-context.js';

/**
 * `ModuleContext` is the only kernel surface a module sees, so the property that
 * matters is not "it has these methods" but "everything it accepts arrives
 * wrapped in the lifecycle helper". A module cannot forget to gate, because it
 * never registers anything directly.
 *
 * Deliberately a unit test over a bare Fastify app: no `setupBackendServer`, no
 * database, no Redis.
 */

const MODULE_ID = 'fixture_kernel_module';

function build(): { ctx: ModuleContext; sink: ModuleRegistrationSink; bus: EventBus } {
  const container = createRootContainer();
  const sink = createModuleRegistrationSink();
  const bus = new EventBus();
  const ctx = createModuleContext({
    module: { id: MODULE_ID, version: '1.0.0' },
    container,
    eventBus: bus,
    sink,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  return { ctx, sink, bus };
}

afterEach(() => {
  registryCache.__setEnabledForTesting([]);
});

describe('ModuleContext — registration', () => {
  it('registers a class the container can resolve', () => {
    const container = createRootContainer();
    const ctx = createModuleContext({
      module: { id: MODULE_ID, version: '1.0.0' },
      container,
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    class Greeter {
      greet(): string {
        return 'hello';
      }
    }
    ctx.di.register({ greeter: ctx.asClass(Greeter).singleton() });
    expect(container.resolve<Greeter>('greeter').greet()).toBe('hello');
  });

  it('constructs nothing until something resolves it', () => {
    const container = createRootContainer();
    const ctx = createModuleContext({
      module: { id: MODULE_ID, version: '1.0.0' },
      container,
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const constructed = vi.fn();
    class Expensive {
      constructor() {
        constructed();
      }
    }
    ctx.di.register({ expensive: ctx.asClass(Expensive).singleton() });
    expect(constructed).not.toHaveBeenCalled();
    container.resolve('expensive');
    expect(constructed).toHaveBeenCalledTimes(1);
  });
});

describe('ModuleContext — decoration (D-28)', () => {
  it('wraps the previous registration instead of replacing it', () => {
    const container = createRootContainer();
    const ctx = createModuleContext({
      module: { id: MODULE_ID, version: '1.0.0' },
      container,
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    ctx.di.register({ pricing: ctx.asValue({ price: () => 100 }) });
    ctx.di.decorate<{ price: () => number }>('pricing', (inner) => ({
      price: () => inner.price() + 5,
    }));
    expect(container.resolve<{ price: () => number }>('pricing').price()).toBe(105);
  });

  it('composes a chain of decorations in registration order', () => {
    const container = createRootContainer();
    const ctx = createModuleContext({
      module: { id: MODULE_ID, version: '1.0.0' },
      container,
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    ctx.di.register({ label: ctx.asValue('core') });
    ctx.di.decorate<string>('label', (inner) => `${inner}+a`);
    ctx.di.decorate<string>('label', (inner) => `${inner}+b`);
    expect(container.resolve<string>('label')).toBe('core+a+b');
  });

  it('refuses to decorate a name nothing registered, naming the module', () => {
    const { ctx } = build();
    expect(() => ctx.di.decorate('missingService', (inner) => inner)).toThrow(
      /fixture_kernel_module.*missingService|missingService/,
    );
  });
});

/**
 * Decoration is a write into another module's container entry, so the one
 * question `decorate` never asked is who owns the entry (issue #203).
 *
 * Both values were already in hand at the call site — the decorating module's
 * id and, from the ownership ledger, the registering module's — and the entry
 * recorded both while comparing neither. Any module could therefore wrap any
 * registration: `commandBus` to observe every audited write, `auditLogService`
 * to change what the audit records, another module's read port to sit between
 * a consumer and its owner with nothing declared anywhere.
 *
 * The rule is ownership, with one exemption that is not a module's to claim:
 * a module may decorate only what it registered; the **deployment's own**
 * modules may decorate anything.
 */
describe('ModuleContext — decoration is owner-scoped (issue #203)', () => {
  function composedContext(
    moduleId: string,
    extra: { overlay?: boolean } = {},
  ): { ctx: ModuleContext; container: ReturnType<typeof createRootContainer> } {
    return contextsSharing(createRootContainer(), createRegistrationOwnership(), moduleId, extra);
  }

  function contextsSharing(
    container: ReturnType<typeof createRootContainer>,
    ownership: ReturnType<typeof createRegistrationOwnership>,
    moduleId: string,
    extra: { overlay?: boolean } = {},
  ): { ctx: ModuleContext; container: ReturnType<typeof createRootContainer> } {
    const ctx = createModuleContext({
      module: { id: moduleId, version: '1.0.0' },
      container,
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
      ownership,
      ...(extra.overlay === undefined ? {} : { overlay: extra.overlay }),
    });
    return { ctx, container };
  }

  it('allows a module to decorate its own registration', () => {
    const { ctx, container } = composedContext('price_lists');
    ctx.di.register({ pricingService: ctx.asValue('core') });
    ctx.di.decorate<string>('pricingService', (inner) => `${inner}+own`);

    expect(container.resolve<string>('pricingService')).toBe('core+own');
  });

  it("refuses a module decorating another module's registration", () => {
    const container = createRootContainer();
    const ownership = createRegistrationOwnership();
    const owner = contextsSharing(container, ownership, 'price_lists').ctx;
    owner.di.register({ pricingService: owner.asValue('core') });

    const intruder = contextsSharing(container, ownership, 'promotions').ctx;

    let thrown: unknown;
    try {
      intruder.di.decorate<string>('pricingService', (inner) => `${inner}+intruder`);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ForeignDecorationError);
    // Both modules and the name: "who is wrapping what, and whose is it" is
    // three facts, and an error missing one of them sends the reader to grep.
    expect((thrown as Error).message).toContain('promotions');
    expect((thrown as Error).message).toContain('price_lists');
    expect((thrown as Error).message).toContain('pricingService');
    // Refused before anything is registered, so a rejected decoration leaves
    // the container as it was rather than half-wrapped.
    expect(container.resolve<string>('pricingService')).toBe('core');
  });

  it('refuses a module decorating a name a composition root registered', () => {
    // `commandBus`, `auditLogService`, `redis`: no module owns them, so an
    // ownership comparison that read "unowned" as "fair game" would leave the
    // highest-value targets in the platform undefended.
    const { ctx, container } = composedContext('promotions');
    registerValues(container, { commandBus: { run: () => 'audited' } });

    expect(() => ctx.di.decorate('commandBus', (inner) => inner)).toThrow(ForeignDecorationError);
  });

  it('holds for a context that tracks no ownership ledger', () => {
    // A hand-built context — every unit-test fixture in the tree — carries no
    // ownership ledger. If "no ledger" meant "no owner to compare", the rule
    // would be off by construction for exactly those contexts, and a green
    // suite would mean the guard was never looked at. The context answers the
    // question from its own registrations instead.
    const container = createRootContainer();
    registerValues(container, { auditLogService: { record: () => undefined } });
    const ctx = createModuleContext({
      module: { id: 'promotions', version: '1.0.0' },
      container,
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(() => ctx.di.decorate('auditLogService', (inner) => inner)).toThrow(
      ForeignDecorationError,
    );
    // And the same context may still wrap what it registered itself, which is
    // what distinguishes this from refusing every decoration.
    ctx.di.register({ own: ctx.asValue('core') });
    ctx.di.decorate<string>('own', (inner) => `${inner}+own`);
    expect(container.resolve<string>('own')).toBe('core+own');
  });

  it("lets a deployment's overlay module decorate a core registration", () => {
    // The one legitimate cross-owner decoration, and it is not the same act.
    // A core module wrapping another core module's registration is a coupling
    // nothing declares; a deployment wrapping core is the sanctioned
    // per-deployment customisation seam (feature 072 replaced file shadowing
    // with it), and it is the deployment's own platform to customise.
    //
    // The exemption is structural, not a claim: `overlay` is set by the
    // generated composer from the root the module was discovered under
    // (`backend/src/apps/<deployment>/modules/`), so a core module has no way
    // to assert it and `overlay:check` fails on a hand-edited artefact.
    const container = createRootContainer();
    const ownership = createRegistrationOwnership();
    const core = contextsSharing(container, ownership, 'price_lists').ctx;
    core.di.register({ pricingService: core.asValue('core') });

    const client = contextsSharing(container, ownership, 'acme_pricing', { overlay: true }).ctx;
    client.di.decorate<string>('pricingService', (inner) => `acme:${inner}`);

    expect(container.resolve<string>('pricingService')).toBe('acme:core');
  });

  it("lets a deployment's overlay module decorate a name no module owns", () => {
    // The half of the exemption nothing asserted, and the load-bearing one
    // (D-156.4). The case above proves an overlay may wrap a *core module's*
    // registration, which is the act `ForeignDecorationError`'s doc argues
    // for. But `overlay` is a per-module boolean and the check is
    // name-unscoped, so the exemption also covers the root-registered set no
    // module claimed — `commandBus`, `auditLogService`, `eventBus`,
    // `emFactory` — which the same doc calls the highest-value targets in the
    // platform. The doc said one thing and the code did another; D-156.11
    // records the code as correct.
    //
    // Pinned rather than left merely true. A deployment owns its instance and
    // is not the stranger this guard defends against, so the exemption stays —
    // and a later reader narrowing the condition to match the older prose
    // should meet a red test carrying the reason, not a silent behaviour
    // change. It is also the measurement behind D-156.4: because the flag
    // reaches this set, it can never be the vehicle for granting an installed
    // *package* decoration.
    const container = createRootContainer();
    const ownership = createRegistrationOwnership();
    registerValues(container, { commandBus: { run: (): string => 'audited' } });

    // The discrimination: an ordinary module is refused the same name, so this
    // asserts the exemption rather than the guard being absent.
    const core = contextsSharing(container, ownership, 'promotions').ctx;
    expect(() => core.di.decorate('commandBus', (inner) => inner)).toThrow(ForeignDecorationError);

    const client = contextsSharing(container, ownership, 'acme_audit', { overlay: true }).ctx;
    client.di.decorate<{ run: () => string }>('commandBus', (inner) => ({
      run: () => `acme:${inner.run()}`,
    }));

    expect(container.resolve<{ run: () => string }>('commandBus').run()).toBe('acme:audited');
  });
});

/**
 * The door beside the guarded one (D-156.6).
 *
 * Refusing a module the right to **wrap** `auditLogService` while leaving it
 * free to **replace** it is not a boundary. `registerValues` claims no
 * ownership, and `claim` threw only when a *different module* already owned the
 * name — so any module could register `commandBus`, become its owner, and
 * thereafter decorate it legally, because `ForeignDecorationError` fires only
 * for a name someone else owns.
 *
 * The refused set is derived and nothing is written down (D-100, D-156.5): a
 * name the container already holds that no module claimed is a name a
 * composition root supplied. That is the same question `decorate` has always
 * asked, asked one act earlier.
 */
describe('ModuleContext — registration is owner-scoped (D-156.6)', () => {
  function contextOver(
    container: ReturnType<typeof createRootContainer>,
    ownership: ReturnType<typeof createRegistrationOwnership> | undefined,
    moduleId: string,
    extra: { overlay?: boolean } = {},
  ): ModuleContext {
    return createModuleContext({
      module: { id: moduleId, version: '1.0.0' },
      container,
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
      ...(ownership === undefined ? {} : { ownership }),
      ...(extra.overlay === undefined ? {} : { overlay: extra.overlay }),
    });
  }

  it('refuses a module registering over a name a composition root supplies', () => {
    const container = createRootContainer();
    registerValues(container, { commandBus: { run: (): string => 'audited' } });
    const ctx = contextOver(container, createRegistrationOwnership(), 'promotions');

    let thrown: unknown;
    try {
      ctx.di.register({ commandBus: ctx.asValue({ run: (): string => 'mine' }) });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ForeignRegistrationError);
    // The name and the module, for the same reason `ForeignDecorationError`
    // names three facts: an error missing one sends its reader to grep.
    expect((thrown as Error).message).toContain('promotions');
    expect((thrown as Error).message).toContain('commandBus');
    // And the seam it points at has to exist. D-29's rung 1 lists "Command Bus
    // handlers"; `CommandBus.run` takes command objects and has no registry, so
    // an author sent there finds nothing (D-156.11).
    expect((thrown as Error).message).not.toContain('Command Bus handler');
    expect((thrown as Error).message).toContain('ctx.subscribe');
    expect((thrown as Error).message).toContain('ctx.interceptors');
    expect((thrown as Error).message).toContain('providePort');

    // Refused before anything is written: the root's value still resolves.
    expect(container.resolve<{ run: () => string }>('commandBus').run()).toBe('audited');
  });

  it('refuses the same name through providePort — one claim, two doors', () => {
    // `providePort` claims ownership exactly as `register` does, so a guard on
    // one of them is the lock on the front door of a house with a side door.
    const container = createRootContainer();
    registerValues(container, { auditLogService: { record: (): void => undefined } });
    const ctx = contextOver(container, createRegistrationOwnership(), 'promotions');

    expect(() =>
      ctx.di.providePort('auditLogService', ctx.asValue({ record: (): void => undefined })),
    ).toThrow(ForeignRegistrationError);
  });

  it('lets a module register its own new name — the discrimination that matters', () => {
    const container = createRootContainer();
    registerValues(container, { commandBus: { run: (): string => 'audited' } });
    const ctx = contextOver(container, createRegistrationOwnership(), 'promotions');

    ctx.di.register({ promotionService: ctx.asValue('mine') });
    ctx.di.providePort('promotionCodePort', ctx.asValue('port'));

    expect(container.resolve<string>('promotionService')).toBe('mine');
    // And re-registering its own name stays legal: a module owns it already.
    ctx.di.register({ promotionService: ctx.asValue('mine-again') });
    expect(container.resolve<string>('promotionService')).toBe('mine-again');
  });

  it("still refuses a name another module owns, as DuplicateRegistrationError", () => {
    // The existing answer survives. Which error fires is not cosmetic: one
    // names two modules and tells the loser to decorate, the other names a root
    // that cannot be asked for anything and sends the author to a seam.
    const container = createRootContainer();
    const ownership = createRegistrationOwnership();
    const owner = contextOver(container, ownership, 'price_lists');
    owner.di.register({ pricingService: owner.asValue('core') });

    const intruder = contextOver(container, ownership, 'promotions');

    let thrown: unknown;
    try {
      intruder.di.register({ pricingService: intruder.asValue('mine') });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(DuplicateRegistrationError);
    expect(thrown).not.toBeInstanceOf(ForeignRegistrationError);
    expect(container.resolve<string>('pricingService')).toBe('core');
  });

  it('holds for a context that tracks no ownership ledger', () => {
    // Every hand-built fixture in the tree carries none. If "no ledger" read as
    // "no owner to compare", the guard would be off by construction for exactly
    // those contexts and a green suite would mean it was never looked at.
    const container = createRootContainer();
    registerValues(container, { redis: { quit: (): void => undefined } });
    const ctx = contextOver(container, undefined, 'promotions');

    expect(() => ctx.di.register({ redis: ctx.asValue('mine') })).toThrow(ForeignRegistrationError);
    // And the same context may still register what is its own.
    ctx.di.register({ own: ctx.asValue('core') });
    expect(container.resolve<string>('own')).toBe('core');
  });

  it('registers nothing at all when one name of a batch is refused', () => {
    // A refused registration leaves the container as it was, rather than
    // half-written — the property `decorate` already has.
    const container = createRootContainer();
    registerValues(container, { eventBus: 'host-bus' });
    const ctx = contextOver(container, createRegistrationOwnership(), 'promotions');

    expect(() =>
      ctx.di.register({
        promotionService: ctx.asValue('mine'),
        eventBus: ctx.asValue('mine-bus'),
      }),
    ).toThrow(ForeignRegistrationError);

    expect(container.hasRegistration('promotionService')).toBe(false);
    expect(container.resolve<string>('eventBus')).toBe('host-bus');
  });

  it("does not disturb an overlay module's own registrations", () => {
    // D-156 leaves the overlay decoration exemption standing deliberately — a
    // deployment owns its instance. This guard is about *registration*, and the
    // thing an overlay module actually does is register its own names.
    const container = createRootContainer();
    const ownership = createRegistrationOwnership();
    registerValues(container, { commandBus: { run: (): string => 'audited' } });
    const core = contextOver(container, ownership, 'price_lists');
    core.di.register({ pricingService: core.asValue('core') });

    const client = contextOver(container, ownership, 'acme_pricing', { overlay: true });
    client.di.register({ acmeContractPricing: client.asValue('acme') });
    expect(container.resolve<string>('acmeContractPricing')).toBe('acme');

    // Its sanctioned way to change core's behaviour is untouched.
    client.di.decorate<string>('pricingService', (inner) => `acme:${inner}`);
    expect(container.resolve<string>('pricingService')).toBe('acme:core');

    // Replacement is not decoration, and D-28 requires it to be the *more*
    // explicit act. It is refused for a deployment too: what a deployment has
    // is `decorate`, above.
    expect(() =>
      client.di.register({ commandBus: client.asValue({ run: (): string => 'acme' }) }),
    ).toThrow(ForeignRegistrationError);
  });

  it('closes the claim-then-decorate sequence, not just the single call', () => {
    // The whole hole, walked end to end: register `commandBus` to become its
    // owner, then decorate it legally because `ForeignDecorationError` fires
    // only for a name someone *else* owns. The first step now throws, and the
    // second still throws after it — so the sequence is closed at both ends
    // rather than the second step resting on the first having been refused.
    const container = createRootContainer();
    const ownership = createRegistrationOwnership();
    const ctx = contextOver(container, ownership, 'promotions');
    registerValues(container, { commandBus: { run: (): string => 'audited' } });

    expect(() => ctx.di.register({ commandBus: ctx.asValue({ run: () => 'mine' }) })).toThrow(
      ForeignRegistrationError,
    );
    expect(ownership.ownerOf('commandBus')).toBeUndefined();
    expect(() => ctx.di.decorate('commandBus', (inner) => inner)).toThrow(ForeignDecorationError);
    expect(container.resolve<{ run: () => string }>('commandBus').run()).toBe('audited');
  });
});

describe('ModuleContext — routes delegate to defineModuleRoutes', () => {
  it('serves the route while the module is present and 503s while it is absent', async () => {
    const { ctx, sink } = build();
    ctx.routes(async (app) => {
      app.get('/api/v1/admin/fixture-kernel/ping', async () => ({ ok: true }));
    });
    expect(sink.plugins).toHaveLength(1);

    const app = Fastify();
    registerErrorEnvelope(app);
    await sink.plugins[0]!(app);
    await app.ready();

    registryCache.__setEnabledForTesting([MODULE_ID]);
    const present = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/fixture-kernel/ping',
    });
    expect(present.statusCode).toBe(200);

    registryCache.__setEnabledForTesting([]);
    const absent = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/fixture-kernel/ping',
    });
    expect(absent.statusCode).toBe(503);
    expect(absent.headers['retry-after']).toBe('60');

    await app.close();
  });
});

/**
 * D-36b. The gate is the default and every ordinary surface goes through it;
 * the one exemption is a surface that *reports on the platform*, which cannot
 * be gated on a part of the platform without becoming circular. `_lifecycle`
 * already registers its presence projection outside the gate by hand
 * (`routes.admin.ts:102-107`); a module that owns a probe needs the same, and
 * has to state why.
 */
describe('ModuleContext — ungatedRoutes stays outside the gate', () => {
  it('serves the route whether or not the module is present', async () => {
    const { ctx, sink } = build();
    ctx.ungatedRoutes(
      'Liveness probe: an orchestrator restarts the container on a 503.',
      async (app) => {
        app.get('/api/v1/_fixture-health', async () => ({ ok: true }));
      },
    );
    expect(sink.plugins).toHaveLength(1);

    const app = Fastify();
    registerErrorEnvelope(app);
    await sink.plugins[0]!(app);
    await app.ready();

    registryCache.__setEnabledForTesting([MODULE_ID]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/_fixture-health' })).statusCode).toBe(
      200,
    );

    registryCache.__setEnabledForTesting([]);
    const absent = await app.inject({ method: 'GET', url: '/api/v1/_fixture-health' });
    expect(absent.statusCode).toBe(200);
    expect(absent.headers['retry-after']).toBeUndefined();

    await app.close();
  });

  it('refuses an exemption that states no reason', () => {
    const { ctx } = build();
    expect(() => ctx.ungatedRoutes('  ', () => {})).toThrow(/fixture_kernel_module/);
  });
});

describe('ModuleContext — worker delegates to defineModuleWorker', () => {
  it('returns the same instance and pauses it when the module is absent', () => {
    const { ctx, sink } = build();
    const pause = vi.fn(async () => {});
    const worker = {
      name: 'fixture-queue',
      pause,
      resume: vi.fn(),
      isPaused: vi.fn(() => false),
      processFn: async () => undefined,
      on: vi.fn(),
    } as unknown as Worker;

    registryCache.__setEnabledForTesting([]);
    const returned = ctx.worker(worker);

    expect(returned).toBe(worker);
    expect(sink.workers).toEqual([worker]);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('leaves the worker running when the module is present', () => {
    const { ctx } = build();
    const pause = vi.fn(async () => {});
    const worker = {
      name: 'fixture-queue',
      pause,
      resume: vi.fn(),
      isPaused: vi.fn(() => false),
      processFn: async () => undefined,
      on: vi.fn(),
    } as unknown as Worker;

    registryCache.__setEnabledForTesting([MODULE_ID]);
    ctx.worker(worker);

    expect(pause).not.toHaveBeenCalled();
  });
});

describe('ModuleContext — subscribe delegates to subscribeForModule', () => {
  it('delivers while the module is present and drops while it is absent', async () => {
    const { ctx, bus } = build();
    const handler = vi.fn();
    ctx.subscribe('fixture.happened', handler);

    registryCache.__setEnabledForTesting([MODULE_ID]);
    bus.emit('fixture.happened', { eventId: '1', occurredAt: 'now' });
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);

    registryCache.__setEnabledForTesting([]);
    bus.emit('fixture.happened', { eventId: '2', occurredAt: 'now' });
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
