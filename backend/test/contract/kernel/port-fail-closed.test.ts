import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import { EventBus } from '../../../src/events/bus.js';
import { composeModules } from '../../../src/kernel/compose.js';
import { createRootContainer, type KernelContainer } from '../../../src/kernel/container.js';
import type { ModuleContext } from '../../../src/kernel/module-context.js';
import type { OrganizationReadPort } from '../../../src/kernel/ports/organizations.js';
import type { RequireAdminFactory } from '../../../src/kernel/ports/require-admin.js';
import type { SalesChannelResolutionPort } from '../../../src/kernel/ports/sales-channel.js';
import type { SettingsReadPort } from '../../../src/kernel/ports/settings.js';
import { registerErrorEnvelope } from '../../../src/http/error-envelope.js';
import { ModuleDisabledError } from '../../../src/modules/_lifecycle/plugin-helpers.js';
import { registryCache } from '../../../src/modules/_lifecycle/services/registry-cache.js';

/**
 * Ports fail closed (feature 072, US5 / T059–T060).
 *
 * A port is the only way one module reaches another, so "is the providing
 * module there?" is asked on every cross-module call in the platform. Getting
 * the answer wrong is not one bug — it is the same bug at every call site, and
 * the wrong answer is the *permissive* one: a consumer that receives a live
 * service from a module the operator switched off goes on writing rows and
 * emitting events on behalf of a capability that is supposed to be absent.
 *
 * Two failure modes, two different answers:
 *
 *  - **the module is not effectively present** → `ModuleDisabledError`, which
 *    is 503 `MODULE_DISABLED` with `Retry-After`: the capability exists, it is
 *    off, come back later.
 *  - **nothing registered the name at all** → resolution throws immediately,
 *    naming the name. Never `undefined` reaching business logic, which is what
 *    a missing key in `composition.ts`'s option objects produced.
 */

const log = { info: (): void => {}, warn: (): void => {}, error: (): void => {} };

/** A stand-in for each of the four ports. Only identity is asserted on. */
const IMPLEMENTATIONS = {
  requireAdmin: (() => async () => {}) as RequireAdminFactory,
  organizationReadPort: {} as OrganizationReadPort,
  settingsReadPort: {} as SettingsReadPort,
  salesChannelResolutionPort: {} as SalesChannelResolutionPort,
};

/**
 * The four ports of `contracts/module-context.md`, with their owners.
 *
 * Two are **module-owned** and therefore gated; two are **kernel-owned** and
 * cannot be, because there is no state in which the kernel is absent. That
 * asymmetry is the point of the table: it is a property of who owns the port,
 * not of how carefully each one was written.
 */
const PORTS = [
  { name: 'requireAdmin', owner: 'auth' as const, gated: true },
  { name: 'organizationReadPort', owner: 'organizations' as const, gated: true },
  { name: 'settingsReadPort', owner: null, gated: false },
  { name: 'salesChannelResolutionPort', owner: null, gated: false },
] as const;

function providerModule(portName: string): (ctx: ModuleContext) => void {
  return (ctx) => {
    ctx.di.providePort(
      portName,
      ctx.asValue(IMPLEMENTATIONS[portName as keyof typeof IMPLEMENTATIONS]),
    );
  };
}

function composeProvider(moduleId: string, portName: string): KernelContainer {
  const container = createRootContainer();
  composeModules([{ id: moduleId, version: '1.0.0', registerModule: providerModule(portName) }], {
    container,
    eventBus: new EventBus(),
    log,
  });
  return container;
}

const seeded = registryCache.enabledIds();
afterEach(() => {
  registryCache.__setEnabledForTesting(seeded);
});

describe('T059 — resolving a port from a module that is not present', () => {
  for (const port of PORTS.filter((p) => p.gated)) {
    const owner = port.owner as string;

    it(`${port.name}: resolves while ${owner} is present`, () => {
      registryCache.__setEnabledForTesting([...seeded, owner]);
      const container = composeProvider(owner, port.name);
      expect(container.cradle[port.name]).toBe(
        IMPLEMENTATIONS[port.name as keyof typeof IMPLEMENTATIONS],
      );
    });

    it(`${port.name}: throws ModuleDisabledError once the operator deactivates ${owner}`, () => {
      registryCache.__setEnabledForTesting([...seeded, owner]);
      const container = composeProvider(owner, port.name);
      // Resolve once while it is present, so the check cannot pass merely
      // because nothing had ever been constructed.
      expect(container.cradle[port.name]).toBeDefined();

      registryCache.__setEnabledForTesting([...seeded, owner], { deactivated: [owner] });

      let thrown: unknown;
      try {
        void container.cradle[port.name];
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ModuleDisabledError);
      expect((thrown as ModuleDisabledError).moduleId).toBe(owner);
      expect((thrown as ModuleDisabledError).statusCode).toBe(503);
      expect((thrown as ModuleDisabledError).code).toBe(ERROR_CODES.MODULE_DISABLED);
    });

    it(`${port.name}: throws when ${owner} is not available on this platform`, () => {
      registryCache.__setEnabledForTesting(seeded.filter((id) => id !== owner));
      const container = composeProvider(owner, port.name);
      expect(() => container.cradle[port.name]).toThrow(ModuleDisabledError);
    });
  }

  for (const port of PORTS.filter((p) => !p.gated)) {
    it(`${port.name}: kernel-owned, so no module's state can withdraw it`, () => {
      // Registered by the composition root, not through `providePort` — the
      // kernel has no manifest, no registry row and no activation setting, so
      // there is nothing to gate on. Asserting it here keeps the asymmetry
      // deliberate rather than an omission somebody later "fixes".
      registryCache.__setEnabledForTesting([]);
      const container = createRootContainer();
      container.register({});
      composeModules(
        [
          {
            id: 'a_module',
            version: '1.0.0',
            registerModule: (ctx) => {
              ctx.di.register({
                [port.name]: ctx.asValue(
                  IMPLEMENTATIONS[port.name as keyof typeof IMPLEMENTATIONS],
                ),
              });
            },
          },
        ],
        { container, eventBus: new EventBus(), log },
      );
      expect(container.cradle[port.name]).toBeDefined();
    });
  }
});

describe('T059 — the HTTP answer a disabled port produces', () => {
  it('is 503 MODULE_DISABLED with Retry-After, from a handler that resolves the port', async () => {
    registryCache.__setEnabledForTesting([...seeded, 'organizations']);
    const container = composeProvider('organizations', 'organizationReadPort');
    registryCache.__setEnabledForTesting([...seeded, 'organizations'], {
      deactivated: ['organizations'],
    });

    const app = Fastify();
    registerErrorEnvelope(app);
    // A consumer module's route: it does not gate on `organizations`, it simply
    // resolves the port — which is the whole point, because 60 modules cannot
    // each remember to check first.
    app.get('/api/v1/consumer', async () => {
      void container.cradle['organizationReadPort'];
      return { ok: true };
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/v1/consumer' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe(ERROR_CODES.MODULE_DISABLED);
    expect(res.json().error.message).toContain('organizations');
    // Without this the client cannot tell "switched off, come back" from
    // "this endpoint is gone", and an orchestrator reads the difference as
    // whether to kill the container.
    expect(res.headers['retry-after']).toBe('60');
    await app.close();
  });
});

describe('T060 — an unregistered name never resolves to undefined', () => {
  it('throws immediately, naming the name that is missing', () => {
    const container = createRootContainer();
    let thrown: unknown;
    try {
      void container.cradle['orderNumberingStrategy'];
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('orderNumberingStrategy');
    // The distinction that matters: not `undefined`, not a proxy that answers
    // later, not a null object — a throw at the moment of the read.
    expect(thrown).not.toBeUndefined();
  });

  it('throws through a module cradle too, naming the module that wanted it', () => {
    const container = createRootContainer();
    const composed = composeModules(
      [
        {
          id: 'orders',
          version: '1.0.0',
          registerModule: (ctx) => {
            ctx.onBoot(() => {
              void (ctx.cradle() as Record<string, unknown>)['orderNumberingStrategy'];
            });
          },
        },
      ],
      { container, eventBus: new EventBus(), log },
    );
    return expect(composed.runBootHooks()).rejects.toThrow(/orders[\s\S]*orderNumberingStrategy/);
  });

  it('distinguishes a missing name from a present-but-disabled port', () => {
    registryCache.__setEnabledForTesting([...seeded, 'auth'], { deactivated: ['auth'] });
    const container = composeProvider('auth', 'requireAdmin');

    // Disabled provider: 503, a retryable state.
    expect(() => container.cradle['requireAdmin']).toThrow(ModuleDisabledError);
    // Never registered: a wiring bug, and not retryable at all.
    expect(() => container.cradle['requireCustomer']).not.toThrow(ModuleDisabledError);
    expect(() => container.cradle['requireCustomer']).toThrow(/requireCustomer/);
  });
});
