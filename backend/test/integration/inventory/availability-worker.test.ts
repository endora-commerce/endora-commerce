import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { CatalogProductReadPort, CustomerAccountReadPort } from '@endora-commerce/contracts';
import { AvailabilityWorker } from '../../../src/modules/inventory/services/availability-worker.js';
import { AvailabilityNotification } from '../../../src/modules/inventory/entities/availability-notification.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';

/**
 * The container's own registrations — feature 075, Phase C. The worker takes
 * `catalog`'s and `customer_accounts`' published read ports instead of loading
 * their entities, so a hand-built worker here resolves the same gates the
 * composed module does rather than becoming a second reader of the same rows.
 */
function ports(handle: BackendServerHandle): {
  catalogProducts: CatalogProductReadPort;
  customerAccounts: CustomerAccountReadPort;
} {
  const cradle = handle.container.cradle as never as {
    catalogProductReadPort: CatalogProductReadPort;
    customerAccountReadPort: CustomerAccountReadPort;
  };
  return {
    catalogProducts: cradle.catalogProductReadPort,
    customerAccounts: cradle.customerAccountReadPort,
  };
}

/**
 * T136 / FR-061 — availability worker fans out a back-in-stock email to
 * every subscriber on a (product, variant) pair, marks the notification
 * consumed, and skips already-notified rows on a second run.
 */

describe('AvailabilityWorker.dispatchForStockIncrease', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;
  let worker: AvailabilityWorker;
  let product: Product;
  let customer: CustomerAccount;

  beforeAll(async () => {
    h = await setupBackendServer();
    product = await h.em().findOneOrFail(Product, { sku: 'EXAMPLE-SIMPLE-001' });
    customer = await h.em().findOneOrFail(CustomerAccount, { role: 'organization_admin' });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    mailer = new InMemoryMailer();
    const { catalogProducts, customerAccounts } = ports(h);
    worker = new AvailabilityWorker(h.em, mailer, catalogProducts, customerAccounts);
    await h
      .em()
      .getConnection()
      .execute('truncate table availability_notifications cascade');
  });

  it('returns notified=0 when there are no subscriptions', async () => {
    const result = await worker.dispatchForStockIncrease({ productId: product.id });
    expect(result).toEqual({ notified: 0 });
    expect(mailer.sent).toHaveLength(0);
  });

  it('emails every subscriber and marks the notification consumed', async () => {
    const em = h.em();
    em.create(AvailabilityNotification, {
      customerAccountId: customer.id,
      productId: product.id,
      variantId: null,
    });
    em.create(AvailabilityNotification, {
      customerAccountId: customer.id, // same customer subscribes twice (idempotent)
      productId: product.id,
      variantId: null,
    });
    await em.flush();

    const result = await worker.dispatchForStockIncrease({ productId: product.id });
    expect(result.notified).toBe(2);
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[0]?.to).toBe(customer.email);
    expect(mailer.sent[0]?.subject).toMatch(/back in stock/i);

    const remaining = await h.em().find(AvailabilityNotification, {
      productId: product.id,
      notifiedAt: null,
    });
    expect(remaining).toHaveLength(0);
  });

  it('skips already-consumed notifications on a second run', async () => {
    const em = h.em();
    em.create(AvailabilityNotification, {
      customerAccountId: customer.id,
      productId: product.id,
    });
    await em.flush();

    await worker.dispatchForStockIncrease({ productId: product.id });
    expect(mailer.sent).toHaveLength(1);

    const second = await worker.dispatchForStockIncrease({ productId: product.id });
    expect(second.notified).toBe(0);
    // No new mail dispatched on the second run.
    expect(mailer.sent).toHaveLength(1);
  });

  it('scopes to a specific variant when variantId is supplied', async () => {
    const em = h.em();
    const variantId = '99999999-9999-4999-8999-999999999999';
    em.create(AvailabilityNotification, {
      customerAccountId: customer.id,
      productId: product.id,
    });
    em.create(AvailabilityNotification, {
      customerAccountId: customer.id,
      productId: product.id,
      variantId,
    });
    await em.flush();

    const result = await worker.dispatchForStockIncrease({
      productId: product.id,
      variantId,
    });
    expect(result.notified).toBe(1);
    expect(mailer.sent).toHaveLength(1);
    const remaining = await h
      .em()
      .find(AvailabilityNotification, { productId: product.id, notifiedAt: null });
    // The non-variant subscription is untouched.
    expect(remaining).toHaveLength(1);
    // MikroORM's forceUndefined coerces NULL → undefined on read.
    expect(remaining[0]?.variantId ?? null).toBeNull();
  });
});
