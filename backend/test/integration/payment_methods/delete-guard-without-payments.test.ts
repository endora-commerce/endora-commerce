import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';

/**
 * The degradation `payment_methods` declares for `paymentReadPort` (feature
 * 075, Constitution XVII checklist item 6).
 *
 * `payments` is deactivatable and this module does not declare it in
 * `dependencies` — `payments` declares this module, so the reverse would close
 * a cycle, and acknowledging the edge would keep the bind and make
 * `payments.enabled` unusable in every shop that takes money. That leaves the
 * off state reachable, so it has to be answered: the delete-guard has no way to
 * count the attempts pointing at a method, and the delete is refused with a
 * sentence saying so rather than taken on trust.
 *
 * Both axes are driven, because an operator creates the second one: a
 * deactivated `payments` is still installed and wired.
 */
describe('payment-method delete while payments is off [integration]', () => {
  let h: BackendServerHandle;
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function seedMethod(suffix: string): Promise<string> {
    const em = h.em();
    const method = em.create(PaymentMethod, {
      code: `pm075_${suffix}_${Date.now()}`,
      name: { default: 'Guard probe' },
      kind: 'pickup',
      adapter: 'pickup',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'confirmed',
      statusOnFailure: 'cancelled',
    });
    await em.persistAndFlush(method);
    return method.id;
  }

  const del = (id: string): Promise<{ statusCode: number; body: string }> =>
    h.app
      .inject({ method: 'DELETE', url: `/api/v1/admin/payment-methods/${id}`, ...admin })
      .then((res) => ({ statusCode: res.statusCode, body: res.body }));

  for (const axis of ['deactivated', 'platform-unavailable'] as const) {
    it(`refuses the delete while payments is ${axis}, and says why`, async () => {
      const id = await seedMethod(axis.replace('-', '_'));

      const refused = await withModuleOff('payments', axis, () => del(id));

      expect(refused.statusCode).toBe(409);
      expect(refused.body).toMatch(/payments module is switched off/i);
      // The method is still there: a refusal that deleted anyway would be the
      // orphan FR-003 exists to prevent, arriving with a 409 on top of it.
      expect(await h.em().findOne(PaymentMethod, { id })).not.toBeNull();
    });
  }

  it('deletes the same unreferenced method once payments is back', async () => {
    const id = await seedMethod('restored');

    expect((await withModuleOff('payments', 'deactivated', () => del(id))).statusCode).toBe(409);
    expect((await del(id)).statusCode).toBe(204);
  });
});
