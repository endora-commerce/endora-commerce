import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@endora-commerce/platform/events';
import { buildServer } from '@endora-commerce/platform/composition';
import { createRootContainer } from '../../../src/kernel/container.js';
import {
  attachPlatformLogger,
  currentPlatformLogger,
  platformLogger,
  type PlatformLogger,
} from '../../../src/kernel/logging.js';
import { composeModules, type ModuleEntry } from '../../../src/kernel/compose.js';
import { enterPlatformScope, enterSystemScope } from '../../../src/kernel/scope.js';
import { registerRequestScopeHook } from '../../../src/kernel/request-scope-hook.js';
import { systemTenantContext } from '../../../src/tenancy/resolve-tenant-context.js';
import type { ModuleContext } from '../../../src/kernel/module-context.js';

/**
 * `ctx.log` reaches the log the platform actually collects (issue #269).
 *
 * Before this, `composition.ts` passed the global `console` as every module's
 * logger and the test harness passed a no-op. So a module's warning was
 * unstructured, uncorrelated with the request that caused it, outside the pino
 * stream a deployment ships — and the two composition roots disagreed about
 * which of those two nothings it was.
 *
 * Four properties are pinned here, and the last two are the ones that make the
 * fix safe rather than merely better:
 *
 *  1. A module's line carries the module id, which the author never writes.
 *  2. A line written during a request carries that request's id.
 *  3. A line written where there is **no request** — a boot hook, a worker
 *     scope — is still written, with no request id and no throw.
 *  4. A line written where **no server has been built** is still written. That
 *     is the trap: routing `ctx.log` at the app logger turns an invisible line
 *     into a thrown one or a dropped one unless the un-attached case has an
 *     answer, and a composition without a server is a real shape (the
 *     boot-order integration tests, and every `composeApp()` before its
 *     `buildServer`).
 */

/** Records what a destination was handed, so a line can be asserted field by field. */
function recorder(): PlatformLogger & { lines: Array<{ level: string; obj: object; msg: string }> } {
  const lines: Array<{ level: string; obj: object; msg: string }> = [];
  return {
    lines,
    info: (obj, msg) => lines.push({ level: 'info', obj, msg }),
    warn: (obj, msg) => lines.push({ level: 'warn', obj, msg }),
    error: (obj, msg) => lines.push({ level: 'error', obj, msg }),
  };
}

function entry(id: string, registerModule: (ctx: ModuleContext) => void): ModuleEntry {
  return { id, version: '1.0.0', registerModule };
}

/** Compose one module against a throwaway container, with `log` as its destination. */
function composeOne(
  id: string,
  registerModule: (ctx: ModuleContext) => void,
  log: PlatformLogger,
): ReturnType<typeof composeModules> {
  return composeModules([entry(id, registerModule)], {
    container: createRootContainer(),
    eventBus: new EventBus(),
    log,
  });
}

const detachers: Array<() => void> = [];

afterEach(() => {
  while (detachers.length > 0) detachers.pop()?.();
  vi.restoreAllMocks();
});

describe('a module line is attributed to its module', () => {
  it('stamps the module id without the author naming it', () => {
    const log = recorder();
    let ctxLog: ModuleContext['log'] | undefined;
    composeOne('invoices', (ctx) => void (ctxLog = ctx.log), log);

    ctxLog?.warn({ settingCode: 'invoices.numbering' }, 'two channels can collide');

    expect(log.lines).toEqual([
      {
        level: 'warn',
        obj: { settingCode: 'invoices.numbering', module: 'invoices' },
        msg: 'two channels can collide',
      },
    ]);
  });

  it('is the wrapper answer, not something a caller can shadow by accident', () => {
    const log = recorder();
    let ctxLog: ModuleContext['log'] | undefined;
    composeOne('shipments', (ctx) => void (ctxLog = ctx.log), log);

    ctxLog?.error({ module: 'not-shipments' }, 'status not applied');

    expect(log.lines[0]?.obj).toEqual({ module: 'shipments' });
  });

  it('attributes each module separately in one composition', () => {
    const log = recorder();
    const captured: Record<string, ModuleContext['log']> = {};
    composeModules(
      [
        entry('payments', (ctx) => void (captured['payments'] = ctx.log)),
        entry('pwa', (ctx) => void (captured['pwa'] = ctx.log)),
      ],
      { container: createRootContainer(), eventBus: new EventBus(), log },
    );

    captured['payments']?.info({}, 'a');
    captured['pwa']?.info({}, 'b');

    expect(log.lines.map((line) => line.obj)).toEqual([{ module: 'payments' }, { module: 'pwa' }]);
  });
});

describe('a line written during a request carries the request id', () => {
  it('reads the id out of the platform scope', async () => {
    const log = recorder();
    let ctxLog: ModuleContext['log'] | undefined;
    composeOne('carts', (ctx) => void (ctxLog = ctx.log), log);

    await enterPlatformScope(
      systemTenantContext('test'),
      () => {
        ctxLog?.warn({ cartId: 'c1' }, 'repricing failed');
      },
      {
        entryPoint: 'http',
        requestMeta: { requestId: 'req_abc123', ipAddress: null, userAgent: null },
      },
    );

    expect(log.lines[0]?.obj).toEqual({ cartId: 'c1', module: 'carts', reqId: 'req_abc123' });
  });

  it('carries no reqId once the request scope has closed', async () => {
    const log = recorder();
    let ctxLog: ModuleContext['log'] | undefined;
    composeOne('carts', (ctx) => void (ctxLog = ctx.log), log);

    await enterPlatformScope(systemTenantContext('test'), () => undefined, {
      entryPoint: 'http',
      requestMeta: { requestId: 'req_abc123', ipAddress: null, userAgent: null },
    });
    ctxLog?.warn({}, 'after the response');

    expect(log.lines[0]?.obj).toEqual({ module: 'carts' });
  });

  it('reaches the application logger with the request id through a real request', async () => {
    const log = recorder();
    let ctxLog: ModuleContext['log'] | undefined;
    const composed = composeOne(
      'catalog',
      (ctx) => {
        ctxLog = ctx.log;
        ctx.ungatedRoutes('no lifecycle registry in this fixture', (app) => {
          app.get('/logging-probe', async () => {
            ctx.log.warn({ probe: true }, 'catalog probe');
            return { ok: true };
          });
        });
      },
      log,
    );

    const app = await buildServer({
      sessionCookieSecret: 'test-secret',
      openApi: { title: 't', version: '0', serverUrl: 'http://localhost' },
      modules: composed.sink.plugins,
    });
    // `buildServer` attached the app's own logger; point it back at the
    // recorder so the line can be read, which is exactly the seam the attach
    // uses. `currentPlatformLogger()` below is the proof the real wire exists.
    expect(currentPlatformLogger()).toBe(app.log);
    detachers.push(attachPlatformLogger(log));

    await registerRequestScopeHook(app, {
      buildTenantContext: async () => systemTenantContext('probe'),
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/logging-probe',
      headers: { 'x-request-id': 'req_from_header' },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(log.lines).toContainEqual({
      level: 'warn',
      obj: { probe: true, module: 'catalog', reqId: 'req_from_header' },
      msg: 'catalog probe',
    });
    expect(ctxLog).toBeDefined();
  });
});

describe('outside a request it is still written', () => {
  it('a boot hook writes an attributed line with no request id', async () => {
    const log = recorder();
    const composed = composeOne(
      'blog',
      (ctx) => {
        ctx.onBoot(() => {
          ctx.log.info({ installed: 3 }, 'bundles reconciled');
        });
      },
      log,
    );

    await composed.runBootHooks();

    expect(log.lines).toEqual([
      { level: 'info', obj: { installed: 3, module: 'blog' }, msg: 'bundles reconciled' },
    ]);
  });

  it('a worker scope writes an attributed line with no request id', async () => {
    const log = recorder();
    let ctxLog: ModuleContext['log'] | undefined;
    composeOne('search', (ctx) => void (ctxLog = ctx.log), log);

    await enterSystemScope('reindex sweep', () => {
      ctxLog?.error({ err: 'boom' }, 'reindex sweep failed');
    });

    expect(log.lines[0]?.obj).toEqual({ err: 'boom', module: 'search' });
  });
});

describe('with no server built, the line is written rather than dropped', () => {
  it('falls back to the console and does not throw', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let ctxLog: ModuleContext['log'] | undefined;
    composeOne('newsletter', (ctx) => void (ctxLog = ctx.log), platformLogger());

    expect(currentPlatformLogger()).toBeUndefined();
    expect(() => ctxLog?.warn({ err: 'x' }, 'consent block seed skipped')).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      { err: 'x', module: 'newsletter' },
      'consent block seed skipped',
    );
  });

  it('a line written after attaching goes to the attached destination, not the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = recorder();
    let ctxLog: ModuleContext['log'] | undefined;
    composeOne('newsletter', (ctx) => void (ctxLog = ctx.log), platformLogger());

    detachers.push(attachPlatformLogger(log));
    ctxLog?.warn({}, 'after attach');

    expect(warn).not.toHaveBeenCalled();
    expect(log.lines[0]?.msg).toBe('after attach');
  });

  it('a detach by a superseded server does not silence the current one', () => {
    const first = recorder();
    const second = recorder();
    const detachFirst = attachPlatformLogger(first);
    detachers.push(attachPlatformLogger(second));

    detachFirst();

    platformLogger().info({}, 'still collected');
    expect(second.lines).toHaveLength(1);
    expect(currentPlatformLogger()).toBe(second);
  });
});
