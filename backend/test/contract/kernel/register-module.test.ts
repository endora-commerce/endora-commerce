import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { Worker } from 'bullmq';
import { registerErrorEnvelope } from '../../../src/http/error-envelope.js';
import { EventBus } from '../../../src/events/bus.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { ApiInterceptorRegistry } from '../../../src/http/interceptors/index.js';
import {
  composeModules,
  createRootContainer,
  registerValues,
  type ModuleContext,
  type ModuleEntry,
} from '../../../src/kernel/index.js';

/**
 * Contract — `registerModule` (feature 072, T039 / FR-030…FR-035).
 *
 * The claim under test is not "the context has these methods". It is that a
 * module expressed as one `registerModule(ctx)` contributes **all five
 * surfaces** — registrations, routes, a worker, a subscription and
 * interceptors — plus its boot phase, and that each behaves exactly as its
 * hand-wired predecessor did, including the Constitution XVII gating.
 *
 * Install-time work is **not** one of them (D-46): `module:install` runs in a
 * process that composes nothing, so the only install seam is `installHook` /
 * `uninstallHook` exported from a module's `manifest.ts`. The last test in the
 * first block is the guard that keeps the container-side seam deleted.
 *
 * The gating assertions matter most: the fixture module below never mentions
 * `defineModuleRoutes`, `defineModuleWorker` or `subscribeForModule`, and never
 * checks whether it is enabled. It is gated because the **kernel** wrapped the
 * registration, which is the property an author cannot forget.
 *
 * Deliberately service-less: a bare Fastify app, a real `EventBus`, a fake
 * BullMQ worker. No database, no Redis, no `setupBackendServer`.
 */

const MODULE_ID = 'fixture_register_module';

function log(): { info: () => void; warn: () => void; error: () => void } {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

interface Fixture {
  readonly entry: ModuleEntry;
  readonly worker: Worker;
  readonly pause: ReturnType<typeof vi.fn>;
  readonly subscriber: ReturnType<typeof vi.fn>;
  readonly interceptor: ReturnType<typeof vi.fn>;
  readonly booted: ReturnType<typeof vi.fn>;
}

class Greeter {
  constructor(private readonly greeting: string) {}
  greet(): string {
    return this.greeting;
  }
}

/** One module, six surfaces, expressed the way every converted module will be. */
function fixture(): Fixture {
  const pause = vi.fn(async () => {});
  const worker = { name: 'fixture-queue', pause, on: vi.fn() } as unknown as Worker;
  const subscriber = vi.fn();
  const interceptor = vi.fn();
  const booted = vi.fn();

  interface FixtureCradle {
    readonly greeting: string;
    readonly greeter: Greeter;
  }

  const registerModule = (ctx: ModuleContext): void => {
    ctx.di.register({
      greeter: ctx.asFunction(({ greeting }: FixtureCradle) => new Greeter(greeting)).singleton(),
    });

    ctx.routes(async (app) => {
      const { greeter } = ctx.cradle<FixtureCradle>();
      app.get('/api/v1/admin/fixture/greet', async () => ({ data: greeter.greet() }));
    });

    ctx.worker(worker);
    ctx.subscribe('fixture.happened', subscriber);
    ctx.interceptors([
      {
        id: 'stamp',
        phase: 'pre',
        target: 'GET /api/v1/admin/fixture/greet',
        handler: interceptor,
      },
    ]);
    ctx.onBoot(() => {
      // Resolving here is legal — the boot phase runs after every module has
      // registered, which is the whole point of it being a separate phase.
      booted(ctx.cradle<FixtureCradle>().greeter.greet());
    });
  };

  return {
    entry: { id: MODULE_ID, version: '1.0.0', registerModule },
    worker,
    pause,
    subscriber,
    interceptor,
    booted,
  };
}

function compose(f: Fixture): ReturnType<typeof composeModules> & {
  interceptors: ApiInterceptorRegistry;
  bus: EventBus;
} {
  const container = createRootContainer();
  registerValues(container, { greeting: 'hello' });
  const bus = new EventBus();
  const interceptors = new ApiInterceptorRegistry();
  const composed = composeModules([f.entry], {
    container,
    eventBus: bus,
    log: log(),
    interceptorRegistry: interceptors,
  });
  return { ...composed, interceptors, bus };
}

afterEach(() => {
  registryCache.__setEnabledForTesting([]);
});

describe('registerModule — the six surfaces', () => {
  it('registers services the container resolves, and constructs none of them at composition', () => {
    const constructed = vi.fn();
    class Expensive {
      constructor() {
        constructed();
      }
    }
    const container = createRootContainer();
    const composed = composeModules(
      [
        {
          id: MODULE_ID,
          version: '1.0.0',
          registerModule: (ctx) => {
            ctx.di.register({ expensive: ctx.asClass(Expensive).singleton() });
          },
        },
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    expect(composed.ownerOf('expensive')).toBe(MODULE_ID);
    expect(constructed).not.toHaveBeenCalled();
    expect(container.resolve<Expensive>('expensive')).toBeInstanceOf(Expensive);
    expect(constructed).toHaveBeenCalledTimes(1);
  });

  it('serves the module’s routes while it is present and 503s while it is absent', async () => {
    const f = fixture();
    const composed = compose(f);
    expect(composed.sink.plugins).toHaveLength(1);

    const app = Fastify();
    registerErrorEnvelope(app);
    registryCache.__setEnabledForTesting([MODULE_ID]);
    for (const plugin of composed.sink.plugins) await plugin(app);
    await app.ready();

    const present = await app.inject({ method: 'GET', url: '/api/v1/admin/fixture/greet' });
    expect(present.statusCode).toBe(200);
    expect(present.json()).toEqual({ data: 'hello' });

    registryCache.__setEnabledForTesting([]);
    const absent = await app.inject({ method: 'GET', url: '/api/v1/admin/fixture/greet' });
    expect(absent.statusCode).toBe(503);
    expect(absent.json().error.code).toBe('MODULE_DISABLED');
    expect(absent.headers['retry-after']).toBe('60');

    await app.close();
  });

  it('registers the worker instance and pauses it when the module is absent', () => {
    registryCache.__setEnabledForTesting([]);
    const f = fixture();
    const composed = compose(f);

    expect(composed.sink.workers).toEqual([f.worker]);
    expect(f.pause).toHaveBeenCalledTimes(1);
  });

  it('leaves the worker running when the module is present', () => {
    registryCache.__setEnabledForTesting([MODULE_ID]);
    const f = fixture();
    compose(f);

    expect(f.pause).not.toHaveBeenCalled();
  });

  it('delivers events while the module is present and drops them while it is absent', async () => {
    const f = fixture();
    const composed = compose(f);

    registryCache.__setEnabledForTesting([MODULE_ID]);
    composed.bus.emit('fixture.happened', { eventId: '1', occurredAt: 'now' });
    await Promise.resolve();
    expect(f.subscriber).toHaveBeenCalledTimes(1);

    registryCache.__setEnabledForTesting([]);
    composed.bus.emit('fixture.happened', { eventId: '2', occurredAt: 'now' });
    await Promise.resolve();
    expect(f.subscriber).toHaveBeenCalledTimes(1);

    expect(composed.sink.unsubscribes).toHaveLength(1);
  });

  it('stamps the module id on every interceptor it registers', () => {
    const f = fixture();
    const composed = compose(f);
    composed.interceptors.seal();

    expect(composed.interceptors.list()).toEqual([
      {
        target: 'GET /api/v1/admin/fixture/greet',
        phase: 'pre',
        order: 0,
        module: MODULE_ID,
        id: 'stamp',
      },
    ]);
  });

  it('offers no install seam at all — install-time work belongs to the manifest (D-46)', () => {
    // A seam that looks live and is not is worse than an absent one: a hook
    // handed to the container is collected by the sink and then never run,
    // because `module:install` composes nothing. `tsc` refuses the call now;
    // this asserts the same thing at runtime so the methods cannot creep back
    // in as untyped additions to the context object.
    let seen: string[] = [];
    const composed = composeModules(
      [
        {
          id: MODULE_ID,
          version: '1.0.0',
          registerModule: (ctx) => {
            seen = Object.keys(ctx);
          },
        },
      ],
      { container: createRootContainer(), eventBus: new EventBus(), log: log() },
    );

    expect(seen).not.toContain('onInstall');
    expect(seen).not.toContain('onUninstall');
    expect(seen).toContain('onBoot');
    expect(Object.keys(composed.sink)).not.toContain('installHooks');
    expect(Object.keys(composed.sink)).not.toContain('uninstallHooks');
  });

  it('runs the boot phase only when asked, and lets it resolve', async () => {
    const f = fixture();
    const composed = compose(f);

    expect(f.booted).not.toHaveBeenCalled();
    await composed.runBootHooks();
    expect(f.booted).toHaveBeenCalledWith('hello');
  });
});

describe('registerModule — what the module never has to do', () => {
  it('gates a route the module registers later, without the module changing', async () => {
    // The point of wrapping at the registration seam rather than per handler:
    // a route added to the same registrar a year from now is gated too.
    const container = createRootContainer();
    const composed = composeModules(
      [
        {
          id: MODULE_ID,
          version: '1.0.0',
          registerModule: (ctx) => {
            ctx.routes(async (app) => {
              app.get('/api/v1/admin/fixture/first', async () => ({ ok: true }));
              app.get('/api/v1/admin/fixture/second', async () => ({ ok: true }));
            });
          },
        },
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    const app = Fastify();
    registerErrorEnvelope(app);
    for (const plugin of composed.sink.plugins) await plugin(app);
    await app.ready();

    registryCache.__setEnabledForTesting([]);
    for (const url of ['/api/v1/admin/fixture/first', '/api/v1/admin/fixture/second']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(503);
    }

    await app.close();
  });

  it('refuses an interceptor when the root mounts no registry, naming the module', () => {
    const container = createRootContainer();
    expect(() =>
      composeModules(
        [
          {
            id: MODULE_ID,
            version: '1.0.0',
            registerModule: (ctx) => {
              ctx.interceptors([
                {
                  id: 'stamp',
                  phase: 'pre',
                  target: 'GET /api/v1/admin/fixture/greet',
                  handler: vi.fn(),
                },
              ]);
            },
          },
        ],
        { container, eventBus: new EventBus(), log: log() },
      ),
    ).toThrow(new RegExp(MODULE_ID));
  });
});
