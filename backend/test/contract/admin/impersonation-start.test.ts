import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { CustomerAccount, Organization } from '../../helpers/package-entities.js';

/**
 * T179 — `POST /admin/organizations/:id/impersonate` writes an
 * AuditLogEntry with `action='impersonation.start'` BEFORE returning the
 * impersonation cookie. A partial failure leaves no dangling cookie.
 */

describe('POST /api/v1/admin/organizations/:id/impersonate — audit-before-cookie', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('writes the impersonation.start audit entry and sets the impersonation cookie', async () => {
    const orgId = '00000000-0000-4000-8000-0000000000aa';
    const customerId = '00000000-0000-4000-8000-0000000000a1';

    const before = await h.em().count(AuditLogEntry, { action: 'impersonation.start' });

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${orgId}/impersonate`,
      payload: { customerAccountId: customerId, reason: 'support ticket #42' },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);

    const setCookie = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
    expect(cookies.some((c) => /b2b_session=/.test(c))).toBe(true);
    expect(cookies.some((c) => /admin_shadow_session=/.test(c))).toBe(true);

    const after = await h.em().count(AuditLogEntry, { action: 'impersonation.start' });
    expect(after).toBe(before + 1);

    const entry = await h.em().findOne(
      AuditLogEntry,
      { action: 'impersonation.start' },
      { orderBy: { actedAt: 'desc' } },
    );
    expect(entry).not.toBeNull();
    expect(entry!.impersonatedCustomerAccountId).toBe(customerId);
  });

  /**
   * Issue #814 — a target this route cannot impersonate answers the customer
   * record's own codes, not the generic `NOT_FOUND`, and is still refused: no
   * audit row and no session cookie. A soft-deleted account answers its
   * distinct refusal only inside the organization the route names; outside it,
   * it reads as absent like any other foreign account.
   */
  describe('refusals (issue #814)', () => {
    const orgId = '00000000-0000-4000-8000-0000000000aa';
    const stamp = Date.now();
    const ids: Record<'deleted' | 'foreign' | 'foreignDeleted', string> = {
      deleted: '',
      foreign: '',
      foreignDeleted: '',
    };

    beforeAll(async () => {
      const em = h.em();
      const foreignOrg = em.create(Organization, {
        name: 'Impersonation foreign org',
        taxId: `PLIMP${String(stamp).slice(-8)}`,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: { street: 'ul. Obca 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
      });
      await em.persistAndFlush(foreignOrg);
      const make = (key: keyof typeof ids, organizationId: string, deleted: boolean) =>
        em.create(CustomerAccount, {
          organizationId,
          email: `imp-814-${key}-${stamp}@example.test`,
          passwordHash: 'x'.repeat(60),
          firstName: 'Imp',
          lastName: key,
          ...(deleted ? { deletedAt: new Date() } : {}),
        });
      const rows = {
        deleted: make('deleted', orgId, true),
        foreign: make('foreign', foreignOrg.id, false),
        foreignDeleted: make('foreignDeleted', foreignOrg.id, true),
      };
      await em.persistAndFlush(Object.values(rows));
      for (const key of Object.keys(rows) as Array<keyof typeof ids>) ids[key] = rows[key].id;
    });

    const impersonate = (customerAccountId: string) =>
      h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${orgId}/impersonate`,
        payload: { customerAccountId },
        cookies: { b2b_session: 'stub-admin-session' },
      });

    const expectRefused = async (
      res: Awaited<ReturnType<typeof impersonate>>,
      customerAccountId: string,
      status: number,
      code: string,
    ) => {
      expect(res.statusCode).toBe(status);
      expect((res.json() as { error: { code: string } }).error.code).toBe(code);
      expect(String(res.headers['set-cookie'] ?? '')).not.toContain('admin_shadow_session=');
      expect(
        await h.em().count(AuditLogEntry, {
          action: 'impersonation.start',
          impersonatedCustomerAccountId: customerAccountId,
        }),
      ).toBe(0);
    };

    it('answers 404 CUSTOMER_NOT_FOUND for an unknown customer', async () => {
      const unknown = '00000000-0000-4000-8000-0000000814ff';
      await expectRefused(await impersonate(unknown), unknown, 404, ERROR_CODES.CUSTOMER_NOT_FOUND);
    });

    it('answers 404 CUSTOMER_NOT_FOUND for a customer of another organization', async () => {
      await expectRefused(await impersonate(ids.foreign), ids.foreign, 404, ERROR_CODES.CUSTOMER_NOT_FOUND);
    });

    it('answers 404 CUSTOMER_NOT_FOUND for a soft-deleted customer of another organization', async () => {
      await expectRefused(
        await impersonate(ids.foreignDeleted),
        ids.foreignDeleted,
        404,
        ERROR_CODES.CUSTOMER_NOT_FOUND,
      );
    });

    it('answers 409 CUSTOMER_ALREADY_DELETED for a soft-deleted member of the organization', async () => {
      await expectRefused(await impersonate(ids.deleted), ids.deleted, 409, ERROR_CODES.CUSTOMER_ALREADY_DELETED);
    });
  });
});
