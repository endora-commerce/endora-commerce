import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `credit_limits` off-state — Constitution XVII item 6, from a **package**
 * (feature 080, T040b).
 *
 * The module lives in `packages/modules/credit_limits` now and every gate it
 * relies on is applied by `ctx.routes` and `ctx.di.providePort` in the kernel
 * container. Nothing about those seams is supposed to change when a module's
 * sources move; this file is what turns "supposed to" into a measurement, over
 * both axes and over the restoration.
 *
 * **The surface an operator can reach is money**, which is why this module's
 * absence has to be the explicit refusal rather than a quiet zero. A
 * customer-facing balance that answered "no limit granted" while the module was
 * off would read on a checkout path as *unlimited credit*, and an admin screen
 * that still granted one would be writing a policy the platform has been told
 * not to run. Both are listed below.
 *
 * The **port** is the third surface and is not here: it has no HTTP seam, and
 * the consumer that matters is `orders`, not a route. Its proof is
 * `packaged-port-seam.test.ts` beside this file, which drives `reserve` through
 * the container with the module deactivated and asserts the 503 arrives before
 * any row is written.
 *
 * `credit_limits` owns exactly one setting, `credit_limits.enabled`, which *is*
 * its activation control — the single documented exception to the
 * non-editable-configuration rule — so no `settingWrite` is declared.
 */
describe('credit_limits off-state, from a package (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const customer = { b2b_session: 'stub-customer-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'credit_limits', {
      routes: [
        { url: '/api/v1/admin/credit-limits', cookies: admin },
        { url: '/api/v1/me/credit-limit', cookies: customer },
      ],
      adminPresence: { cookies: admin },
    });
  });
});
