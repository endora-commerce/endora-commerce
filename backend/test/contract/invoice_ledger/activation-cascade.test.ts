import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, INFAKT_SETTING_CODES, INVOICE_LEDGER_SETTING_CODES } from '@endora-commerce/contracts';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { activateInfakt } from '../../integration/invoice_ledger/helpers.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

const ADMIN = { b2b_session: 'stub-admin-session' };
const ALL_MODULE_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);
const ACTIVATION_RESET_CODES = [
  INVOICE_LEDGER_SETTING_CODES.ACTIVATION,
  INFAKT_SETTING_CODES.ACTIVATION,
];

/**
 * Operator deactivation of `invoice_ledger` writes present ledger adapters
 * off in the same Command. Re-activating the ledger does not turn them back
 * on. Activating an adapter while the ledger is off is refused.
 */
describe('invoice_ledger — activation cascade [contract]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  afterEach(async () => {
    // The harness seeds platform availability in memory, not in
    // `module_registrations`. A full `refreshFromDb` would empty the enabled
    // set and take `admin_roles` down with every other gated route.
    await h.em().nativeUpdate(
      Setting,
      { code: { $in: ACTIVATION_RESET_CODES } },
      { globalValue: null },
    );
    registryCache.__setEnabledForTesting(ALL_MODULE_IDS);
  });

  async function flip(moduleId: string, active: boolean) {
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/modules/${moduleId}/activation`,
      cookies: ADMIN,
      payload: { active },
    });
  }

  it('switching the ledger off also switches Infakt off', async () => {
    await activateInfakt(h);

    const res = await flip('invoice_ledger', false);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().module).toMatchObject({
      id: 'invoice_ledger',
      activated: false,
      present: false,
    });

    const presence = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/module-presence',
      cookies: ADMIN,
    });
    expect(presence.statusCode).toBe(200);
    const modules = presence.json().modules as Array<{ id: string; present: boolean }>;
    expect(modules.find((m) => m.id === 'invoice_ledger')?.present).toBe(false);
    expect(modules.find((m) => m.id === 'infakt')?.present).toBe(false);
  });

  it('refuses to activate Infakt while the ledger is off', async () => {
    const off = await flip('invoice_ledger', false);
    expect(off.statusCode, off.body).toBe(200);

    const res = await flip('infakt', true);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe(ERROR_CODES.MODULE_DEPENDENCIES_ABSENT);
    expect(res.json().error.details.missing).toContain('invoice_ledger');
  });

  it('switching the ledger back on leaves Infakt off', async () => {
    await activateInfakt(h);
    expect((await flip('invoice_ledger', false)).statusCode).toBe(200);
    expect((await flip('invoice_ledger', true)).statusCode).toBe(200);

    const presence = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/module-presence',
      cookies: ADMIN,
    });
    const modules = presence.json().modules as Array<{
      id: string;
      present: boolean;
      activated: boolean;
    }>;
    expect(modules.find((m) => m.id === 'invoice_ledger')).toMatchObject({
      present: true,
      activated: true,
    });
    expect(modules.find((m) => m.id === 'infakt')).toMatchObject({
      present: false,
      activated: false,
    });
  });
});
