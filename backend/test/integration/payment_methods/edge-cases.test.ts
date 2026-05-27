import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';

/**
 * T056 (Polish) — payment-method edge cases.
 *
 * Other edge cases are covered elsewhere: unknown statusOn* rejected at upsert
 * (admin-routes contract), no-eligible-method storefront state (PaymentMethods
 * SSR test), and stale-selection re-validation at submit (admin-surface-validation).
 * This file pins the `code`-uniqueness guarantee (FR-007).
 */
describe('payment-method edge cases', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('rejects a duplicate code (FR-007 — unique across entries)', async () => {
    const code = `dup_${randomUUID().slice(0, 8)}`;
    const base = {
      name: { default: 'Dup' },
      kind: 'bank_transfer' as const,
      adapter: 'bank_transfer',
      status: 'active' as const,
      statusOnPending: 'new',
      statusOnSuccess: 'confirmed',
      statusOnFailure: 'cancelled',
    };

    const em1 = h.em();
    em1.create(PaymentMethod, { code, ...base });
    await em1.flush();

    const em2 = h.em();
    em2.create(PaymentMethod, { code, ...base });
    await expect(em2.flush()).rejects.toThrow();
  });
});
