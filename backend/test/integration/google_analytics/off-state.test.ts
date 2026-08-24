import { afterAll, beforeAll, describe, it } from 'vitest';
import { GOOGLE_ANALYTICS_SETTING_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `google_analytics` off-state — Constitution XVII item 6, from a **package**
 * (feature 080, T040b).
 *
 * The module lives in `packages/modules/google_analytics` now and every gate it
 * relies on is applied by `ctx.routes` in the kernel container. Nothing about
 * that seam is supposed to change when a module's sources move; this file is
 * what turns "supposed to" into a measurement, over both axes and over the
 * restoration.
 *
 * Two surfaces are declared rather than one, because this module owns both
 * halves of an integration: the admin custom-events CRUD, and the storefront
 * config the browser reads before it loads GA4 at all. An operator switching
 * Google Analytics off and still seeing a tag load is the failure this asserts
 * cannot happen.
 *
 * The queue consumer is the third surface and is **not** here: it has no HTTP
 * seam and the harness composes no queue (`moduleQueueRedis: undefined`). Its
 * proof is `packaged-worker.test.ts`, beside this file, which also records what
 * the platform's stop switch does and does not reach.
 */
describe('google_analytics off-state, from a package (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'google_analytics', {
      routes: [
        { url: '/api/v1/admin/google-analytics/custom-events', cookies: admin },
        { url: '/api/v1/admin/google-analytics/action-catalogue', cookies: admin },
        {
          url: '/api/v1/storefront/google-analytics/config',
          headers: { 'x-sales-channel': 'default' },
        },
        {
          method: 'POST',
          url: '/api/v1/storefront/google-analytics/collect',
          headers: { 'x-sales-channel': 'default' },
          payload: {
            clientId: 'client-1',
            consent: { analyticsStorage: 'granted' },
            events: [{ name: 'view_item', params: {} }],
          },
        },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: GOOGLE_ANALYTICS_SETTING_CODES.MEASUREMENT_ID,
        value: 'G-OFFSTATE01',
        cookies: admin,
      },
    });
  });
});
