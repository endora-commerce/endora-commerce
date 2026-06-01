import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { DeliveryMethodReconciler } from '../../../src/modules/delivery_methods/services/delivery-method-reconciler.js';
import { DeliveryMethod } from '../../../src/modules/delivery_methods/entities/delivery-method.entity.js';

/**
 * T013/T016 (US1) — the reconciler auto-creates a configurable delivery_methods
 * row for a registered shipping adapter, seeding statusOn* and leaving an
 * existing row's admin configuration untouched (FR-002).
 */
describe('DeliveryMethodReconciler.ensureMethodForAdapter', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates a row with seed status mappings when none exists', async () => {
    const reconciler = new DeliveryMethodReconciler(h.em);
    const code = `recon_ship_${Date.now()}`;

    const row = await reconciler.ensureMethodForAdapter('my_carrier', {
      code,
      name: { default: 'Reconciled Shipping' },
    });

    expect(row.adapter).toBe('my_carrier');
    expect(row.statusOnSuccess).toBe('shipment_sent');
    expect(row.statusOnFailure).toBe('processing');

    const persisted = await h.em().findOne(DeliveryMethod, { code });
    expect(persisted?.adapter).toBe('my_carrier');
  });

  it('is idempotent and does not clobber existing configuration', async () => {
    const reconciler = new DeliveryMethodReconciler(h.em);
    const code = `recon_ship_idem_${Date.now()}`;

    const first = await reconciler.ensureMethodForAdapter('idem_carrier', {
      code,
      name: { default: 'Idem' },
    });
    const em = h.em();
    const row = await em.findOne(DeliveryMethod, { id: first.id });
    row!.statusOnSuccess = 'completed';
    await em.persistAndFlush(row!);

    const second = await reconciler.ensureMethodForAdapter('idem_carrier', {
      code,
      name: { default: 'Idem' },
    });

    expect(second.id).toBe(first.id);
    expect(second.statusOnSuccess).toBe('completed'); // admin edit preserved
  });
});
