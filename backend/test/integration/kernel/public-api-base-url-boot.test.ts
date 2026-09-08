import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { composeApp } from '../../../src/composition.js';
import { deploymentRoot } from '../../../src/overlay/overlay-roots.js';
import { PublicApiBaseUrlNotConfiguredError } from '../../../src/kernel/public-api-base-url.js';

/**
 * The production root refuses to boot without a public origin (issue #218).
 *
 * The rule itself is unit-tested in `test/unit/kernel/public-api-base-url.test.ts`,
 * both arms — refused with nothing set, accepted through each of the three
 * spellings, `BACKEND_PUBLIC_URL` (what `deploy/compose.prod.yml` supplies)
 * included. What *this* file proves is that the rule is wired into the root the
 * platform actually runs, and wired in front of everything: `composeApp()`
 * rejects before `initOrm()`, so `src/index.ts` and `src/worker.ts` inherit the
 * refusal from the one function they share.
 *
 * That "before anything is opened" property is what lets a boot refusal be
 * asserted without booting — no database, no Redis, no Meilisearch — which
 * matters because the suite permits exactly one composition per run and it
 * belongs to `production-boot.test.ts`.
 *
 * **Stated gap.** The composed *positive* arm — a production process that has
 * the origin set and boots all the way — is not asserted here, and the two
 * cheap ways to fake it were both rejected: `initOrm()` caches its ORM in a
 * module singleton and `mikro-orm.config.ts` reads `DATABASE_URL` at import, so
 * pointing this one call at a closed port cannot work; and letting
 * `composeApp()` run to completion under `NODE_ENV=production` would be the
 * second full composition the suite is explicitly built to avoid.
 * `production-boot.test.ts` composes this same root with the guard in its call
 * path, which is what stands behind "a configured value still boots".
 */

const ORIGIN_VARIABLES = ['PUBLIC_API_BASE_URL', 'BACKEND_PUBLIC_URL', 'API_PUBLIC_URL'] as const;

describe('composeApp refuses a production boot with no public API origin', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    saved.set('NODE_ENV', process.env['NODE_ENV']);
    for (const name of ORIGIN_VARIABLES) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
    process.env['NODE_ENV'] = 'production';
  });

  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    saved.clear();
  });

  it('rejects with the refusal rather than defaulting to localhost', async () => {
    // Nothing is opened before this rejects. If the file ever starts needing a
    // database, the guard has moved down `composeApp()` and is no longer the
    // first thing a misconfigured production process meets.
    await expect(composeApp({ deploymentRoot: deploymentRoot() })).rejects.toThrow(PublicApiBaseUrlNotConfiguredError);
  });

  it('tells the operator which variable to set', async () => {
    await expect(composeApp({ deploymentRoot: deploymentRoot() })).rejects.toThrow(/PUBLIC_API_BASE_URL[\s\S]*BACKEND_PUBLIC_URL/);
  });
});
