import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `promotions` off-state — Constitution XVII item 6, from a **package**
 * (feature 080, T040b).
 *
 * The module lives in `packages/modules/promotions` now and every gate it
 * relies on is applied by `ctx.routes` and `ctx.di.providePort` in the kernel
 * container. Nothing about those seams is supposed to change when a module's
 * sources move; this file is what turns "supposed to" into a measurement, over
 * both axes and over the restoration.
 *
 * **The surface an operator can reach is price**, which is why this module's
 * absence has to be the explicit refusal rather than a quiet empty list. An
 * admin screen that still answered `[]` for promotions while the module was off
 * would read as *this shop runs no discounts*, and one that still accepted a
 * rule would be writing a pricing policy the platform has been told not to run.
 * The read surface, the rule surface and the coupon surface are all listed
 * below, because they are three separate route groups behind one registration
 * seam and a gate that held for only one of them would still be a defect.
 *
 * The **ports** are the fourth surface and are not here: neither has an HTTP
 * seam of its own. `promotionUsageFinalizer`'s proof is
 * `packaged-port-seam.test.ts` beside this file, which drives `finalizeUsage`
 * through the container with the module deactivated and asserts the 503 arrives
 * before any redemption row is written.
 *
 * `promotions` owns exactly one setting, `promotions.enabled`, which *is* its
 * activation control — the single documented exception to the
 * non-editable-configuration rule — so no `settingWrite` is declared.
 */
describe('promotions off-state, from a package (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'promotions', {
      routes: [
        { url: '/api/v1/admin/promotions', cookies: admin },
        { url: '/api/v1/admin/promotions/action-types', cookies: admin },
        { url: '/api/v1/admin/promotion-rules', cookies: admin },
      ],
      adminPresence: { cookies: admin },
    });
  });
});
