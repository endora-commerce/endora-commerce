import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { Worker } from 'bullmq';
import { registerErrorEnvelope } from '../../../src/http/error-envelope.js';
import { EventBus } from '../../../src/events/bus.js';
import { registryCache } from '../../../src/modules/_lifecycle/services/registry-cache.js';
import { createRootContainer } from '../../../src/kernel/container.js';
import {
  createModuleContext,
  createModuleRegistrationSink,
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
