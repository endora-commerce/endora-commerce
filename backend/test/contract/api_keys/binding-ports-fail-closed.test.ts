import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 075 (D-87) — the two binding reads fail closed.
 *
 * B3 and B4 decide whether a distributor key may be minted at all, and both
 * used to be `em.getKnex().raw(...)` against `organizations`' and
 * `customer_accounts`' tables. Raw SQL crosses a module boundary while naming
 * no import specifier, so the reach compiled, returned rows and answered the
 * same whether its owner was composed or not — and an absent owner answered
 * "no such organisation", which is a 422 blaming the operator's input for a
 * platform fact.
 *
 * They are `organizationDetailsPort` and `customerAccountReadPort` now. Both
 * owners declare `nonDeactivatable`, so the operator axis has no off state for
 * either; the platform axis is what a deployment that does not ship the module
 * reaches, and it is the one driven here. Each case carries a positive control,
 * because an always-refusing route reads as a successful absence without one.
 */
describe('api_keys — the binding reads fail closed (feature 075, D-87)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    defaultChannelId = (await h.salesChannels.resolver.getSystemDefault()).id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const createBoundKey = (name: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload: {
        name,
        scopes: ['orders:write'],
        binding: {
          organizationId: TEST_ORGANIZATION_ID,
          salesChannelId: defaultChannelId,
          customerAccountId: TEST_CUSTOMER_ID,
        },
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });

  const errorCode = (res: { json: () => unknown }): string | undefined =>
    (res.json() as { error?: { code?: string } }).error?.code;

  it('refuses to mint a bound key while `organizations` is unavailable', async () => {
    const before = await createBoundKey('fail-closed control org');
    expect(before.statusCode).toBe(201);

    await withModuleOff('organizations', 'platform-unavailable', async () => {
      const res = await createBoundKey('fail-closed org');
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('MODULE_DISABLED');
    });

    const restored = await createBoundKey('fail-closed restored org');
    expect(restored.statusCode).toBe(201);
  });

  it('refuses to mint a bound key while `customer_accounts` is unavailable', async () => {
    const before = await createBoundKey('fail-closed control account');
    expect(before.statusCode).toBe(201);

    await withModuleOff('customer_accounts', 'platform-unavailable', async () => {
      const res = await createBoundKey('fail-closed account');
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('MODULE_DISABLED');
    });

    const restored = await createBoundKey('fail-closed restored account');
    expect(restored.statusCode).toBe(201);
  });
});
