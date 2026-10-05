import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';

/**
 * `crm` off-state — Constitution XVII item 6
 * (`specs/143-crm-sales-opportunities/contracts/admin-surfaces.md` §6).
 *
 * The module is operator-toggleable: `crm.enabled` is its activation control,
 * and every route it owns is registered through `ctx.routes`, so the gate is
 * applied at the registration seam. This file is what turns that sentence into
 * a measurement, on both axes — deactivated while platform-available, and
 * platform-unavailable — with full restoration after each.
 *
 * **Storefront absence** is answered here rather than probed: the module has no
 * storefront route and contributes no storefront element, by design — a Sales
 * Opportunity is an internal record and nothing customer-facing reads it.
 *
 * The configuration half is driven over `crm.auto_create_from_orders`, an
 * ordinary module setting, because the activation control itself is the one
 * setting that must stay writable while the module is off.
 *
 * Each story that adds a subscriber adds its own case below, positive control
 * first: without one, a subscriber that never worked reads as a successful
 * absence.
 */
describe('crm off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const WORKFLOW_URL = '/api/v1/admin/crm/workflow';

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers while on — the positive control', async () => {
    const response = await h.app.inject({ method: 'GET', url: WORKFLOW_URL, cookies: admin });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { data: { statuses: Array<{ code: string }> } };
    expect(body.data.statuses.map((status) => status.code)).toContain('new');
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'crm', {
      routes: [{ url: WORKFLOW_URL, cookies: admin }],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: 'crm.auto_create_from_orders',
        value: true,
        cookies: admin,
      },
    });
  });

  it('answers again once restored', async () => {
    const response = await h.app.inject({ method: 'GET', url: WORKFLOW_URL, cookies: admin });
    expect(response.statusCode, response.body).toBe(200);
  });
});
