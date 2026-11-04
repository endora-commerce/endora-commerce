import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { seedCartOrganization, type CartFixtureOrganization } from '../../helpers/cart-approval-roles.js';

/**
 * The sign-in merge of a guest basket is judged against `carts.create`
 * (`specs/170-organization-roles/` WP-04, T126; owner ruling PR-12; research
 * R-35; FR-030a).
 *
 * `CartService.mergeAnonymousIntoCustomer` moves a guest basket's lines into
 * the member's basket — a cart write by the now signed-in member. For a member
 * whose role lacks `carts.create` it is **skipped**: the outcome is
 * `skipped_permission`, no line moves, no `cart_merged_from_anon` row is
 * written, and the guest basket stays `active` with its token and its lines.
 * For a member holding the code the four feature-037 outcomes are unchanged.
 * The login succeeds either way; what the login answer and the anonymous
 * cookie do with `skipped_permission` is `organizations`' (WP-03, T128/T129).
 */

interface StoredCart {
  status: string;
  anonymous_cart_token: string | null;
  lines: number;
}

describe('the sign-in merge under carts.create (PR-12)', () => {
  let h: BackendServerHandle;
  let org: CartFixtureOrganization;

  beforeAll(async () => {
    h = await setupBackendServer();
    org = await seedCartOrganization(h, {
      label: 'WP-04 sign-in merge',
      members: { RESTRICTED: { permissions: [] }, MEMBER: 'member' },
      channels: ['default'],
    });
    const passwordHash = await hashPassword(STUB_CUSTOMER_PASSWORD);
    await h
      .em()
      .getConnection()
      .execute(`update "customer_accounts" set "password_hash" = ? where "id" in (?, ?)`, [
        passwordHash,
        org.actors['RESTRICTED']!.id,
        org.actors['MEMBER']!.id,
      ]);
  }, 60_000);

  afterAll(async () => {
    org?.release();
    await teardownBackendServer(h);
  });

  async function sql<T>(statement: string, params: unknown[]): Promise<T[]> {
    return (await h.em().getConnection().execute(statement, params)) as T[];
  }

  /** A guest basket on the system default channel with one line; answers its token and id. */
  async function guestBasket(): Promise<{ token: string; cartId: string }> {
    const token = `anon-wp04-merge-${randomUUID()}`;
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 2 },
      cookies: { b2b_cart_anon: token },
    });
    expect(add.statusCode, add.body).toBe(200);
    return { token, cartId: (add.json() as { data: { id: string } }).data.id };
  }

  async function stored(cartId: string): Promise<StoredCart> {
    const [row] = await sql<StoredCart>(
      `select c."status", c."anonymous_cart_token",
              (select count(*)::int from "cart_items" i where i."cart_id" = c."id") as "lines"
         from "carts" c where c."id" = ?`,
      [cartId],
    );
    expect(row, `cart ${cartId} is stored`).toBeDefined();
    return row!;
  }

  async function mergeAudits(customerAccountId: string): Promise<number> {
    const [row] = await sql<{ n: number }>(
      `select count(*)::int as "n"
         from "cart_audit_entries" e join "carts" c on c."id" = e."cart_id"
        where c."customer_account_id" = ? and e."action" = 'cart_merged_from_anon'`,
      [customerAccountId],
    );
    return row!.n;
  }

  function login(key: string, token: string) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: org.actors[key]!.email, password: STUB_CUSTOMER_PASSWORD },
      cookies: { b2b_cart_anon: token },
    });
  }

  it('a member without carts.create: skipped_permission, nothing moved, nothing audited, the guest basket intact', async () => {
    const actor = org.actors['RESTRICTED']!;
    const { token, cartId } = await guestBasket();

    const outcome = await (
      h.container.resolve('cartService') as {
        mergeAnonymousIntoCustomer(
          token: string,
          ctx: { customerAccountId: string; organizationId: string | null; salesChannelId: string },
        ): Promise<{ outcome: string; movedLineCount: number; summedLineCount: number; destinationCartId: string }>;
      }
    ).mergeAnonymousIntoCustomer(token, {
      customerAccountId: actor.id,
      organizationId: org.organizationId,
      salesChannelId: (await sql<{ sales_channel_id: string }>(`select "sales_channel_id" from "carts" where "id" = ?`, [cartId]))[0]!
        .sales_channel_id,
    });

    expect(outcome).toMatchObject({ outcome: 'skipped_permission', movedLineCount: 0, summedLineCount: 0 });
    expect(outcome.destinationCartId).not.toBe(cartId);
    expect(await stored(cartId)).toEqual({ status: 'active', anonymous_cart_token: token, lines: 1 });
    expect(await mergeAudits(actor.id)).toBe(0);
  });

  it('the login of such a member succeeds and leaves the guest basket as it was', async () => {
    const actor = org.actors['RESTRICTED']!;
    const { token, cartId } = await guestBasket();

    const res = await login('RESTRICTED', token);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { cartMerge?: { outcome: string } } }).data.cartMerge?.outcome).toBe('noop');
    expect(await stored(cartId)).toEqual({ status: 'active', anonymous_cart_token: token, lines: 1 });
    expect(await mergeAudits(actor.id)).toBe(0);
  });

  it('a member holding carts.create merges as feature 037 does: adopted, the guest basket consumed, audited', async () => {
    const actor = org.actors['MEMBER']!;
    const { token, cartId } = await guestBasket();

    const res = await login('MEMBER', token);
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { cartMerge?: { outcome: string } } }).data.cartMerge?.outcome).toBe('adopted');
    expect(await stored(cartId)).toEqual({ status: 'completed', anonymous_cart_token: null, lines: 0 });
    expect(await mergeAudits(actor.id)).toBe(1);

    // A second guest basket into the now existing one: merged.
    const second = await guestBasket();
    const again = await login('MEMBER', second.token);
    expect(again.statusCode, again.body).toBe(200);
    expect((again.json() as { data: { cartMerge?: { outcome: string } } }).data.cartMerge?.outcome).toBe('merged');
    expect(await mergeAudits(actor.id)).toBe(2);

    // An empty guest basket: noop, and the basket is consumed (noop_empty).
    const empty = await guestBasket();
    const [line] = await sql<{ id: string }>(`select "id" from "cart_items" where "cart_id" = ?`, [empty.cartId]);
    const removed = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/cart/items/${line!.id}`,
      cookies: { b2b_cart_anon: empty.token },
    });
    expect(removed.statusCode, removed.body).toBe(200);
    const emptyLogin = await login('MEMBER', empty.token);
    expect(emptyLogin.statusCode, emptyLogin.body).toBe(200);
    expect((emptyLogin.json() as { data: { cartMerge?: { outcome: string } } }).data.cartMerge?.outcome).toBe('noop');
    expect((await stored(empty.cartId)).status).toBe('completed');
    expect(await mergeAudits(actor.id)).toBe(2);

    // And a token naming no basket: noop.
    const none = await login('MEMBER', `anon-wp04-none-${randomUUID()}`);
    expect(none.statusCode, none.body).toBe(200);
    expect((none.json() as { data: { cartMerge?: { outcome: string } } }).data.cartMerge?.outcome).toBe('noop');
  });
});
