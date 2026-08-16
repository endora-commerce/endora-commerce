import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 039 (US5) — one-click buy eligibility endpoint wiring. The setting
 * defaults to off, so a buyer is not eligible until it is enabled and all four
 * defaults are set (the service logic is unit-tested in one-click-service.test.ts).
 *
 * Issue #99 — the third case is the one that was missing. `OneClickService`
 * carried `salesChannelId: string = 'default'`, a fifth constructor argument
 * production never passed, so the setting was read against a channel *code*;
 * the settings seam guard refused it and the module's bare `catch` reported
 * `setting_disabled`. Every deployment therefore had one-click buy off no
 * matter what the operator set, and the two cases above passed throughout,
 * because both expect "not enabled".
 */

const COOKIE = { b2b_session: 'stub-customer-session' };
const ONE_CLICK_ENABLED = 'quick_order.one_click_buy_enabled';

describe('Quick-order one-click eligibility', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await setEnabledGlobally(null);
    await teardownBackendServer(h);
  });

  /** Flip the platform-wide value the way the admin surface would, cache included. */
  async function setEnabledGlobally(value: boolean | null): Promise<void> {
    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code: ONE_CLICK_ENABLED });
    setting.globalValue = value;
    await em.flush();
    await h.settings.cache.invalidate(ONE_CLICK_ENABLED);
  }

  it('requires an authenticated session', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/quick-order/one-click/eligibility',
    });
    expect(res.statusCode).toBe(401);
  });

  it('reports not-eligible while the setting is disabled', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/quick-order/one-click/eligibility',
      cookies: COOKIE,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { enabled: boolean } }).data.enabled).toBe(false);
  });

  it('stops reporting setting_disabled once the operator enables the setting', async () => {
    await setEnabledGlobally(true);
    try {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/quick-order/one-click/eligibility',
        cookies: COOKIE,
      });
      expect(res.statusCode).toBe(200);
      // The stub customer has no saved ordering preferences, so the honest
      // answer is `missing_defaults`. What matters is that it is no longer
      // `setting_disabled`: the setting was actually read.
      expect((res.json() as { data: { reason: string | null } }).data.reason).toBe(
        'missing_defaults',
      );
    } finally {
      await setEnabledGlobally(null);
    }
  });

  it('refuses a one-click order when not eligible', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/one-click',
      cookies: COOKIE,
      payload: { productId: '00000000-0000-4000-8000-000000000101', quantity: 1 },
    });
    expect(res.statusCode).toBe(422);
  });
});
