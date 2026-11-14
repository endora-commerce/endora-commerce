import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser, Order } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { addOrganizationChannels } from '../../helpers/sales-channel-access.js';

/**
 * Issue #627 (#86) — the slice #621 left: the admin's order-status
 * configuration and the external API order intake answered business-state
 * refusals as `VALIDATION_FAILED` with an English sentence. The envelope never
 * replaces the message of `VALIDATION_FAILED`, so an operator working in Polish
 * read English, and a client could not tell "this status is in use" or "another
 * intake is running" from a malformed request. Each now has its own code, a
 * sentence in English and Polish, and the values that sentence names in
 * `details`.
 *
 * The status code travels as `details.statusCode`, never under `details.code`,
 * which is the envelope's refusal-token slot. The sentences are written out
 * here rather than read from the bundle: a test that loads the file it checks
 * asserts only that JSON parses. The operator is answered in their stored
 * language (D-132); the API key's caller through `Accept-Language`.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

type Language = 'en' | 'pl';

const CODE_TAKEN: Record<Language, (code: string) => string> = {
  en: (code) => `A status with the code ${code} already exists. Choose a different code.`,
  pl: (code) => `Status o kodzie ${code} już istnieje. Wybierz inny kod.`,
};
const MARK_TERMINAL: Record<Language, (code: string, count: number) => string> = {
  en: (code, count) =>
    `Outgoing transitions of the status ${code}: ${count}. Remove them before you mark the status as terminal.`,
  pl: (code, count) =>
    `Przejścia wychodzące ze statusu ${code}: ${count}. Usuń je, zanim oznaczysz status jako końcowy.`,
};
const ADD_TRANSITION: Record<Language, (code: string, to: string) => string> = {
  en: (code, to) => `The status ${code} is terminal, so it cannot have a transition to ${to}.`,
  pl: (code, to) => `Status ${code} jest końcowy, więc nie może mieć przejścia do ${to}.`,
};
const NOT_DELETABLE_INITIAL: Record<Language, (code: string) => string> = {
  en: (code) => `The status ${code} is the initial status, so it cannot be deleted.`,
  pl: (code) => `Status ${code} jest statusem początkowym, więc nie można go usunąć.`,
};
const NOT_DELETABLE_SYSTEM: Record<Language, (code: string) => string> = {
  en: (code) => `The status ${code} is a system status, so it cannot be deleted.`,
  pl: (code) => `Status ${code} jest statusem systemowym, więc nie można go usunąć.`,
};
const IN_USE: Record<Language, (code: string, count: number) => string> = {
  en: (code, count) => `Orders in the status ${code}: ${count}. Move them to another status before you delete it.`,
  pl: (code, count) => `Zamówienia w statusie ${code}: ${count}. Przenieś je do innego statusu, zanim go usuniesz.`,
};
const LINES_REFUSED: Record<Language, string> = {
  en: 'One or more order lines were refused, so the order was not placed. The reason for each line is in the error details.',
  pl: 'Co najmniej jedna pozycja zamówienia została odrzucona, więc zamówienie nie zostało złożone. Powód dla każdej pozycji podano w szczegółach błędu.',
};
const INTAKE_BUSY: Record<Language, string> = {
  en: 'Another order intake for this API key is in progress. Retry with the same Idempotency-Key.',
  pl: 'Trwa już inne przyjmowanie zamówienia dla tego klucza API. Ponów żądanie z tym samym nagłówkiem Idempotency-Key.',
};

describe('orders status-graph and intake refusals carry their own code and sentence (issue #627)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  const admin = { b2b_session: 'stub-admin-session' };
  /** Only the rows this file creates are removed — never a table-wide wipe. */
  const created = { statuses: [] as string[], orders: [] as string[] };
  const unique = () => randomUUID().replace(/-/g, '').slice(0, 10);

  beforeAll(async () => {
    h = await setupBackendServer();
    languageBefore =
      (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await setAdminLanguage(languageBefore);
      const connection = h.em().getConnection();
      if (created.orders.length > 0) {
        await connection.execute(`delete from "orders" where "id" = any(?::uuid[])`, [`{${created.orders.join(',')}}`]);
      }
      if (created.statuses.length > 0) {
        const codes = `{${created.statuses.join(',')}}`;
        await connection.execute(
          `delete from "order_status_transitions" where "from_status_code" = any(?::text[]) or "to_status_code" = any(?::text[])`,
          [codes, codes],
        );
        await connection.execute(`delete from "order_statuses" where "code" = any(?::text[])`, [codes]);
      }
    }
    await teardownBackendServer(h);
  });

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const user = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    user.preferredLanguage = value;
    await em.flush();
  }

  const adminCall = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
    h.app.inject({ method, url, cookies: admin, ...(payload ? { payload } : {}) });

  async function createStatus(isTerminal = false): Promise<string> {
    const code = `i627_${unique()}`;
    const response = await adminCall('POST', '/api/v1/admin/orders/statuses', {
      code,
      name: { en: 'Issue 627' },
      defaultName: 'Issue 627',
      isTerminal,
    });
    expect(response.statusCode, response.body).toBe(201);
    created.statuses.push(code);
    return code;
  }

  function refusal(response: { statusCode: number; body: string }, status: number, code: string): ErrorBody['error'] {
    expect(response.statusCode, response.body).toBe(status);
    const error = (JSON.parse(response.body) as ErrorBody).error;
    expect(error.code).toBe(code);
    return error;
  }

  function expectTranslated(error: ErrorBody['error'], language: Language, sentence: Record<Language, string>): void {
    expect(error.message).toBe(sentence[language]);
    if (language === 'pl') expect(error.message).not.toBe(sentence.en);
  }

  const both = <T extends unknown[]>(sentence: Record<Language, (...args: T) => string>, ...args: T) => ({
    en: sentence.en(...args),
    pl: sentence.pl(...args),
  });

  describe.each(['en', 'pl'] as const)('for an operator working in %s', (language) => {
    beforeAll(async () => {
      await setAdminLanguage(language);
    });

    it('ORDER_STATUS_CODE_TAKEN when a status code exists', async () => {
      const code = await createStatus();

      const error = refusal(
        await adminCall('POST', '/api/v1/admin/orders/statuses', { code, name: { en: 'Again' }, defaultName: 'Again' }),
        409,
        'ORDER_STATUS_CODE_TAKEN',
      );

      expect(error.details).toEqual({ statusCode: code });
      expectTranslated(error, language, both(CODE_TAKEN, code));
    });

    it('ORDER_STATUS_TERMINAL_HAS_TRANSITIONS (mark_terminal) when a status with outgoing transitions is marked terminal', async () => {
      // A non-terminal status gets the universal on_hold / cancelled edges.
      const code = await createStatus();
      const outgoing = (await h
        .em()
        .getConnection()
        .execute(`select count(*)::int as "n" from "order_status_transitions" where "from_status_code" = ?`, [code])) as Array<{
        n: number;
      }>;
      const outgoingCount = outgoing[0]!.n;
      expect(outgoingCount).toBeGreaterThan(0);

      const error = refusal(
        await adminCall('PATCH', `/api/v1/admin/orders/statuses/${code}`, { isTerminal: true }),
        409,
        'ORDER_STATUS_TERMINAL_HAS_TRANSITIONS',
      );

      expect(error.details).toEqual({ code: 'mark_terminal', statusCode: code, outgoingCount });
      expectTranslated(error, language, both(MARK_TERMINAL, code, outgoingCount));
    });

    it('ORDER_STATUS_TERMINAL_HAS_TRANSITIONS (add_transition) when a transition leaves a terminal status', async () => {
      const terminal = await createStatus(true);
      const target = await createStatus();

      const error = refusal(
        await adminCall('PUT', '/api/v1/admin/orders/transitions', {
          add: [{ fromStatusCode: terminal, toStatusCode: target }],
        }),
        422,
        'ORDER_STATUS_TERMINAL_HAS_TRANSITIONS',
      );

      expect(error.details).toEqual({ code: 'add_transition', statusCode: terminal, toStatusCode: target });
      expectTranslated(error, language, both(ADD_TRANSITION, terminal, target));
    });

    it('ORDER_STATUS_NOT_DELETABLE (initial) when the initial status is deleted', async () => {
      const error = refusal(await adminCall('DELETE', '/api/v1/admin/orders/statuses/new'), 409, 'ORDER_STATUS_NOT_DELETABLE');

      expect(error.details).toEqual({ code: 'initial', statusCode: 'new' });
      expectTranslated(error, language, both(NOT_DELETABLE_INITIAL, 'new'));
    });

    it('ORDER_STATUS_NOT_DELETABLE (system) when a system status is deleted', async () => {
      const error = refusal(
        await adminCall('DELETE', '/api/v1/admin/orders/statuses/cancelled'),
        409,
        'ORDER_STATUS_NOT_DELETABLE',
      );

      expect(error.details).toEqual({ code: 'system', statusCode: 'cancelled' });
      expectTranslated(error, language, both(NOT_DELETABLE_SYSTEM, 'cancelled'));
    });

    it('ORDER_STATUS_IN_USE when orders are in the status', async () => {
      const code = await createStatus();
      const em = h.em().fork();
      const address = { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' };
      const order = em.create(Order, {
        organizationId: randomUUID(),
        placedByCustomerAccountId: randomUUID(),
        salesChannelId: randomUUID(),
        status: code,
        deliveryAddress: address,
        billingAddress: address,
        deliveryMethodId: randomUUID(),
        deliveryMethodSnapshot: { code: 'd', name: 'd', cost: 0 },
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        paymentMethodSnapshot: { code: 'p', name: 'p', kind: 'bank_transfer' },
        subtotal: '10.00',
        taxTotal: '2.30',
        deliveryTotal: '0.00',
        total: '12.30',
        currency: 'PLN',
        placedAt: new Date(),
      });
      await em.persistAndFlush(order);
      created.orders.push(order.id);

      const error = refusal(await adminCall('DELETE', `/api/v1/admin/orders/statuses/${code}`), 409, 'ORDER_STATUS_IN_USE');

      expect(error.details).toEqual({ statusCode: code, orderCount: 1 });
      expectTranslated(error, language, both(IN_USE, code, 1));
    });
  });

  describe('the external API order intake', () => {
    let token: string;
    let apiKeyId: string;

    beforeAll(async () => {
      const em = h.em().fork();
      const channelCode = `ext-i627-${unique()}`;
      const channel = em.create(SalesChannel, {
        code: channelCode,
        name: { 'en-US': 'Issue 627 channel' },
        languages: ['en-US'],
        defaultLanguage: 'en-US',
        currencies: ['PLN'],
        defaultCurrency: 'PLN',
        active: true,
      });
      await em.persistAndFlush(channel);
      await h.salesChannels.cache.invalidate(channelCode);
      await addOrganizationChannels(h, TEST_ORGANIZATION_ID, [channelCode]);
      await em
        .getConnection()
        .execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?,?)`, [
          channel.id,
          SEED_PRODUCT_101_ID,
        ]);
      const key = await adminCall('POST', '/api/v1/admin/api-keys', {
        name: 'Issue 627 key',
        scopes: ['orders:read', 'orders:write'],
        binding: { organizationId: TEST_ORGANIZATION_ID, salesChannelId: channel.id, customerAccountId: TEST_CUSTOMER_ID },
      });
      expect(key.statusCode, key.body).toBe(201);
      const data = (key.json() as { data: { apiKey: { id: string }; bearerToken: string } }).data;
      token = data.bearerToken;
      apiKeyId = data.apiKey.id;
    });

    afterAll(async () => {
      await h.redis.del(`b2b:orders:api-intake:${apiKeyId}`);
    });

    const place = (lines: Array<{ sku: string; quantity: number }>, language: Language) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/external/orders',
        payload: {
          lines,
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
          deliveryAddressId: SEED_ADDRESS_DELIVERY_ID,
          billingAddressId: SEED_ADDRESS_BILLING_ID,
        },
        headers: {
          authorization: `Bearer ${token}`,
          'idempotency-key': `i627-${randomUUID()}`,
          'accept-language': language,
        },
      });

    it.each(['en', 'pl'] as const)('ORDER_INTAKE_LINES_REFUSED keeps the per-line array (%s)', async (language) => {
      const error = refusal(
        await place(
          [
            { sku: 'EXAMPLE-SIMPLE-001', quantity: 1 },
            { sku: 'NO-SUCH-SKU-627', quantity: 2 },
          ],
          language,
        ),
        422,
        'ORDER_INTAKE_LINES_REFUSED',
      );

      // The array is the machine's answer and stays exactly as it was.
      expect(error.details).toEqual([{ path: 'lines.1.sku', issue: 'SKU_NOT_IN_ASSORTMENT', sku: 'NO-SUCH-SKU-627' }]);
      expectTranslated(error, language, LINES_REFUSED);
    });

    it.each(['en', 'pl'] as const)('ORDER_INTAKE_BUSY while another intake holds the lock (%s)', async (language) => {
      const lockKey = `b2b:orders:api-intake:${apiKeyId}`;
      await h.redis.set(lockKey, 'held-by-another-intake', 'PX', 30_000);
      try {
        const error = refusal(await place([{ sku: 'EXAMPLE-SIMPLE-001', quantity: 1 }], language), 409, 'ORDER_INTAKE_BUSY');

        // One code, one reason: the `intake_busy` token is gone.
        expect(error.details).toBeUndefined();
        expectTranslated(error, language, INTAKE_BUSY);
      } finally {
        await h.redis.del(lockKey);
      }
    });
  });

  it('routes the six codes to orders, the module that raises them', () => {
    for (const code of [
      'ORDER_STATUS_CODE_TAKEN',
      'ORDER_STATUS_TERMINAL_HAS_TRANSITIONS',
      'ORDER_STATUS_NOT_DELETABLE',
      'ORDER_STATUS_IN_USE',
      'ORDER_INTAKE_LINES_REFUSED',
      'ORDER_INTAKE_BUSY',
    ]) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('orders');
    }
  });
});
