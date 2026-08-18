import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { Worker } from 'bullmq';
import { registerErrorEnvelope } from '../../../src/http/error-envelope.js';
import { EventBus } from '../../../src/events/bus.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { createRootContainer, registerValues } from '../../../src/kernel/container.js';
import {
  createModuleContext,
  createModuleRegistrationSink,
  createRegistrationOwnership,
  ForeignDecorationError,
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
    const worker = { name: 'fixture-queue', pause, on: vi.fn() } as unknown as Worker;

    registryCache.__setEnabledForTesting([]);
    const returned = ctx.worker(worker);

    expect(returned).toBe(worker);
    expect(sink.workers).toEqual([worker]);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('leaves the worker running when the module is present', () => {
    const { ctx } = build();
    const pause = vi.fn(async () => {});
    const worker = { name: 'fixture-queue', pause, on: vi.fn() } as unknown as Worker;

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
