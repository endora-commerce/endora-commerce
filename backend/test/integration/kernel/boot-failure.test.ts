import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../../src/events/bus.js';
import { createRootContainer, registerValues } from '../../../src/kernel/container.js';
import { composeModules, ModuleCompositionError } from '../../../src/kernel/compose.js';
import type { ModuleContext } from '../../../src/kernel/module-context.js';
import { buildServer, type ModulePlugin } from '../../../src/http/server.js';

/**
 * What a failed boot has to say, and what it must not have done (T053).
 *
 * `composition.ts` composed 66 modules by hand, and a failure inside one of
 * them surfaced as whatever the module happened to throw — `Cannot read
 * properties of undefined`, from a stack that named the service but not the
 * module. With the composer walking a generated list, the composer knows which
 * module it is running, so every failure it propagates carries that id.
 *
 * The second half matters more than the message: a process that fails to
 * compose must not end up listening. A half-composed server answers some routes
 * and 500s the rest, and an orchestrator's health check reports it as up.
 */

function log(): { info: () => void; warn: () => void; error: () => void } {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function compose(entries: Array<{ id: string; register: (ctx: ModuleContext) => void }>): {
  run: () => ReturnType<typeof composeModules>;
} {
  const container = createRootContainer();
  registerValues(container, { hostValue: 'host' });
  return {
    run: () =>
      composeModules(
        entries.map((e) => ({ id: e.id, version: '1.0.0', registerModule: e.register })),
        { container, eventBus: new EventBus(), log: log() },
      ),
  };
}

describe('T053 — a failure while registering', () => {
  it('names the module whose registration threw, and keeps the cause', () => {
    const boom = new Error('SMTP_URL is malformed');
    const { run } = compose([
      { id: 'email', register: () => {} },
      {
        id: 'newsletter',
        register: () => {
          throw boom;
        },
      },
    ]);

    let thrown: unknown;
    try {
      run();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ModuleCompositionError);
    const error = thrown as ModuleCompositionError;
    expect(error.moduleId).toBe('newsletter');
    expect(error.phase).toBe('register');
    expect(error.message).toContain('newsletter');
    expect(error.message).toContain('SMTP_URL is malformed');
    expect(error.cause).toBe(boom);
  });

  it('does not rewrap the kernel errors that already name both modules', () => {
    const collide = (ctx: ModuleContext): void => {
      ctx.di.register({ pricingService: ctx.asValue({}) });
    };
    const { run } = compose([
      { id: 'price_lists', register: collide },
      { id: 'promotions', register: collide },
    ]);

    expect(() => run()).toThrow(/'price_lists' and 'promotions' both register 'pricingService'/);
  });
});

describe('T053 — a failure in the boot phase', () => {
  it('names the module and the registration that could not be resolved', async () => {
    const { run } = compose([
      {
        id: 'blog',
        register: (ctx) => {
          ctx.onBoot(() => {
            // The failure mode the port rule produces: a name nothing
            // registered. Awilix names the registration; the kernel adds the
            // module, because "could not resolve assetReferenceRegistry" on its
            // own does not say who wanted it.
            (ctx.cradle() as { assetReferenceRegistry: unknown }).assetReferenceRegistry;
          });
        },
      },
    ]);

    const composed = run();
    const error = await composed.runBootHooks().catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ModuleCompositionError);
    expect((error as ModuleCompositionError).moduleId).toBe('blog');
    expect((error as ModuleCompositionError).phase).toBe('boot');
    expect((error as Error).message).toContain('blog');
    expect((error as Error).message).toContain('assetReferenceRegistry');
  });

  it('leaves no partially-composed server listening', async () => {
    // The production sequence, in order: compose → boot → build → listen.
    // A boot failure has to abort it before the server exists at all, which is
    // what makes a failed boot visible to an orchestrator as "down" rather than
    // as "up and answering half its routes".
    const healthy: ModulePlugin = async (app) => {
      app.get('/api/v1/_health', async () => ({ status: 'ok' }));
    };
    const build = vi.fn(buildServer);

    const { run } = compose([
      {
        id: 'health_checks',
        register: (ctx) => {
          ctx.routes(healthy);
        },
      },
      {
        id: 'catalog',
        register: (ctx) => {
          ctx.onBoot(() => {
            throw new Error('seed reconciler failed');
          });
        },
      },
    ]);

    let listened = false;
    await expect(
      (async () => {
        const composed = run();
        await composed.runBootHooks();
        const app = await build({
          sessionCookieSecret: 'test-secret',
          openApi: { title: 'T053', version: '0.0.0', serverUrl: 'http://localhost' },
          modules: [...composed.sink.plugins],
        });
        await app.listen({ port: 0 });
        listened = true;
        await app.close();
      })(),
    ).rejects.toThrow(/catalog/);

    expect(build).not.toHaveBeenCalled();
    expect(listened).toBe(false);
  });
});
