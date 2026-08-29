import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminUser } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { hashPassword } from '@endora-commerce/platform/kernel';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';

/**
 * D-173 — a cross-owner permission gate, proved at the seam it breaks.
 *
 * `GET /api/v1/admin/products/:id/resolved-price` belongs to `price_lists`,
 * which declares itself `nonDeactivatable`. It was gated on `rfqs:handle`, a
 * code `PERMISSION_CATALOGUE` attributes to `quote_requests` — a module an
 * operator can switch off. `PermissionCatalogueService` presence-filters the
 * grantable set by a code's owners, so switching quote requests off removes
 * `rfqs:handle` from `/admin-roles` while this endpoint, owned by a module that
 * cannot be switched off, keeps answering.
 *
 * The consequence was already written down, in `organizations/manifest.ts`,
 * when D-166 fixed this same code elsewhere: *"the screen would sit there
 * behind a permission nobody could be granted."* It was written about the
 * sales-rep endpoints and never generalised, and this one shipped.
 *
 * **"Nobody" is measured, not asserted.** The role below holds *every code the
 * platform will grant while quote requests is off* — read out of
 * `GET /api/v1/admin/permissions` inside the off window, so it cannot drift as
 * modules come and go. A wildcard superuser is outside the claim by
 * construction: `'*'` is not a code an operator picks on `/admin-roles`.
 *
 * 404 rather than 200 is the pass: the product id is fabricated, so the gate
 * has already accepted the request by the time the handler answers. That keeps
 * the assertion about the gate and nothing else.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

const MAX_GRANT = { cookies: { b2b_session: 'stub-d173-max-grant-session' } };
const MAX_GRANT_ID = '00000000-0000-4000-8000-00000000d173';
const MISSING_PRODUCT_ID = '00000000-0000-4000-8000-00000000d174';

describe('price_lists resolved-price gate while quote requests is off [integration]', () => {
  let h: BackendServerHandle;

  afterAll(async () => {
    delete ADMIN_COOKIES['stub-d173-max-grant-session'];
    await teardownBackendServer(h);
  });

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  it('is reachable by a role holding every code an operator can grant', async () => {
    await withModuleOff('quote_requests', 'deactivated', async () => {
      const catalogue = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/permissions',
        ...ADMIN,
      });
      expect(catalogue.statusCode).toBe(200);
      const grantable = (catalogue.json() as { data: Array<{ code: string }> }).data.map(
        (row) => row.code,
      );

      // The precondition the assertion is worth nothing without: the code the
      // gate used to name is gone from the role editor.
      expect(
        grantable,
        'quote requests is off, so `rfqs:handle` is not a code an operator can grant',
      ).not.toContain('rfqs:handle');

      const role = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/admin/admin-roles/d173_max_grant',
        ...ADMIN,
        payload: {
          code: 'd173_max_grant',
          name: 'Everything grantable (D-173)',
          permissions: grantable,
        },
      });
      expect(role.statusCode).toBe(200);

      const em = h.em();
      if ((await em.findOne(AdminUser, { id: MAX_GRANT_ID })) === null) {
        em.create(AdminUser, {
          id: MAX_GRANT_ID,
          email: 'd173-max-grant@example.com',
          passwordHash: await hashPassword(STUB_CUSTOMER_PASSWORD),
          firstName: 'Max',
          lastName: 'Grant',
          adminRoleId: (role.json() as { data: { id: string } }).data.id,
          status: 'active',
        });
        await em.flush();
      }
      ADMIN_COOKIES['stub-d173-max-grant-session'] = { adminUserId: MAX_GRANT_ID };

      const resolved = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/products/${MISSING_PRODUCT_ID}/resolved-price`,
        ...MAX_GRANT,
      });
      expect(
        resolved.statusCode,
        'a permanently mounted endpoint behind a permission nobody can be ' +
          'granted — the gate must name a code `price_lists` owns',
      ).not.toBe(403);
      expect(resolved.statusCode).toBe(404);
    });
  });
});
