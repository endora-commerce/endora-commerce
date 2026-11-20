import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { seedRoleGranting } from '../../helpers/cart-approval-roles.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ADMIN, placePaidOrder } from './fixtures.js';

/**
 * `specs/182-related-payers/` T044 (FR-074, A-4) — whether the payer's people hear of an order
 * billed to them is the link's choice. With `notify_payer_on_orders` on, every active member of
 * Y whose role holds *View orders we pay for* (the Administrator among them) receives
 * `related_payer_order_placed` in the store's language; a member without it receives nothing.
 * With the flag off, nobody in Y is written to.
 *
 * RP-17 (b) — the second and last payer e-mail: `related_payer_order_cancelled`, on the same
 * opt-in, to the same people, when a paid order is cancelled.
 */
describe('related_payer_order_placed (FR-074)', () => {
  let h: BackendServerHandle;
  const mailer = new InMemoryMailer();
  const RUN = randomUUID().slice(0, 8);

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** Y's people: an administrator, a viewer holding the permission, a plain member. */
  async function payerPeople(payerId: string, tag: string): Promise<{ admin: string; viewer: string; member: string }> {
    const em = h.em();
    const email = (who: string) => `rp182-${tag}-${who}-${RUN}@example.com`;
    const viewerRole = await seedRoleGranting(em, payerId, ['related_payers.view_paid_orders']);
    await withSystemScope('test seed: payer members', async () => {
      const make = async (who: string, roleId: string) =>
        em.create(CustomerAccount, {
          id: randomUUID(),
          organizationId: payerId,
          email: email(who),
          passwordHash: 'not-a-real-hash',
          firstName: 'Payer',
          lastName: who,
          organizationRoleId: roleId,
          emailVerifiedAt: new Date(),
          blockedAt: null,
        } as never);
      await make('admin', await predefinedRoleIdOf(em, payerId, 'administrator'));
      await make('viewer', viewerRole);
      await make('member', await predefinedRoleIdOf(em, payerId, 'member'));
      await em.flush();
    });
    return { admin: email('admin'), viewer: email('viewer'), member: email('member') };
  }

  const toOrder = (orderId: string, kind = 'related_payer_order_placed') =>
    mailer.sent.filter((m) => m.meta?.['orderId'] === orderId && m.meta?.['kind'] === kind);

  async function cancel(orderId: string): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/status`,
      payload: { to: 'cancelled' },
      cookies: ADMIN,
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function channelLanguage(orderId: string): Promise<string> {
    const rows = await withSystemScope('test read: order channel language', () =>
      h
        .em()
        .getConnection()
        .execute<{ default_language: string }[]>(
          'select sc.default_language from sales_channels sc join orders o on o.sales_channel_id = sc.id where o.id = ?',
          [orderId],
        ),
    );
    return rows[0]!.default_language;
  }

  it('on: each holder of view_paid_orders is told, in the store language; nobody else', async () => {
    let people: { admin: string; viewer: string; member: string } | null = null;
    const { orderId } = await placePaidOrder(h, {
      notifyPayerOnOrders: true,
      beforePlacement: async (payerId) => {
        people = await payerPeople(payerId, 'on');
      },
    });
    await expect.poll(() => toOrder(orderId).length, { timeout: 5_000 }).toBe(2);
    const sent = toOrder(orderId);
    expect(sent.map((m) => m.to).sort()).toEqual([people!.admin, people!.viewer].sort());
    const language = await channelLanguage(orderId);
    const expected = language.startsWith('pl') ? /Zamówienie/ : /Order/;
    for (const message of sent) expect(message.subject).toMatch(expected);
  });

  it('off: nobody in the payer is written to', async () => {
    const { orderId } = await placePaidOrder(h, {
      notifyPayerOnOrders: false,
      beforePlacement: async (payerId) => {
        await payerPeople(payerId, 'off');
      },
    });
    // Give a subscriber that should not exist the time it would have taken.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(toOrder(orderId)).toEqual([]);
  });

  it('RP-17: on, a cancelled paid order tells the same people, in the store language', async () => {
    let people: { admin: string; viewer: string; member: string } | null = null;
    const { orderId } = await placePaidOrder(h, {
      notifyPayerOnOrders: true,
      beforePlacement: async (payerId) => {
        people = await payerPeople(payerId, 'cancel-on');
      },
    });
    await cancel(orderId);
    await expect.poll(() => toOrder(orderId, 'related_payer_order_cancelled').length, { timeout: 5_000 }).toBe(2);
    const sent = toOrder(orderId, 'related_payer_order_cancelled');
    expect(sent.map((m) => m.to).sort()).toEqual([people!.admin, people!.viewer].sort());
    const language = await channelLanguage(orderId);
    const expected = language.startsWith('pl') ? /anulowane/ : /cancelled/;
    for (const message of sent) expect(message.subject).toMatch(expected);
  });

  it('RP-17: off, a cancelled paid order tells nobody in the payer', async () => {
    const { orderId } = await placePaidOrder(h, {
      notifyPayerOnOrders: false,
      beforePlacement: async (payerId) => {
        await payerPeople(payerId, 'cancel-off');
      },
    });
    await cancel(orderId);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(toOrder(orderId, 'related_payer_order_cancelled')).toEqual([]);
  });
});
