import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { EventBus } from '@endora-commerce/platform/events';
import { composeModules } from '../../../src/kernel/compose.js';
import { createRootContainer } from '../../../src/kernel/container.js';
import type { ModuleContext } from '../../../src/kernel/module-context.js';

/**
 * `ctx.rootPlugin` — the seam for a decoration every other module's routes read
 * (feature 072, T078).
 *
 * `auth` is why it exists and, so far, its only caller. The auth plugin does not
 * contribute routes: it decorates `request.actor` and every module's route
 * guards read it. Neither existing routes seam can carry that, and the reason is
 * structural rather than a limitation to work around — **both `ctx.routes` and
 * `ctx.ungatedRoutes` register into an encapsulated Fastify child context.** A
 * decoration applied inside a child context is invisible to that context's
 * siblings, so every other module's routes would see no actor at all.
 *
 * The distinction from `ungatedRoutes` is worth keeping sharp, because they look
 * similar and are not:
 *
 *  - `ungatedRoutes` is about **the gate**: routes that must answer while their
 *    module is off (a liveness probe).
 *  - `rootPlugin` is about **encapsulation**: a contribution that must apply to
 *    the whole application rather than to one module's subtree.
 *
 * Like `ungatedRoutes`, it takes a required non-empty `reason`, for the same
 * reason: this is the one seam that can affect every other module, so an
 * exemption has to carry its justification next to the code it covers.
 */

const log = { info: (): void => {}, warn: (): void => {}, error: (): void => {} };

function compose(register: (ctx: ModuleContext) => void): ReturnType<typeof composeModules> {
  return composeModules([{ id: 'auth', version: '1.0.0', registerModule: register }], {
    container: createRootContainer(),
    eventBus: new EventBus(),
    log,
  });
}

describe('ctx.rootPlugin', () => {
  it('collects the plugin separately from route contributions', () => {
    const composed = compose((ctx) => {
      ctx.rootPlugin('decorates request.actor for every module', async () => {});
      ctx.routes(async () => {});
    });

    // Separate lists, because a composition root places them at different
    // points: routes go with the module's own surface, a root plugin goes
    // where the whole application needs it decorated.
    expect(composed.sink.rootPlugins).toHaveLength(1);
    expect(composed.sink.plugins).toHaveLength(1);
  });

  it('applies its decoration to routes registered by other modules', async () => {
    const composed = compose((ctx) => {
      ctx.rootPlugin('decorates request.actor for every module', async (app) => {
        app.decorateRequest('actor', { getter: () => ({ kind: 'anonymous' }) as never });
      });
    });

    const app: FastifyInstance = Fastify();
    for (const plugin of composed.sink.rootPlugins) await plugin(app);
    // A *sibling* registration — the thing an encapsulated seam cannot serve.
    await app.register(async (sibling) => {
      sibling.get('/who', async (request) => ({
        actor: (request as unknown as { actor: { kind: string } }).actor,
      }));
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/who' });
    expect(res.json()).toEqual({ actor: { kind: 'anonymous' } });
    await app.close();
  });

  it('refuses an empty reason', () => {
    // Same rule as `ungatedRoutes`: the one seam that can reach every module
    // states why, in the code, or it is not available.
    expect(() =>
      compose((ctx) => {
        ctx.rootPlugin('   ', async () => {});
      }),
    ).toThrow(/reason/i);
  });

  it('names the module in that refusal', () => {
    let thrown: unknown;
    try {
      compose((ctx) => {
        ctx.rootPlugin('', async () => {});
      });
    } catch (err) {
      thrown = err;
    }
    expect((thrown as Error).message).toContain('auth');
  });
});
