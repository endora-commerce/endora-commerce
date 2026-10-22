import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminUser } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { hashPassword } from '@endora-commerce/platform/kernel';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';

/**
 * Issue #219 — `price_lists` owns `price_lists:read` and `price_lists:write`.
 *
 * Every admin route in this module used to be gated by `catalog:write`, which
 * meant a role granted catalogue content work could change what customers pay.
 * Nobody chose that boundary; it was the side effect of the module declaring no
 * codes of its own. Pricing is not catalogue content, so the gates now name the
 * module that owns them, and the split is read/write rather than one code:
 * listing a price list and editing its brackets are not the same authority.
 *
 * The customer-group target picker is asserted here too. Issue #180's ruling
 * took `catalog:write` off the canonical customer-group endpoints and this copy
 * was missed — the `promotions` and `pwa` twins have always answered behind
 * their own module's read permission. Feature 160 moved every route onto the
 * price-book API (`/api/v1/admin/price-books/…`); the codes did not change.
 *
 * There is deliberately **no** compatibility shim: `catalog:write` is refused,
 * not accepted alongside the new codes.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

const CATALOG_EDITOR = { cookies: { b2b_session: 'stub-pl-catalog-editor-session' } };
const CATALOG_EDITOR_ID = '00000000-0000-4000-8000-0000000000f1';

const PRICING_VIEWER = { cookies: { b2b_session: 'stub-pl-pricing-viewer-session' } };
const PRICING_VIEWER_ID = '00000000-0000-4000-8000-0000000000f2';

const PRICING_EDITOR = { cookies: { b2b_session: 'stub-pl-pricing-editor-session' } };
const PRICING_EDITOR_ID = '00000000-0000-4000-8000-0000000000f3';

describe('price_lists admin permission gates (issue #219)', () => {
  let h: BackendServerHandle;

  async function seedRole(
    id: string,
    code: string,
    name: string,
    permissions: string[],
    email: string,
  ): Promise<void> {
    const role = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/admin-roles/${code}`,
      ...ADMIN,
      payload: { code, name, permissions },
    });
    expect(role.statusCode).toBe(200);
    const em = h.em();
    em.create(AdminUser, {
      id,
      email,
      passwordHash: await hashPassword(STUB_CUSTOMER_PASSWORD),
      firstName: 'Price',
      lastName: 'Gate',
      adminRoleId: (role.json() as { data: { id: string } }).data.id,
      status: 'active',
    });
    await em.flush();
  }

  beforeAll(async () => {
    h = await setupBackendServer();

    await seedRole(
      CATALOG_EDITOR_ID,
      'pl_catalog_editor_219',
      'Catalog editor (219)',
      ['catalog:read', 'catalog:write'],
      'pl-catalog-editor-219@example.com',
    );
    await seedRole(
      PRICING_VIEWER_ID,
      'pl_pricing_viewer_219',
      'Pricing viewer (219)',
      ['price_lists:read'],
      'pl-pricing-viewer-219@example.com',
    );
    await seedRole(
      PRICING_EDITOR_ID,
      'pl_pricing_editor_219',
      'Pricing editor (219)',
      ['price_lists:read', 'price_lists:write'],
      'pl-pricing-editor-219@example.com',
    );

    ADMIN_COOKIES['stub-pl-catalog-editor-session'] = { adminUserId: CATALOG_EDITOR_ID };
    ADMIN_COOKIES['stub-pl-pricing-viewer-session'] = { adminUserId: PRICING_VIEWER_ID };
    ADMIN_COOKIES['stub-pl-pricing-editor-session'] = { adminUserId: PRICING_EDITOR_ID };
  });

  afterAll(async () => {
    delete ADMIN_COOKIES['stub-pl-catalog-editor-session'];
    delete ADMIN_COOKIES['stub-pl-pricing-viewer-session'];
    delete ADMIN_COOKIES['stub-pl-pricing-editor-session'];
    await teardownBackendServer(h);
  });

  const BOOK = {
    name: 'Gate book (219)',
    type: 'regular',
    currencyCode: 'PLN',
    channelIds: [],
    audience: { kind: 'everyone', memberIds: [] },
  };

  it('refuses a catalogue editor every pricing surface', async () => {
    for (const url of [
      '/api/v1/admin/price-books',
      '/api/v1/admin/price-books/precedence',
      '/api/v1/admin/price-books/targets/attributes',
      '/api/v1/admin/pricing/display-mode-overrides',
    ]) {
      const res = await h.app.inject({ method: 'GET', url, ...CATALOG_EDITOR });
      expect(res.statusCode, url).toBe(403);
    }
    const create = await h.app.inject({ method: 'POST', url: '/api/v1/admin/price-books', ...CATALOG_EDITOR, payload: BOOK });
    expect(create.statusCode).toBe(403);
  });

  it('lets a pricing viewer read but not write, refused before the body is read', async () => {
    const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/price-books', ...PRICING_VIEWER });
    expect(list.statusCode).toBe(200);
    const id = '00000000-0000-4000-8000-0000000002f9';
    for (const [method, url] of [
      ['POST', '/api/v1/admin/price-books'],
      ['PATCH', `/api/v1/admin/price-books/${id}`],
      ['PUT', `/api/v1/admin/price-books/${id}/rows`],
      ['POST', `/api/v1/admin/price-books/${id}/activate`],
      ['POST', `/api/v1/admin/price-books/${id}/duplicate`],
      ['DELETE', `/api/v1/admin/price-books/${id}`],
      ['PUT', `/api/v1/admin/price-books/base-prices/${id}`],
      ['PUT', '/api/v1/admin/price-books/settings/show-list-price'],
    ] as const) {
      const refused = await h.app.inject({ method, url, ...PRICING_VIEWER, payload: {} });
      expect(refused.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('lets a pricing editor read and write', async () => {
    const created = await h.app.inject({ method: 'POST', url: '/api/v1/admin/price-books', ...PRICING_EDITOR, payload: BOOK });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;
    const read = await h.app.inject({ method: 'GET', url: `/api/v1/admin/price-books/${id}`, ...PRICING_EDITOR });
    expect(read.statusCode).toBe(200);
    const removed = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/price-books/${id}`, ...PRICING_EDITOR });
    expect(removed.statusCode).toBe(204);
  });

  /**
   * Issue #180's ruling, applied to the copy it missed. A target picker lists
   * customer groups so a price book can name one; that is a pricing read, and
   * the module that owns the screen owns the gate.
   */
  it('serves the customer-group target behind the pricing read code, not catalog:write', async () => {
    const refused = await h.app.inject({ method: 'GET', url: '/api/v1/admin/price-books/targets/customer-groups', ...CATALOG_EDITOR });
    expect(refused.statusCode).toBe(403);
    const allowed = await h.app.inject({ method: 'GET', url: '/api/v1/admin/price-books/targets/customer-groups', ...PRICING_VIEWER });
    expect(allowed.statusCode).toBe(200);
    const body = allowed.json() as { data: { items: Array<{ id: string; code: string }> } };
    expect(Array.isArray(body.data.items)).toBe(true);
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/price-books' });
    expect([401, 403]).toContain(res.statusCode);
  });
});
