import { Invoice } from '../../helpers/package-entities.js';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';

import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';


import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { Payment } from '../../helpers/package-entities.js';


/**
 * Feature 062 / T022 (SC-004) — a key-placed order is a first-class Order:
 * identical status graph entry point, confirmation e-mail, payment + invoice
 * rows, `order.created.v1` domain event, and an audit row attributing the
 * api-key placement. FR-011: the same `placeOrder` pipeline runs — nothing is
 * synthesized on the external surface.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('external order intake — storefront order parity (062 / SC-004)', () => {
  let h: BackendServerHandle;
  let token: string;
  const mailer = new InMemoryMailer();

  beforeAll(async () => {
    // The InMemoryMailer backs BOTH the legacy commerce mailer and the
    // transactional-emails sender, so the confirmation is observable on
    // whichever path the harness resolves (feature 047 sender when wired).
    h = await setupBackendServer({ commerceMailer: mailer, organizationsMailer: mailer });
    const em = h.em();
    const channel = em.create(SalesChannel, {
      code: 'ext-parity',
      name: { 'en-US': 'Parity channel' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      isPublic: true,
    });
    await em.persistAndFlush(channel);
    await h.salesChannels.cache.invalidate('ext-parity');
    await em.getConnection().execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?,?)`,
      [channel.id, SEED_PRODUCT_101_ID],
    );

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload: {
        name: 'Parity key',
        scopes: ['orders:read', 'orders:write'],
        binding: {
          organizationId: TEST_ORGANIZATION_ID,
          salesChannelId: channel.id,
          customerAccountId: TEST_CUSTOMER_ID,
        },
      },
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(201);
    token = (res.json() as { data: { bearerToken: string } }).data.bearerToken;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('runs the full storefront lifecycle: event, status, payment, invoice, email, audit', async () => {
    const created: Array<{ orderId: string; organizationId: string }> = [];
    const off = h.eventBus.on('order.created.v1', (payload) => {
      created.push(payload as unknown as { orderId: string; organizationId: string });
    });

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/external/orders',
      payload: {
        lines: [{ sku: 'EXAMPLE-SIMPLE-001', quantity: 2 }],
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
        billingAddressId: SEED_ADDRESS_BILLING_ID,
      },
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': `parity-${randomUUID()}`,
      },
    });
    expect(res.statusCode).toBe(201);
    const order = (res.json() as {
      data: {
        id: string;
        status: string;
        paymentStatus: string;
        nextAction: { kind: string };
        total: number;
      };
    }).data;

    // Status graph entry point — same initial status as a storefront order.
    expect(order.status).toBe('new');
    expect(order.paymentStatus).toBe('awaiting_payment');
    // Bank-transfer adapter next-action, exactly like the customer contract.
    expect(order.nextAction.kind).toBe('awaiting_transfer');

    // Domain event (post-commit, in-process bus).
    await expect
      .poll(() => created.some((e) => e.orderId === order.id), { timeout: 2000 })
      .toBe(true);
    const event = created.find((e) => e.orderId === order.id)!;
    expect(event.organizationId).toBe(TEST_ORGANIZATION_ID);
    off();

    // Payment + proforma invoice rows, as in the storefront pipeline.
    const em = h.em();
    const payment = await em.findOne(Payment, { orderId: order.id });
    expect(payment).not.toBeNull();
    const invoice = await em.findOne(Invoice, { orderId: order.id });
    expect(invoice).not.toBeNull();

    // Confirmation e-mail follows the standard flow.
    expect(
      mailer.sent.some((m) => m.meta?.['kind'] === 'order_confirmation'),
    ).toBe(true);

    // Audit attribution of the api-key placement.
    const audit = await em.find(AuditLogEntry, {
      action: 'order.place_via_api_key',
      objectId: order.id,
    });
    expect(audit).toHaveLength(1);
  });
});
