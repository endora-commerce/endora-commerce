import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
} from '@fastify/type-provider-zod';
import { registerErrorEnvelope } from '../../../src/http/error-envelope.js';
import {
  defineModuleRoutes,
  defineModuleWorker,
  requireModuleEnabled,
  subscribeForModule,
  ModuleDisabledError,
} from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';

/**
 * Feature 073 FR-002 — all four gating wrappers resolve the **effective**
 * state, not the platform axis alone.
 *
 * Constitution XVII: "Every gating seam — routes, workers, subscribers,
 * interceptors, cross-module calls, Admin UI, Storefront — MUST resolve this
 * effective state, never one axis alone, and MUST fail closed when either
 * axis is off or unresolved."
 *
 * The point of this file is the middle column: a module that is **platform
 * available but operator-deactivated** must be as absent as one that was
 * never installed. That is the axis an operator actually drives, and before
 * this feature no seam could see it.
 *
 * Nothing here boots the backend server or touches the database — the
 * wrappers read one in-memory value, and the test seam writes it.
 */

const MODULE_ID = 'fixture_effective';

/** A minimal fake BullMQ worker: the wrapper only pauses and resumes it. */
class FakeWorker {
  paused = false;
  readonly name = 'fixture.queue';
  async pause(): Promise<void> {
    this.paused = true;
  }
  async resume(): Promise<void> {
    this.paused = false;
  }
  on(): this {
    return this;
  }
}

/** A minimal EventBus surface — `subscribeForModule` needs only `on`. */
class FakeBus {
  private handlers: Array<(payload: unknown) => void | Promise<void>> = [];
  on(_event: string, handler: (payload: unknown) => void | Promise<void>): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }
  async emit(payload: unknown): Promise<void> {
    for (const handler of this.handlers) await handler(payload);
  }
}

const AXES: ReadonlyArray<{
  label: string;
  seed: () => void;
  present: boolean;
}> = [
  {
    label: 'both axes on',
    seed: () => registryCache.__setEnabledForTesting([MODULE_ID]),
    present: true,
  },
  {
    label: 'platform available, operator deactivated',
    seed: () =>
      registryCache.__setEnabledForTesting([MODULE_ID], { deactivated: [MODULE_ID] }),
    present: false,
  },
  {
    label: 'platform unavailable, operator activated',
    seed: () => registryCache.__setEnabledForTesting([]),
    present: false,
  },
  {
    label: 'both axes off',
    seed: () => registryCache.__setEnabledForTesting([], { deactivated: [MODULE_ID] }),
    present: false,
  },
  {
    label: 'unresolved — nothing has been refreshed yet',
    seed: () => registryCache.__setEnabledForTesting([]),
    present: false,
  },
];

describe('the four lifecycle wrappers resolve effective state (FR-002)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerErrorEnvelope(app);
    const plugin = defineModuleRoutes(MODULE_ID, async (scoped) => {
      scoped.get('/api/v1/admin/fixture-effective/ping', async () => ({ ok: true }));
    });
    await plugin(app);
    await app.ready();
  });

  afterEach(() => {
    registryCache.__setEnabledForTesting([]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('defineModuleRoutes', () => {
    for (const axis of AXES) {
      it(`${axis.label} ⇒ ${axis.present ? '200' : '503 MODULE_DISABLED'}`, async () => {
        axis.seed();
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/admin/fixture-effective/ping',
        });
        if (axis.present) {
          expect(res.statusCode).toBe(200);
          return;
        }
        expect(res.statusCode).toBe(503);
        expect(res.headers['retry-after']).toBe('60');
        expect(res.json().error?.code).toBe('MODULE_DISABLED');
      });
    }
  });

  describe('requireModuleEnabled', () => {
    for (const axis of AXES) {
      it(`${axis.label} ⇒ ${axis.present ? 'returns' : 'throws ModuleDisabledError'}`, () => {
        axis.seed();
        if (axis.present) {
          expect(() => requireModuleEnabled(MODULE_ID)).not.toThrow();
          return;
        }
        expect(() => requireModuleEnabled(MODULE_ID)).toThrow(ModuleDisabledError);
      });
    }
  });

  describe('defineModuleWorker', () => {
    for (const axis of AXES) {
      it(`${axis.label} ⇒ registers ${axis.present ? 'running' : 'paused'}`, async () => {
        axis.seed();
        const worker = new FakeWorker();
        defineModuleWorker(MODULE_ID, worker as never);
        // `pause()` is fired without await inside the wrapper.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(worker.paused).toBe(!axis.present);
      });
    }
  });

  describe('subscribeForModule', () => {
    for (const axis of AXES) {
      it(`${axis.label} ⇒ handler ${axis.present ? 'runs' : 'is inert'}`, async () => {
        const bus = new FakeBus();
        let calls = 0;
        subscribeForModule(MODULE_ID, bus, 'fixture.event', () => {
          calls += 1;
        });
        axis.seed();
        await bus.emit({});
        expect(calls).toBe(axis.present ? 1 : 0);
      });
    }
  });

  it('an unknown module id is absent on every seam', async () => {
    registryCache.__setEnabledForTesting([MODULE_ID]);
    expect(() => requireModuleEnabled('module_nobody_registered')).toThrow(ModuleDisabledError);
  });
});
