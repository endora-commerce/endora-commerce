import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import {
  DeliveryMethod,
  Shipment,
  type DeliveryMethodRow,
} from '../../helpers/package-entities.js';
import { AdminUser, Order } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';

/**
 * Feature 075, the `delivery_methods` shard — the FR-003 delete guard, through
 * the composed HTTP surface, once the count comes from the module that owns the
 * rows.
 *
 * The guard was a `select count(*) from "shipments"` written inside this
 * module's own delete Command: a read of another module's table that names no
 * import specifier, so it compiled and returned rows with nothing declaring the
 * edge. It is `shipmentUsagePort` now, and this file is the off-state test the
 * `nonBindingDependencies` entry owes — the third case, which no unit test can
 * reach and which is the whole reason the degrade is a refusal:
 *
 *  1. a method a shipment references cannot be deleted;
 *  2. a method nothing references can;
 *  3. **with `shipments` switched off, neither can** — because nobody can count,
 *     `shipments.delivery_method_id` carries no foreign key, and a delete taken
 *     blind orphans history that comes back the moment the module does.
 *
 * The operator axis is the one driven: it is the case an operator actually
 * creates, and it is the one where the platform still holds every shipment row
 * the guard is protecting.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/**
 * Issue #632 (#86) — each refusal has a code of its own and a sentence in both
 * languages, written out here rather than read from the bundle: a test that
 * loads the file it checks asserts only that JSON parses. The operator is
 * answered in their stored language (D-132), so the cases set it.
 */
const IN_USE_DELETE = {
  en: (code: string) =>
    `Delivery method "${code}" cannot be deleted: 1 shipment(s) reference it. Set its status to "inactive" instead.`,
  pl: (code: string) =>
    `Nie można usunąć metody dostawy „${code}”: odwołują się do niej przesyłki (liczba: 1). Zamiast tego ustaw jej status na „nieaktywna”.`,
};
const IN_USE_CHANGE_ADAPTER = {
  en: (code: string) =>
    `The adapter of delivery method "${code}" cannot be changed: 1 shipment(s) were created against it through "flat_rate". Set its status to "inactive" and create a new method for the other adapter instead.`,
  pl: (code: string) =>
    `Nie można zmienić adaptera metody dostawy „${code}”: utworzono dla niej przesyłki przez adapter „flat_rate” (liczba: 1). Ustaw jej status na „nieaktywna” i utwórz nową metodę dla innego adaptera.`,
};
const USAGE_UNKNOWN_DELETE = {
  en: 'This delivery method cannot be deleted: the "shipments" module is switched off, so the platform cannot tell whether any shipment was created against it. Switch the module on and try again, or set the method\'s status to "inactive".',
  pl: 'Nie można usunąć tej metody dostawy: moduł „shipments” jest wyłączony, więc platforma nie może ustalić, czy utworzono dla niej jakąkolwiek przesyłkę. Włącz ten moduł i spróbuj ponownie albo ustaw status metody na „nieaktywna”.',
};
const USAGE_UNKNOWN_CHANGE_ADAPTER = {
  en: 'The adapter of this delivery method cannot be changed: the "shipments" module is switched off, so the platform cannot tell whether any shipment was created against it. Switch the module on and try again, or create a new method for the other adapter.',
  pl: 'Nie można zmienić adaptera tej metody dostawy: moduł „shipments” jest wyłączony, więc platforma nie może ustalić, czy utworzono dla niej jakąkolwiek przesyłkę. Włącz ten moduł i spróbuj ponownie albo utwórz nową metodę dla innego adaptera.',
};

describe('delivery-method delete guard — the count comes from `shipments`', () => {
  let h: BackendServerHandle;

  let languageBefore: string | null = null;

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore =
      (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
  }, 60_000);

  afterAll(async () => {
    if (h) await setAdminLanguage(languageBefore);
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = value;
    await em.flush();
  }

  function refusal(
    response: { statusCode: number; body: string; json: () => unknown },
    code: string,
  ) {
    expect(response.statusCode, response.body).toBe(409);
    const error = (response.json() as ErrorBody).error;
    expect(error.code).toBe(code);
    return error;
  }

  function deleteMethod(method: DeliveryMethodRow) {
    return h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/delivery-methods/${method.id}`,
      cookies: ADMIN_COOKIE,
    });
  }

  async function seedMethod(): Promise<DeliveryMethodRow> {
    const em = h.em();
    const method = em.create(DeliveryMethod, {
      code: `guard_${randomUUID().slice(0, 8)}`,
      name: { default: 'Guarded method' },
      adapter: 'flat_rate',
      cost: '9.00',
      currency: 'PLN',
      status: 'active',
      statusOnSuccess: 'shipment_sent',
      statusOnFailure: 'processing',
    });
    await em.persistAndFlush(method);
    return method;
  }

  async function methodStillThere(id: string): Promise<boolean> {
    return (await h.em().findOne(DeliveryMethod, { id })) !== null;
  }

  /** `shipments.order_id` is a real foreign key, so the row needs a real order. */
  async function seedShipment(method: DeliveryMethodRow): Promise<void> {
    const em = h.em();
    const order = em.create(Order, {
      organizationId: randomUUID(),
      placedByCustomerAccountId: randomUUID(),
      salesChannelId: randomUUID(),
      deliveryAddress: {
        recipientName: 'A',
        street: 'S',
        city: 'C',
        postalCode: '00-000',
        country: 'PL',
      },
      billingAddress: {
        recipientName: 'A',
        street: 'S',
        city: 'C',
        postalCode: '00-000',
        country: 'PL',
      },
      deliveryMethodId: method.id,
      deliveryMethodSnapshot: { code: method.code, name: 'Guarded method', cost: 9 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'bt', name: 'BT', kind: 'bank_transfer' },
      status: 'paid',
      subtotal: '100.00',
      taxTotal: '23.00',
      deliveryTotal: '9.00',
      total: '132.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    await em.persistAndFlush(
      em.create(Shipment, { orderId: order.id, deliveryMethodId: method.id }),
    );
  }

  it.each(['en', 'pl'] as const)(
    'refuses the delete while a shipment references the method, and names the count (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const method = await seedMethod();
      await seedShipment(method);

      const error = refusal(await deleteMethod(method), 'DELIVERY_METHOD_IN_USE');

      expect(error.details).toEqual({
        code: 'delete',
        deliveryMethodId: method.id,
        deliveryMethodCode: method.code,
        shipmentCount: 1,
      });
      expect(error.message).toBe(IN_USE_DELETE[language](method.code));
      if (language === 'pl') expect(error.message).not.toBe(IN_USE_DELETE.en(method.code));
      expect(await methodStillThere(method.id)).toBe(true);
    },
  );

  it('deletes a method no shipment references', async () => {
    const method = await seedMethod();

    const response = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/delivery-methods/${method.id}`,
      cookies: ADMIN_COOKIE,
    });

    expect(response.statusCode).toBe(204);
    expect(await methodStillThere(method.id)).toBe(false);
  });

  it.each(['en', 'pl'] as const)(
    'refuses the delete while `shipments` is off, and allows it again once restored (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const method = await seedMethod();

      await withModuleOff('shipments', 'deactivated', async () => {
        // Refused by this module's own decision, taken before the port is
        // resolved — not a `MODULE_DISABLED` envelope a caught gate produced.
        const error = refusal(await deleteMethod(method), 'DELIVERY_METHOD_USAGE_UNKNOWN');
        expect(error.details).toEqual({
          code: 'delete',
          deliveryMethodId: method.id,
          module: 'shipments',
        });
        expect(error.message).toBe(USAGE_UNKNOWN_DELETE[language]);
        if (language === 'pl') expect(error.message).not.toBe(USAGE_UNKNOWN_DELETE.en);
        expect(await methodStillThere(method.id)).toBe(true);
      });

      // The restoration half: the method was never touched while the module was
      // off, so the delete that was refused now succeeds unchanged.
      const restored = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/delivery-methods/${method.id}`,
        cookies: ADMIN_COOKIE,
      });
      expect(restored.statusCode).toBe(204);
      expect(await methodStillThere(method.id)).toBe(false);
    },
  );

  /**
   * The same count guards a second write since the admin screen offers the
   * adapter as a choice: a `Shipment` records its method and not the adapter
   * that opened it, so rebinding a method hands the parcels already created
   * against it to another carrier.
   */
  function rebind(method: DeliveryMethodRow, adapter: string) {
    return h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/delivery-methods/${method.code}`,
      cookies: ADMIN_COOKIE,
      payload: { name: { default: 'Guarded method' }, cost: 11, currency: 'PLN', adapter },
    });
  }

  async function adapterOf(id: string): Promise<string | undefined> {
    const em = h.em();
    em.clear();
    return (await em.findOne(DeliveryMethod, { id }))?.adapter;
  }

  it.each(['en', 'pl'] as const)(
    'refuses a change of adapter while a shipment references the method (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const method = await seedMethod();
      await seedShipment(method);

      const error = refusal(await rebind(method, 'manual_courier'), 'DELIVERY_METHOD_IN_USE');

      expect(error.details).toEqual({
        code: 'change_adapter',
        deliveryMethodId: method.id,
        deliveryMethodCode: method.code,
        adapter: 'flat_rate',
        shipmentCount: 1,
      });
      expect(error.message).toBe(IN_USE_CHANGE_ADAPTER[language](method.code));
      if (language === 'pl') expect(error.message).not.toBe(IN_USE_CHANGE_ADAPTER.en(method.code));
      expect(await adapterOf(method.id)).toBe('flat_rate');
    },
  );

  it('still saves an edit that repeats the adapter of a method with shipments', async () => {
    const method = await seedMethod();
    await seedShipment(method);

    const response = await rebind(method, 'flat_rate');

    expect(response.statusCode).toBe(200);
    expect(response.json().data.cost.amount).toBe(11);
  });

  it('changes the adapter of a method no shipment references', async () => {
    const method = await seedMethod();

    const response = await rebind(method, 'manual_courier');

    expect(response.statusCode).toBe(200);
    expect(await adapterOf(method.id)).toBe('manual_courier');
  });

  it.each(['en', 'pl'] as const)(
    'refuses a change of adapter while `shipments` is off, and allows it once restored (%s)',
    async (language) => {
      await setAdminLanguage(language);
      const method = await seedMethod();

      await withModuleOff('shipments', 'deactivated', async () => {
        const error = refusal(
          await rebind(method, 'manual_courier'),
          'DELIVERY_METHOD_USAGE_UNKNOWN',
        );
        expect(error.details).toEqual({
          code: 'change_adapter',
          deliveryMethodId: method.id,
          module: 'shipments',
        });
        expect(error.message).toBe(USAGE_UNKNOWN_CHANGE_ADAPTER[language]);
        if (language === 'pl') expect(error.message).not.toBe(USAGE_UNKNOWN_CHANGE_ADAPTER.en);
        expect(await adapterOf(method.id)).toBe('flat_rate');

        // An edit that changes nothing about the adapter asks nobody, so it is
        // not held hostage by a module it never needed.
        const unchanged = await rebind(method, 'flat_rate');
        expect(unchanged.statusCode).toBe(200);
      });

      const restored = await rebind(method, 'manual_courier');
      expect(restored.statusCode).toBe(200);
      expect(await adapterOf(method.id)).toBe('manual_courier');
    },
  );

  it('routes both codes to delivery_methods, the module that raises them', () => {
    for (const code of ['DELIVERY_METHOD_IN_USE', 'DELIVERY_METHOD_USAGE_UNKNOWN']) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('delivery_methods');
    }
  });
});
