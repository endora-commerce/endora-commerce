import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerRegistrationOptionsResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../../packages/modules/customers/src/manifest.js';

/**
 * Issue #756 — the storefront reads whether individual self-registration is
 * offered before it renders `/register-customer`, rather than finding out from
 * the 403 a submitted form gets back. The read is public and gives the answer
 * `POST /api/v1/customers/register` applies, so the page and the refusal
 * cannot disagree.
 */
const URL = '/api/v1/storefront/settings/customer-registration';

describe('GET /api/v1/storefront/settings/customer-registration (issue #756)', () => {
  let h: BackendServerHandle;

  async function setAllowed(value: boolean): Promise<void> {
    const r = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/customers.allow_registration_without_organization/value',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { scope: 'all', value },
    });
    if (r.statusCode !== 200) throw new Error(`set setting failed: ${r.statusCode} ${r.body}`);
  }

  async function read(): Promise<boolean> {
    const res = await h.app.inject({ method: 'GET', url: URL });
    expect(res.statusCode, res.body).toBe(200);
    return customerRegistrationOptionsResponseSchema.parse(res.json()).data
      .allowRegistrationWithoutOrganization;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await new ManifestReconciler(h.em()).apply([customersManifest.settings!]);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers false while the setting is off, and the register route refuses alike', async () => {
    await setAllowed(false);
    expect(await read()).toBe(false);
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: {
        email: `ro-off-${Date.now()}@example.test`,
        password: 'a-very-strong-pass',
        firstName: 'Stand',
        lastName: 'Alone',
        acceptedTermsVersion: 'v1',
      },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'REGISTRATION_REQUIRES_ORGANIZATION',
    );
  });

  it('answers true once the setting is on', async () => {
    await setAllowed(true);
    expect(await read()).toBe(true);
  });

  it('needs no session', async () => {
    const res = await h.app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
