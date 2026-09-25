import { describe, expect, it } from 'vitest';

import { composeTestServer, teardownTestServer } from '@endora-commerce/test-kit/server';

import {
  FIXTURE_MANIFESTS,
  FIXTURE_MODULE_ID,
  fixtureOrm,
  requiredModuleEntry,
} from './fixture-platform.js';

/**
 * The kit registers the platform's `processRunsWorkers`, `false`, like every
 * other platform value, and a caller may override it through `values`
 * (`specs/134-paid-module-extraction/` T122, research D16 §2(a), contract
 * W1.1).
 *
 * The module below reads the name **at construction** — a factory that
 * destructures it — and again from a boot hook, which are the two places a
 * module that starts queue consumers reads it. None of the retired per-module
 * flags is registered by this composition, so a module composed through the
 * kit needs nothing from its caller to answer "does this process run
 * consumers?". A harness answers `false`: no test process consumes the queues
 * the suite shares.
 */

interface Observed {
  constructed?: boolean;
  booted?: boolean;
}

function readerEntry(observed: Observed): unknown {
  return {
    id: FIXTURE_MODULE_ID,
    version: '1.0.0',
    registerModule: (ctx: {
      di: { register(registrations: Record<string, unknown>): void };
      asFunction(factory: (cradle: { processRunsWorkers: boolean }) => unknown): {
        singleton(): unknown;
      };
      onBoot(hook: () => void): void;
      cradle<C extends object>(): C;
    }): void => {
      ctx.di.register({
        testKitWorkerSwitch: ctx
          .asFunction(({ processRunsWorkers }) => {
            observed.constructed = processRunsWorkers;
            return { runs: processRunsWorkers };
          })
          .singleton(),
      });
      ctx.onBoot(() => {
        observed.booted = ctx.cradle<{ processRunsWorkers: boolean }>().processRunsWorkers;
        ctx.cradle<{ testKitWorkerSwitch: unknown }>().testKitWorkerSwitch;
      });
    },
  };
}

async function composeWith(
  observed: Observed,
  values?: Readonly<Record<string, unknown>>,
): Promise<void> {
  const handle = await composeTestServer({
    composition: {
      modules: [requiredModuleEntry, readerEntry(observed)] as never,
      orm: fixtureOrm(),
      manifests: FIXTURE_MANIFESTS,
    },
    ...(values === undefined ? {} : { values }),
  });
  try {
    for (const retired of [
      'pimErgonodeRunWorkers',
      'pimPimcoreRunWorkers',
      'pimUnopimRunWorkers',
      'comarchXlRunWorkers',
      'pimAkeneoRunWorkers',
    ]) {
      expect(handle.container.hasRegistration(retired), retired).toBe(false);
    }
  } finally {
    await teardownTestServer(handle);
  }
}

describe('processRunsWorkers in a composition the kit performs', () => {
  it('is registered false, and a module reads it at construction and at boot', async () => {
    const observed: Observed = {};

    await composeWith(observed);

    expect(observed).toEqual({ constructed: false, booted: false });
  });

  it('is the caller’s to override, like every other platform value', async () => {
    const observed: Observed = {};

    await composeWith(observed, { processRunsWorkers: true });

    expect(observed).toEqual({ constructed: true, booted: true });
  });
});
