import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CUSTOMER_COOKIES, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  assignOrganizationRole,
  predefinedRoleIdOf,
  seedCustomOrganizationRole,
} from '../../helpers/seed-organization-roles.js';
import { acceptedQuoteRequest } from '../../helpers/quote-conversion.js';

/**
 * Quote requests gated by organization permissions
 * (`specs/170-organization-roles/` WP-05, T080; `contracts/storefront-api.md`
 * §5; FR-040, FR-041 in its P2 form, US 1.3; research R-30).
 *
 *  - `POST /api/v1/quote-requests` and `POST …/:id/resubmit` need
 *    `quote_requests.create`; `POST …/:id/convert-to-order` needs
 *    `carts.create`, since it fills the basket. A refusal is `403
 *    ORGANIZATION_PERMISSION_REQUIRED` naming the code, answered before the
 *    body is validated and before the quote request is looked up.
 *  - Seeing every quote request of the Organization is reserved to the
 *    *Administrator* role kind until P3 (R-30) — judged by the role the member
 *    holds, never by the legacy `role` column, and granted by no code: a
 *    custom role holding every commerce code still sees only its own.
 *
 * Every actor is an account of `TEST_ORGANIZATION_ID` seeded here, holding a
 * role chosen per case, behind a cookie of its own.
 */

const ADMIN = { b2b_session: 'stub-customer-session' };

describe('quote requests — organization permissions (170 WP-05)', () => {
  let h: BackendServerHandle;
  const cookies: string[] = [];
  const stamp = randomUUID().slice(0, 8);

  /** An account of the test Organization holding `roleId`, behind a fresh cookie. */
  async function member(roleId: string, label: string): Promise<{ id: string; cookies: Record<string, string> }> {
    const id = randomUUID();
    await h.em().getConnection().execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
       values (?, ?, ?, 'x', 'Rfq', ?, now(), now())`,
      [id, TEST_ORGANIZATION_ID, `${label}-${stamp}-${id.slice(0, 6)}@rfq-permissions.example`, label],
    );
    await assignOrganizationRole(h.em(), id, roleId);
    const cookie = `stub-170-05-${label}-${id.slice(0, 8)}`;
    CUSTOMER_COOKIES[cookie] = { customerAccountId: id, organizationId: TEST_ORGANIZATION_ID };
    cookies.push(cookie);
    return { id, cookies: { b2b_session: cookie } };
  }

  async function createRfq(as: Record<string, string>): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: as,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3, desiredUnitPrice: 9 }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  function expectPermissionRefusal(res: { statusCode: number; body: string; json(): unknown }, code: string): void {
    expect(res.statusCode, res.body).toBe(403);
    const body = res.json() as { error: { code: string; details?: { permission?: string } } };
    expect(body.error.code).toBe(ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED);
    expect(body.error.details?.permission).toBe(code);
  }

  let memberRoleId: string;
  let administratorRoleId: string;
  /** Holds every present commerce code but `quote_requests.create`. */
  let withoutCreate: { id: string; cookies: Record<string, string> };
  /** Holds `quote_requests.create` and nothing else. */
  let createOnly: { id: string; cookies: Record<string, string> };
  /** A custom role holding every P2 code. */
  let broad: { id: string; cookies: Record<string, string> };

  beforeAll(async () => {
    h = await setupBackendServer();
    memberRoleId = await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'member');
    administratorRoleId = await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'administrator');
    withoutCreate = await member(
      await seedCustomOrganizationRole(h.em(), {
        organizationId: TEST_ORGANIZATION_ID,
        name: `No RFQ ${stamp}`,
        permissions: ['carts.create'],
      }),
      'no-create',
    );
    createOnly = await member(
      await seedCustomOrganizationRole(h.em(), {
        organizationId: TEST_ORGANIZATION_ID,
        name: `RFQ only ${stamp}`,
        permissions: ['quote_requests.create'],
      }),
      'create-only',
    );
    // Every custom role is seeded here, before the first request fills the
    // Organization's role cache: a raw insert announces nothing.
    broad = await member(
      await seedCustomOrganizationRole(h.em(), {
        organizationId: TEST_ORGANIZATION_ID,
        name: `Broad ${stamp}`,
        permissions: [
          'addresses.manage',
          'carts.approve',
          'carts.create',
          'carts.order_without_approval',
          'orders.view_organization',
          'quick_order.one_click',
          'quote_requests.create',
          'shopping_lists.convert',
          'shopping_lists.create',
        ],
      }),
      'broad',
    );
  });

  afterAll(async () => {
    for (const cookie of cookies) delete CUSTOMER_COOKIES[cookie];
    await teardownBackendServer(h);
  });

  describe('POST /api/v1/quote-requests (FR-040, US 1.3)', () => {
    it('refuses a member whose role lacks quote_requests.create, naming the code', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quote-requests',
        cookies: withoutCreate.cookies,
        payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3 }] },
      });
      expectPermissionRefusal(res, 'quote_requests.create');
    });

    it('refuses before the body is validated', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quote-requests',
        cookies: withoutCreate.cookies,
        payload: { items: 'not-an-array' },
      });
      expectPermissionRefusal(res, 'quote_requests.create');
    });

    it('creates for a role holding it, and for the predefined Member role (member default)', async () => {
      await createRfq(createOnly.cookies);
      const plain = await member(memberRoleId, 'member');
      await createRfq(plain.cookies);
    });

    it('still answers 401 to an anonymous visitor', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quote-requests',
        payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3 }] },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/quote-requests/:id/resubmit (FR-040)', () => {
    it('needs quote_requests.create — refused before the quote request is looked up', async () => {
      const own = await createRfq(createOnly.cookies);
      // The source is a colleague's: without the code the answer is still 403, never 404.
      const refused = await h.app.inject({
        method: 'POST',
        url: `/api/v1/quote-requests/${own}/resubmit`,
        cookies: withoutCreate.cookies,
        payload: {},
      });
      expectPermissionRefusal(refused, 'quote_requests.create');

      const allowed = await h.app.inject({
        method: 'POST',
        url: `/api/v1/quote-requests/${own}/resubmit`,
        cookies: createOnly.cookies,
        payload: {},
      });
      expect(allowed.statusCode, allowed.body).toBe(201);
    });
  });

  describe('POST /api/v1/quote-requests/:id/convert-to-order (FR-040)', () => {
    it('needs carts.create, since it fills the basket', async () => {
      const accepted = await acceptedQuoteRequest(h, {}, createOnly.cookies);
      const refused = await h.app.inject({
        method: 'POST',
        url: `/api/v1/quote-requests/${accepted.id}/convert-to-order`,
        cookies: createOnly.cookies,
        payload: {},
      });
      expectPermissionRefusal(refused, 'carts.create');

      // The same member, moved to *Member* (which holds `carts.create` by default).
      await assignOrganizationRole(h.em(), createOnly.id, memberRoleId);
      const allowed = await h.app.inject({
        method: 'POST',
        url: `/api/v1/quote-requests/${accepted.id}/convert-to-order`,
        cookies: createOnly.cookies,
        payload: {},
      });
      expect(allowed.statusCode, allowed.body).toBe(200);
    });
  });

  describe('Organization-wide visibility — administrator role kind only (FR-041 P2 form, R-30)', () => {
    async function listed(as: Record<string, string>): Promise<string[]> {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/quote-requests', cookies: as });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { data: Array<{ id: string }> }).data.map((r) => r.id);
    }
    async function detailStatus(as: Record<string, string>, id: string): Promise<number> {
      return (await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${id}`, cookies: as })).statusCode;
    }

    let colleagues: string;
    beforeAll(async () => {
      const author = await member(memberRoleId, 'author');
      colleagues = await createRfq(author.cookies);
    });

    it('the Administrator sees a colleague’s quote request in the list and the detail', async () => {
      expect(await listed(ADMIN)).toContain(colleagues);
      expect(await detailStatus(ADMIN, colleagues)).toBe(200);
    });

    it('a Member sees only its own; a colleague’s answers 404', async () => {
      const plain = await member(memberRoleId, 'viewer');
      const own = await createRfq(plain.cookies);
      const list = await listed(plain.cookies);
      expect(list).toContain(own);
      expect(list).not.toContain(colleagues);
      expect(await detailStatus(plain.cookies, colleagues)).toBe(404);
    });

    it('no code widens it: a custom role holding every commerce code sees only its own', async () => {
      expect(await listed(broad.cookies)).not.toContain(colleagues);
      expect(await detailStatus(broad.cookies, colleagues)).toBe(404);
    });

    it('is judged by the role held', async () => {
      // Holding *Member*: sees only its own.
      const memberHolder = await member(memberRoleId, 'member-holder');
      expect(await listed(memberHolder.cookies)).not.toContain(colleagues);
      expect(await detailStatus(memberHolder.cookies, colleagues)).toBe(404);

      // Holding *Administrator*: sees every quote request.
      const roleAdmin = await member(administratorRoleId, 'role-admin');
      expect(await listed(roleAdmin.cookies)).toContain(colleagues);
      expect(await detailStatus(roleAdmin.cookies, colleagues)).toBe(200);
    });
  });
});
