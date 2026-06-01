import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/modules/settings/services/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../src/modules/customers/manifest.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';

/**
 * Feature 040, US7 — admin password reset, soft-delete/restore, and the online
 * customers view.
 */
describe('Admin customer lifecycle (US7)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const password = 'a-very-strong-pass';

  beforeAll(async () => {
    h = await setupBackendServer();
    const reconciler = new ManifestReconciler(h.em());
    await reconciler.apply([customersManifest.settings!]);
    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/customers.allow_registration_without_organization/value',
      cookies: admin,
      payload: { scope: 'all', value: true },
    });
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  async function newCustomer(): Promise<{ id: string; email: string }> {
    const email = `lc-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: { email, password, firstName: 'Life', lastName: 'Cycle', acceptedTermsVersion: 'v1' },
    });
    const id = (await h.em().findOne(CustomerAccount, { email }))!.id;
    return { id, email };
  }

  it('triggers an admin password reset and audits it', async () => {
    const c = await newCustomer();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${c.id}/password-reset`,
      cookies: admin,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { ok: boolean } }).data.ok).toBe(true);
    const audit = await h.em().find(AuditLogEntry, {
      action: 'customer_account.password_reset_requested',
      objectId: c.id,
    });
    expect(audit).toHaveLength(1);
  });

  it('lists a freshly-registered customer as online', async () => {
    const c = await newCustomer();
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/customers/online',
      cookies: admin,
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: Array<{ id: string }> }).data;
    expect(data.some((x) => x.id === c.id)).toBe(true);
  });

  it('soft-deletes (denies login), restores, and refuses a second delete', async () => {
    const c = await newCustomer();

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/customers/${c.id}`,
      cookies: admin,
    });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { data: { deleted: boolean } }).data.deleted).toBe(true);

    // Login denied for a deleted account.
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: c.email, password },
    });
    expect(login.statusCode).toBe(401);

    // Second delete → 409.
    const again = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/customers/${c.id}`,
      cookies: admin,
    });
    expect(again.statusCode).toBe(409);

    // Restore → login works again.
    const restore = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${c.id}/restore`,
      cookies: admin,
    });
    expect(restore.statusCode).toBe(200);
    expect((restore.json() as { data: { deleted: boolean } }).data.deleted).toBe(false);

    const relogin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: c.email, password },
    });
    expect(relogin.statusCode).toBe(200);
  });
});
