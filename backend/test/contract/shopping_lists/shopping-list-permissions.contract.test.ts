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
import { seedMemberWithPermissions } from '../../helpers/seed-organization-roles.js';

/**
 * Shopping lists by organization permission (`specs/170-organization-roles/`
 * WP-06, T086; `contracts/storefront-api.md` §5; FR-047, FR-048, spec *Edge
 * Cases — composite actions*).
 *
 *  - Creating, renaming, editing and deleting lists and their lines, and
 *    setting the default list, need `shopping_lists.create`.
 *  - Converting a list needs `shopping_lists.convert` **and** the target's
 *    create permission — `carts.create` into a cart, `quote_requests.create`
 *    into a quote request. Two guards, never a combined code: the refusal names
 *    the first one missing, `shopping_lists.convert` first.
 *  - Reading one's own lists stays open to every member.
 *
 * Every refusal is `403 ORGANIZATION_PERMISSION_REQUIRED` with the code in
 * `details.permission`, answered before the body or the list is looked at.
 */

const MISSING_ITEM = '00000000-0000-4000-8000-00000000f0f0';

interface Member {
  readonly id: string;
  readonly cookies: Record<string, string>;
  /** The member's own default list — every account has one. */
  listId: string;
}

function refusal(body: string): { code: string; permission: string | undefined } {
  const error = (JSON.parse(body) as { error: { code: string; details?: { permission?: string } } }).error;
  return { code: error.code, permission: error.details?.permission };
}

describe('shopping lists — organization permission gates', () => {
  let h: BackendServerHandle;
  const cookieNames: string[] = [];

  async function member(label: string, permissions: readonly string[]): Promise<Member> {
    const id = randomUUID();
    const em = h.em();
    await em.getConnection().execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
       values (?, ?, ?, 'x', 'List', ?, now(), now())`,
      [id, TEST_ORGANIZATION_ID, `${id.slice(0, 8)}@shopping-list-permissions.example`, label],
    );
    await seedMemberWithPermissions(em, {
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: id,
      permissions,
    });
    // The fixture writes the role with SQL, past the role cache's drop; this
    // process has read the Organization's roles already, so drop its entry.
    (h.container.cradle as unknown as { organizationRoleCache: { invalidateLocal(id?: string): void } })
      .organizationRoleCache.invalidateLocal(TEST_ORGANIZATION_ID);
    const cookie = `stub-shopping-list-permissions-${label}`;
    CUSTOMER_COOKIES[cookie] = { customerAccountId: id, organizationId: TEST_ORGANIZATION_ID };
    cookieNames.push(cookie);
    const cookies = { b2b_session: cookie };
    const read = await h.app.inject({ method: 'GET', url: '/api/v1/shopping-lists/default', cookies });
    expect(read.statusCode, read.body).toBe(200);
    return { id, cookies, listId: (read.json() as { data: { id: string } }).data.id };
  }

  /** A line on `who`'s default list, written as the fixture it is. */
  async function seedLine(who: Member): Promise<void> {
    await h.em().getConnection().execute(
      `insert into "shopping_list_items" ("id","shopping_list_id","product_id","quantity","created_at","updated_at")
       values (?, ?, ?, 1, now(), now())`,
      [randomUUID(), who.listId, SEED_PRODUCT_101_ID],
    );
  }

  function inject(who: Member, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) {
    return h.app.inject({ method, url, cookies: who.cookies, ...(payload ? { payload } : {}) });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    for (const cookie of cookieNames) delete CUSTOMER_COOKIES[cookie];
    await teardownBackendServer(h);
  });

  describe('writes need shopping_lists.create (FR-047)', () => {
    const writes: Array<[string, 'POST' | 'PATCH' | 'DELETE', (listId: string) => string, object | undefined]> = [
      ['create a list', 'POST', () => '/api/v1/shopping-lists', { name: 'Refused list' }],
      ['rename a list', 'PATCH', (id) => `/api/v1/shopping-lists/${id}`, { name: 'Renamed' }],
      ['delete a list', 'DELETE', (id) => `/api/v1/shopping-lists/${id}`, undefined],
      ['set the default list', 'POST', (id) => `/api/v1/shopping-lists/${id}/set-default`, undefined],
      ['add a line', 'POST', (id) => `/api/v1/shopping-lists/${id}/items`, { productId: SEED_PRODUCT_101_ID, quantity: 1 }],
      ['add a line to the default list', 'POST', () => '/api/v1/shopping-lists/default/items', { productId: SEED_PRODUCT_101_ID, quantity: 1 }],
      ['change a line', 'PATCH', (id) => `/api/v1/shopping-lists/${id}/items/${MISSING_ITEM}`, { quantity: 2 }],
      ['remove a line', 'DELETE', (id) => `/api/v1/shopping-lists/${id}/items/${MISSING_ITEM}`, undefined],
      ['empty a list', 'DELETE', (id) => `/api/v1/shopping-lists/${id}/items`, undefined],
    ];

    it.each(writes)('refuses a member without it to %s', async (_action, method, url, payload) => {
      const reader = await member(`reader-${method}-${randomUUID().slice(0, 6)}`, ['shopping_lists.convert', 'carts.create']);
      await seedLine(reader);
      const res = await inject(reader, method, url(reader.listId), payload);
      expect(res.statusCode, res.body).toBe(403);
      expect(refusal(res.body)).toEqual({
        code: ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED,
        permission: 'shopping_lists.create',
      });
      // Nothing moved: the default list and its one line are still there.
      const own = await inject(reader, 'GET', `/api/v1/shopping-lists/${reader.listId}`);
      expect(own.statusCode).toBe(200);
      expect((own.json() as { data: { items: unknown[]; isDefault: boolean } }).data).toMatchObject({ isDefault: true });
      expect((own.json() as { data: { items: unknown[] } }).data.items).toHaveLength(1);
    });

    it('serves a holder through the write family', async () => {
      const editor = await member('editor', ['shopping_lists.create']);
      const created = await inject(editor, 'POST', '/api/v1/shopping-lists', { name: 'Editor list' });
      expect(created.statusCode, created.body).toBe(201);
      const listId = (created.json() as { data: { id: string } }).data.id;

      const added = await inject(editor, 'POST', `/api/v1/shopping-lists/${listId}/items`, {
        productId: SEED_PRODUCT_101_ID,
        quantity: 1,
      });
      expect(added.statusCode, added.body).toBe(201);
      const itemId = (added.json() as { data: { items: Array<{ id: string }> } }).data.items[0]!.id;

      expect((await inject(editor, 'PATCH', `/api/v1/shopping-lists/${listId}/items/${itemId}`, { quantity: 3 })).statusCode).toBe(200);
      expect((await inject(editor, 'PATCH', `/api/v1/shopping-lists/${listId}`, { name: 'Editor list 2' })).statusCode).toBe(200);
      expect((await inject(editor, 'DELETE', `/api/v1/shopping-lists/${listId}/items/${itemId}`)).statusCode).toBe(204);
      expect((await inject(editor, 'DELETE', `/api/v1/shopping-lists/${listId}/items`)).statusCode).toBe(204);
      expect((await inject(editor, 'POST', `/api/v1/shopping-lists/${listId}/set-default`)).statusCode).toBe(200);
      expect(
        (await inject(editor, 'POST', '/api/v1/shopping-lists/default/items', { productId: SEED_PRODUCT_101_ID, quantity: 1 }))
          .statusCode,
      ).toBe(201);
      // The first default can go now that another list is the default.
      expect((await inject(editor, 'DELETE', `/api/v1/shopping-lists/${editor.listId}`)).statusCode).toBe(204);
    });
  });

  describe('reading one’s own lists stays open (FR-047)', () => {
    it('serves a member holding no shopping-list permission', async () => {
      const reader = await member('reads-only', []);
      expect((await inject(reader, 'GET', '/api/v1/shopping-lists')).statusCode).toBe(200);
      expect((await inject(reader, 'GET', '/api/v1/shopping-lists/default')).statusCode).toBe(200);
      expect((await inject(reader, 'GET', `/api/v1/shopping-lists/${reader.listId}`)).statusCode).toBe(200);
    });
  });

  describe('converting needs shopping_lists.convert and the target’s create permission (FR-048)', () => {
    it.each([
      ['convert-to-cart', 'lacking both', 'shopping_lists.convert', ['shopping_lists.create']],
      ['convert-to-cart', 'without shopping_lists.convert', 'shopping_lists.convert', ['carts.create']],
      ['convert-to-cart', 'without carts.create', 'carts.create', ['shopping_lists.convert', 'quote_requests.create']],
      ['convert-to-rfq', 'lacking both', 'shopping_lists.convert', ['shopping_lists.create']],
      ['convert-to-rfq', 'without shopping_lists.convert', 'shopping_lists.convert', ['quote_requests.create']],
      ['convert-to-rfq', 'without quote_requests.create', 'quote_requests.create', ['shopping_lists.convert', 'carts.create']],
    ])('%s refuses a member %s, naming %s', async (route, _who, missing, held) => {
      const who = await member(`${route}-${randomUUID().slice(0, 6)}`, held);
      await seedLine(who);
      const res = await inject(who, 'POST', `/api/v1/shopping-lists/${who.listId}/${route}`, {});
      expect(res.statusCode, res.body).toBe(403);
      expect(refusal(res.body)).toEqual({ code: ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED, permission: missing });
    });

    it('converts into the basket for a holder of shopping_lists.convert and carts.create', async () => {
      const who = await member('converts-to-cart', ['shopping_lists.convert', 'carts.create']);
      await seedLine(who);
      const res = await inject(who, 'POST', `/api/v1/shopping-lists/${who.listId}/convert-to-cart`, {});
      expect(res.statusCode, res.body).toBe(200);
    });

    it('converts into a quote request for a holder of shopping_lists.convert and quote_requests.create', async () => {
      const who = await member('converts-to-rfq', ['shopping_lists.convert', 'quote_requests.create']);
      await seedLine(who);
      const res = await inject(who, 'POST', `/api/v1/shopping-lists/${who.listId}/convert-to-rfq`, {});
      expect(res.statusCode, res.body).toBe(200);
    });
  });
});
