import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cartFullResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';
import { seedCartOrganization, type CartFixtureOrganization } from '../../helpers/cart-approval-roles.js';
import { assignOrganizationRole } from '../../helpers/seed-organization-roles.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Issue #755 (owner ruling 2026-11-05) — after an approver rejects a member's
 * basket, the member's next basket starts with the rejected basket's lines.
 *
 *  - Restored once: into the fresh basket opened after the rejection, and never
 *    again — not after the member empties it.
 *  - Never into a basket that already exists (the #169 rule).
 *  - A line that can no longer be bought is skipped and reported on the
 *    rejection notice (`previousRejection.skippedLines`).
 *  - Only for a member who may create baskets (`carts.create`).
 *  - Audited: a `lines_restored_from_rejection` row on the new basket.
 *
 * The rejected basket is left as it was, for the approver's list.
 */

const RETAIL = { 'x-sales-channel': 'pl_retail' };
const REASON = 'Reduce the quantity to 1';
/** A product that no longer exists: its line cannot be restored. */
const GONE_PRODUCT_ID = randomUUID();

const strictFull = deepStrict(cartFullResponseSchema);

interface CartRead {
  id: string;
  status: string;
  approvalStatus: string;
  itemCount: number;
  appliedPromotionCode?: string | null;
  items: Array<{ productId: string; quantity: number }>;
  previousRejection: {
    cartId: string;
    reason: string | null;
    restoredLineCount: number;
    skippedLines: Array<{ productId: string; productName: string; reason: string }>;
  } | null;
}

describe('restoring a rejected basket (issue #755)', () => {
  let h: BackendServerHandle;
  let org: CartFixtureOrganization;

  beforeAll(async () => {
    h = await setupBackendServer();
    org = await seedCartOrganization(h, {
      label: 'Issue 755 restore',
      approvalRequired: true,
      members: {
        MEMBER: 'member',
        HOLDER: 'member',
        ADDER: 'member',
        NAMED: 'member',
        LOSER: { permissions: ['carts.create'] },
        NOBODY: { permissions: [] },
        ADMIN: 'administrator',
      },
    });
  }, 60_000);

  afterAll(async () => {
    org?.release();
    await teardownBackendServer(h);
  });

  const actor = (key: string) => org.actors[key]!;

  async function sql<T>(statement: string, params: unknown[]): Promise<T[]> {
    return (await h.em().getConnection().execute(statement, params)) as T[];
  }

  function call(key: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) {
    return h.app.inject({
      method,
      url,
      cookies: { b2b_session: actor(key).cookie },
      headers: { ...RETAIL, ...(payload ? { 'content-type': 'application/json' } : {}) },
      ...(payload ? { payload } : {}),
    });
  }

  async function readCart(key: string): Promise<CartRead> {
    const res = await call(key, 'GET', '/api/v1/cart');
    expect(res.statusCode, res.body).toBe(200);
    expect(disagreements(strictFull, res.json())).toEqual([]);
    return (res.json() as { data: CartRead }).data;
  }

  /** The member's basket with product 101 × `quantity`, sent for approval; answers its id. */
  async function submittedBasket(key: string, quantity: number): Promise<string> {
    const add = await call(key, 'POST', '/api/v1/cart/items', { productId: SEED_PRODUCT_101_ID, quantity });
    expect(add.statusCode, add.body).toBe(200);
    const cartId = (add.json() as { data: { id: string } }).data.id;
    const submit = await call(key, 'POST', '/api/v1/cart/submit-for-approval');
    expect(submit.statusCode, submit.body).toBe(200);
    return cartId;
  }

  async function reject(cartId: string): Promise<void> {
    const res = await call('ADMIN', 'POST', `/api/v1/organization/carts/${cartId}/reject`, { reason: REASON });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function linesOf(cartId: string): Promise<Array<{ product_id: string; quantity: number }>> {
    return sql(`select "product_id", "quantity" from "cart_items" where "cart_id" = ? order by "created_at"`, [cartId]);
  }

  async function restoreAudits(cartId: string): Promise<Array<{ actor_type: string; metadata: Record<string, unknown> }>> {
    return sql(
      `select "actor_type", "metadata" from "cart_audit_entries"
        where "cart_id" = ? and "action" = 'lines_restored_from_rejection'`,
      [cartId],
    );
  }

  let rejectedCartId: string;
  let restoredCartId: string;

  it("the next read after a rejection has the rejected basket's lines and the notice", async () => {
    rejectedCartId = await submittedBasket('MEMBER', 3);
    // A line whose product has gone since it was put in the basket.
    await sql(
      `insert into "cart_items" ("id","cart_id","product_id","quantity","unit_price","currency","created_at","updated_at")
       values (?, ?, ?, 2, 10, 'PLN', now() + interval '1 second', now())`,
      [randomUUID(), rejectedCartId, GONE_PRODUCT_ID],
    );
    await reject(rejectedCartId);

    const cart = await readCart('MEMBER');
    restoredCartId = cart.id;
    expect(cart.id).not.toBe(rejectedCartId);
    expect(cart).toMatchObject({ status: 'active', approvalStatus: 'not_required', itemCount: 1 });
    expect(cart.items.map((it) => ({ productId: it.productId, quantity: it.quantity }))).toEqual([
      { productId: SEED_PRODUCT_101_ID, quantity: 3 },
    ]);
    expect(cart.previousRejection).toMatchObject({
      cartId: rejectedCartId,
      reason: REASON,
      restoredLineCount: 1,
      skippedLines: [{ productId: GONE_PRODUCT_ID, reason: 'not_purchasable' }],
    });
  });

  // Feature 174 (FR-030) — a skipped line whose product still exists is named
  // as the channel names it (C → Global, the channel's default language), not
  // by a per-language map the catalogue no longer stores.
  it("names a skipped line by the product's effective name on the basket's channel", async () => {
    const productId = randomUUID();
    await sql(
      `insert into "products" ("id","sku","slug","type","status","name","created_at","updated_at")
       values (?, ?, ?, 'simple', 'active', 'Global 755 name', now(), now())`,
      [productId, `R755-${productId.slice(0, 8)}`, `r755-${productId.slice(0, 8)}`],
    );
    const [{ id: channelId }] = (await sql<{ id: string }>(
      `select "id" from "sales_channels" where "code" = 'pl_retail'`,
      [],
    )) as [{ id: string }];
    await sql(
      `insert into "product_value_overrides" ("id","product_id","attribute_key","channel_id","language_code","value","created_at","updated_at")
       values (?, ?, 'name', ?, null, ?::jsonb, now(), now())`,
      [randomUUID(), productId, channelId, JSON.stringify({ v: 'Channel 755 name' })],
    );
    const rejected = await submittedBasket('NAMED', 1);
    // A line of a product that exists but that the member can no longer add.
    await sql(
      `insert into "cart_items" ("id","cart_id","product_id","quantity","unit_price","currency","created_at","updated_at")
       values (?, ?, ?, 1, 10, 'PLN', now() + interval '1 second', now())`,
      [randomUUID(), rejected, productId],
    );
    await reject(rejected);

    const cart = await readCart('NAMED');
    expect(cart.previousRejection).toMatchObject({ cartId: rejected, restoredLineCount: 1 });
    expect(cart.previousRejection!.skippedLines).toEqual([
      expect.objectContaining({ productId, productName: 'Channel 755 name' }),
    ]);
    await sql(`delete from "product_value_overrides" where "product_id" = ?`, [productId]);
    await sql(`delete from "products" where "id" = ?`, [productId]);
  });

  it('leaves the rejected basket as it was, and audits the restore on the new one', async () => {
    const [rejected] = await sql<{ status: string; approval_status: string }>(
      `select "status", "approval_status" from "carts" where "id" = ?`,
      [rejectedCartId],
    );
    expect(rejected).toEqual({ status: 'rejected', approval_status: 'rejected_by_org_admin' });
    expect(await linesOf(rejectedCartId)).toHaveLength(2);

    const audits = await restoreAudits(restoredCartId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.metadata).toMatchObject({ fromCartId: rejectedCartId, restoredLineCount: 1 });
  });

  it('is not restored twice: an emptied basket stays empty', async () => {
    const [line] = (await readCart('MEMBER')).items as Array<{ id?: string }>;
    const remove = await call('MEMBER', 'DELETE', `/api/v1/cart/items/${line!.id}`);
    expect(remove.statusCode, remove.body).toBe(200);

    const cart = await readCart('MEMBER');
    expect(cart.id).toBe(restoredCartId);
    expect(cart.itemCount).toBe(0);
    expect(await restoreAudits(restoredCartId)).toHaveLength(1);
  });

  it('is not restored into a newer basket once the restored one is closed', async () => {
    // The restored basket abandoned: the next basket is opened after it, so the
    // rejected one is no longer the member's most recent.
    await sql(`update "carts" set "status" = 'abandoned' where "id" = ?`, [restoredCartId]);
    const cart = await readCart('MEMBER');
    expect(cart.id).not.toBe(restoredCartId);
    expect(cart.itemCount).toBe(0);
    expect(await restoreAudits(cart.id)).toHaveLength(0);
  });

  it('restores before the first add when that add opens the basket', async () => {
    const rejected = await submittedBasket('ADDER', 2);
    await reject(rejected);

    // No read in between: the add itself opens the basket, which starts with
    // the restored line, and the add lands on it.
    const add = await call('ADDER', 'POST', '/api/v1/cart/items', { productId: SEED_PRODUCT_101_ID, quantity: 1 });
    expect(add.statusCode, add.body).toBe(200);
    const cart = (add.json() as { data: CartRead }).data;
    expect(cart.id).not.toBe(rejected);
    expect(cart.items.map((it) => ({ productId: it.productId, quantity: it.quantity }))).toEqual([
      { productId: SEED_PRODUCT_101_ID, quantity: 3 },
    ]);
    expect(cart.previousRejection).toMatchObject({ cartId: rejected, restoredLineCount: 1, skippedLines: [] });
  });

  it('leaves an active basket that already exists untouched', async () => {
    const rejected = await submittedBasket('HOLDER', 2);
    await reject(rejected);
    // A basket the member already holds on the channel when the restore would run.
    const [{ sales_channel_id: channelId }] = await sql<{ sales_channel_id: string }>(
      `select "sales_channel_id" from "carts" where "id" = ?`,
      [rejected],
    ) as [{ sales_channel_id: string }];
    const existing = randomUUID();
    await sql(
      `insert into "carts" ("id","customer_account_id","organization_id","sales_channel_id","status","approval_status","created_at","updated_at","last_activity_at")
       values (?, ?, ?, ?, 'active', 'not_required', now(), now(), now())`,
      [existing, actor('HOLDER').id, org.organizationId, channelId],
    );

    const cart = await readCart('HOLDER');
    expect(cart.id).toBe(existing);
    expect(cart.itemCount).toBe(0);
    expect(cart.previousRejection).toMatchObject({ cartId: rejected, restoredLineCount: 0, skippedLines: [] });
    expect(await restoreAudits(existing)).toHaveLength(0);
  });

  it('restores nothing for a member who lost carts.create, and still tells them', async () => {
    const rejected = await submittedBasket('LOSER', 1);
    await assignOrganizationRole(h.em(), actor('LOSER').id, actor('NOBODY').roleId!);
    await reject(rejected);

    const cart = await readCart('LOSER');
    expect(cart.id).not.toBe(rejected);
    expect(cart.itemCount).toBe(0);
    expect(cart.previousRejection).toMatchObject({ cartId: rejected, restoredLineCount: 0, skippedLines: [] });
    expect(await restoreAudits(cart.id)).toHaveLength(0);
  });
});
