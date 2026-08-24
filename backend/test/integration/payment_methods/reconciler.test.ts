import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PaymentMethodReconciler } from '../../../../packages/modules/payment_methods/src/backend/services/payment-method-reconciler.js';
import { PaymentMethod } from '../../helpers/package-entities.js';

/**
 * T013 (US1) — the reconciler auto-creates a configurable payment_methods row
 * for a registered adapter, seeding statusOn* and leaving an existing row's
 * admin configuration untouched (FR-002).
 */
describe('PaymentMethodReconciler.ensureMethodForAdapter', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('creates a row with seed status mappings when none exists', async () => {
    const reconciler = new PaymentMethodReconciler(h.em);
    const code = `recon_${Date.now()}`;

    const row = await reconciler.ensureMethodForAdapter('my_adapter', {
      code,
      type: 'gateway',
      name: { default: 'Reconciled Method' },
    });

    expect(row.adapter).toBe('my_adapter');
    expect(row.kind).toBe('gateway');
    expect(row.statusOnPending).toBe('new');
    expect(row.statusOnSuccess).toBe('paid');
    // Feature 085 (FR-003) — a declined payment holds the order at `on_hold`
    // instead of cancelling it. `cancelled` is terminal, so the seeded default
    // used to make the buyer's most recoverable mistake irreversible.
    expect(row.statusOnFailure).toBe('on_hold');

    const persisted = await h.em().findOne(PaymentMethod, { code });
    expect(persisted?.adapter).toBe('my_adapter');
  });

  it('is idempotent and does not clobber existing configuration', async () => {
    const reconciler = new PaymentMethodReconciler(h.em);
    const code = `recon_idem_${Date.now()}`;

    const first = await reconciler.ensureMethodForAdapter('idem_adapter', {
      code,
      type: 'bank_transfer',
      name: { default: 'Idem' },
    });
    // Simulate an admin edit.
    const em = h.em();
    const row = await em.findOne(PaymentMethod, { id: first.id });
    row!.statusOnSuccess = 'completed';
    await em.persistAndFlush(row!);

    const second = await reconciler.ensureMethodForAdapter('idem_adapter', {
      code,
      type: 'bank_transfer',
      name: { default: 'Idem' },
    });

    expect(second.id).toBe(first.id);
    expect(second.statusOnSuccess).toBe('completed'); // admin edit preserved
  });
});
