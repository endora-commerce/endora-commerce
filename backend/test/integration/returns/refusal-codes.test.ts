import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { returnCaseOrderLockKey } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminUser, Order } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { DECLARED_ERROR_TRANSLATION_TARGETS } from '../../helpers/error-code-targets.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS } from '../../../src/apps/example/modules/payment_gateway_fixture/backend.js';
import {
  DEFAULT_RETURN_STATUSES,
  computeDefaultTransitions,
} from '../../../../packages/modules/returns/src/backend/domain/return-status-graph.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, seedReturnableOrder } from './helpers.js';

/**
 * Issue #625 (#86) — `returns` raised its business-state refusals as
 * `VALIDATION_FAILED`: the buyer's return request, the closed-case refusals,
 * settlement and the admin's return-status configuration. The envelope never
 * replaces the message of `VALIDATION_FAILED`, so the buyer and the operator
 * read the thrower's English whatever language they asked for, and a client
 * could not tell these from a malformed request. Each now has its own code, a
 * sentence in English and Polish, and the values that sentence names in
 * `details`.
 *
 * The status code travels as `details.statusCode`, never under `details.code`,
 * which is the envelope's refusal-token slot. The sentences are written out
 * here rather than read from the bundle: a test that loads the file it checks
 * asserts only that JSON parses. The buyer is answered through
 * `Accept-Language`, the operator in their stored language (D-132).
 *
 * This file never resets the return graph (`resetReturnGraph` empties both
 * tables): it adds whatever default status or edge is missing, and removes
 * only the statuses, edges and reason it created itself.
 */

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

type Language = 'en' | 'pl';
type Sentence = Record<Language, string>;

const ORDER_NOT_ELIGIBLE: Sentence = {
  en: 'This order cannot be returned yet. Returns open once the order is completed.',
  pl: 'Tego zamówienia nie można jeszcze zwrócić. Zwrot będzie możliwy, gdy zamówienie zostanie zrealizowane.',
};
const QUANTITY_EXCEEDS: Record<Language, (requested: number, remaining: number) => string> = {
  en: (requested, remaining) =>
    `You asked to return ${requested}, but only ${remaining} of this line can still be returned.`,
  pl: (requested, remaining) =>
    `Chcesz zwrócić ${requested} szt., ale z tej pozycji można jeszcze zwrócić tylko ${remaining} szt.`,
};
const REASON_INACTIVE: Sentence = {
  en: 'The reason you chose is no longer offered. Choose another reason.',
  pl: 'Wybrany powód nie jest już dostępny. Wybierz inny powód.',
};
const COMMENTS_CLOSED: Sentence = {
  en: 'This case is finished, so comments are closed.',
  pl: 'To zgłoszenie jest zakończone, więc nie można już dodawać komentarzy.',
};
const CASE_CLOSED: Sentence = {
  en: 'This case is finished, so it can no longer be changed.',
  pl: 'To zgłoszenie jest zakończone, więc nie można go już zmienić.',
};
const DELIVERY_METHOD_UNAVAILABLE: Sentence = {
  en: 'This return delivery method is not available. Choose another one.',
  pl: 'Ta metoda dostawy zwrotu nie jest dostępna. Wybierz inną.',
};
const SETTLEMENT_IN_PROGRESS: Sentence = {
  en: 'Another return of this order is being settled. Try again in a moment.',
  pl: 'Trwa rozliczanie innego zwrotu z tego zamówienia. Spróbuj ponownie za chwilę.',
};
const REFUND_EXCEEDS_PAID: Record<Language, (requested: string, maximum: string, currency: string) => string> = {
  en: (requested, maximum, currency) =>
    `The refund of ${requested} ${currency} for this line is more than the ${maximum} ${currency} that can be refunded.`,
  pl: (requested, maximum, currency) =>
    `Zwrot ${requested} ${currency} za tę pozycję przekracza kwotę ${maximum} ${currency}, którą można zwrócić.`,
};
const GATEWAY_FAILED: Sentence = {
  en: 'The payment gateway refused the refund, so nothing was settled. Try again, or settle the return another way.',
  pl: 'Bramka płatności odrzuciła zwrot pieniędzy, więc nic nie zostało rozliczone. Spróbuj ponownie albo rozlicz zwrot w inny sposób.',
};
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
const IN_USE: Record<Language, (code: string, count: number) => string> = {
  en: (code, count) => `Cases in the status ${code}: ${count}. Move them to another status before you delete it.`,
  pl: (code, count) => `Zgłoszenia w statusie ${code}: ${count}. Przenieś je do innego statusu, zanim go usuniesz.`,
};

// File-local literal, as `settle-refund.test.ts`: the fixture gateway is what
// reports a failed provider refund.
const FIXTURE_MODULE = 'payment_gateway_fixture';
const ALL_IDS = [...REGISTERED_MANIFESTS.map((entry) => entry.manifest.id), FIXTURE_MODULE];

describe('returns refusals carry their own code and sentence (issue #625)', () => {
  let h: BackendServerHandle;
  let languageBefore: string | null = null;
  const created = { statuses: [] as string[], reasons: [] as string[] };
  const unique = () => randomUUID().replace(/-/g, '').slice(0, 10);

  beforeAll(async () => {
    h = await setupBackendServer({ deployment: 'example' });
    registryCache.__setEnabledForTesting(ALL_IDS);
    languageBefore =
      (await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID })).preferredLanguage ?? null;
    await ensureDefaultReturnGraph();
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await setAdminLanguage(languageBefore);
      const connection = h.em().getConnection();
      if (created.statuses.length > 0) {
        const codes = `{${created.statuses.join(',')}}`;
        // The one case moved into a status of this file goes back to `new`.
        await connection.execute(`update "return_cases" set "status_code" = 'new' where "status_code" = any(?::text[])`, [codes]);
        await connection.execute(
          `delete from "return_status_transitions" where "from_status_code" = any(?::text[]) or "to_status_code" = any(?::text[])`,
          [codes, codes],
        );
        await connection.execute(`delete from "return_statuses" where "code" = any(?::text[])`, [codes]);
      }
      if (created.reasons.length > 0) {
        await connection.execute(`delete from "return_reasons" where "id" = any(?::uuid[])`, [`{${created.reasons.join(',')}}`]);
      }
    }
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  /** Adds any default status or edge another file's workflow test removed; deletes nothing. */
  async function ensureDefaultReturnGraph(): Promise<void> {
    const connection = h.em().getConnection();
    for (const s of DEFAULT_RETURN_STATUSES) {
      await connection.execute(
        `insert into "return_statuses" ("id", "code", "name", "default_name", "is_initial", "is_terminal", "is_system", "weight", "color", "created_at", "updated_at")
         select ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, now(), now()
         where not exists (select 1 from "return_statuses" where "code" = ?)`,
        [randomUUID(), s.code, JSON.stringify(s.name), s.defaultName, s.isInitial, s.isTerminal, s.isSystem, s.weight, s.color, s.code],
      );
    }
    for (const t of computeDefaultTransitions()) {
      await connection.execute(
        `insert into "return_status_transitions" ("id", "from_status_code", "to_status_code", "is_system", "created_at")
         select ?, ?, ?, ?, now()
         where not exists (select 1 from "return_status_transitions" where "from_status_code" = ? and "to_status_code" = ?)`,
        [randomUUID(), t.fromStatusCode, t.toStatusCode, t.isSystem, t.fromStatusCode, t.toStatusCode],
      );
    }
  }

  async function setAdminLanguage(value: string | null): Promise<void> {
    const em = h.em().fork();
    const user = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    user.preferredLanguage = value;
    await em.flush();
  }

  const buyer = (method: 'POST' | 'GET', url: string, language: Language, payload?: Record<string, unknown>) =>
    h.app.inject({
      method,
      url,
      cookies: CUSTOMER_COOKIE,
      headers: { 'accept-language': language },
      ...(payload ? { payload } : {}),
    });
  const admin = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
    h.app.inject({ method, url, cookies: ADMIN_COOKIE, ...(payload ? { payload } : {}) });

  function refusal(response: { statusCode: number; body: string }, status: number, code: string): ErrorBody['error'] {
    expect(response.statusCode, response.body).toBe(status);
    const error = (JSON.parse(response.body) as ErrorBody).error;
    expect(error.code).toBe(code);
    return error;
  }

  function expectTranslated(error: ErrorBody['error'], language: Language, sentence: Sentence): void {
    expect(error.message).toBe(sentence[language]);
    if (language === 'pl') expect(error.message).not.toBe(sentence.en);
  }

  const both = <T extends unknown[]>(sentence: Record<Language, (...args: T) => string>, ...args: T): Sentence => ({
    en: sentence.en(...args),
    pl: sentence.pl(...args),
  });

  /** A case of the stub buyer, on a completed order whose first line has quantity 3. */
  async function openCase(): Promise<{ id: string; itemId: string; orderId: string }> {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const res = await buyer('POST', '/api/v1/returns', 'en', {
      orderId,
      kind: 'return',
      lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }],
    });
    expect(res.statusCode, res.body).toBe(201);
    const detail = (res.json() as { data: { id: string; items: Array<{ id: string }> } }).data;
    return { id: detail.id, itemId: detail.items[0]!.id, orderId };
  }

  /** A case authorized and received, so it can be settled. */
  async function receivedCase(): Promise<{ id: string; itemId: string; orderId: string }> {
    const rc = await openCase();
    expect((await admin('POST', `/api/v1/admin/returns/${rc.id}/authorize`)).statusCode).toBe(200);
    const received = await admin('POST', `/api/v1/admin/returns/${rc.id}/transition`, { to: 'received' });
    expect(received.statusCode, received.body).toBe(200);
    return rc;
  }

  async function cancelledCase(): Promise<string> {
    const { id } = await openCase();
    const res = await buyer('POST', `/api/v1/returns/${id}/cancel`, 'en');
    expect(res.statusCode, res.body).toBe(200);
    return id;
  }

  async function createStatus(isTerminal = false): Promise<string> {
    const code = `i625_${unique()}`;
    const res = await admin('POST', '/api/v1/admin/returns/statuses', {
      code,
      name: { en: 'Issue 625' },
      defaultName: 'Issue 625',
      isTerminal,
    });
    expect(res.statusCode, res.body).toBe(201);
    created.statuses.push(code);
    return code;
  }

  const settleRefund = (id: string, itemId: string, amount: number) =>
    admin('POST', `/api/v1/admin/returns/${id}/settlement`, {
      resolutionType: 'refund',
      lines: [{ returnCaseItemId: itemId, approvedRefundAmount: amount }],
      refundPaymentMethodId: randomUUID(),
      createCorrectiveInvoice: false,
    });

  describe.each(['en', 'pl'] as const)('for a buyer reading %s', (language) => {
    it('RETURN_ORDER_NOT_ELIGIBLE when the order is not completed yet', async () => {
      const { orderId, itemIds } = await seedReturnableOrder(h.em(), { status: 'new' });
      const reasonId = await anyReasonId(h.em());

      const error = refusal(
        await buyer('POST', '/api/v1/returns', language, {
          orderId,
          kind: 'return',
          lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }],
        }),
        422,
        'RETURN_ORDER_NOT_ELIGIBLE',
      );

      expect(error.details).toEqual({ orderId });
      expectTranslated(error, language, ORDER_NOT_ELIGIBLE);
    });

    it('RETURN_QUANTITY_EXCEEDS_RETURNABLE when more is asked for than is returnable', async () => {
      const { orderId, itemIds } = await seedReturnableOrder(h.em());
      const reasonId = await anyReasonId(h.em());

      const error = refusal(
        await buyer('POST', '/api/v1/returns', language, {
          orderId,
          kind: 'return',
          lines: [{ orderItemId: itemIds[0], quantity: 5, reasonId }],
        }),
        422,
        'RETURN_QUANTITY_EXCEEDS_RETURNABLE',
      );

      expect(error.details).toEqual({ orderItemId: itemIds[0], requested: 5, remaining: 3 });
      expectTranslated(error, language, both(QUANTITY_EXCEEDS, 5, 3));
    });

    it('RETURN_REASON_INACTIVE when the chosen reason was switched off', async () => {
      const reason = await admin('POST', '/api/v1/admin/returns/reasons', {
        label: { en: 'Issue 625 reason' },
        appliesTo: 'both',
        weight: 999,
      });
      expect(reason.statusCode, reason.body).toBe(201);
      const reasonId = (reason.json() as { data: { id: string } }).data.id;
      created.reasons.push(reasonId);
      const off = await admin('PATCH', `/api/v1/admin/returns/reasons/${reasonId}`, { isActive: false });
      expect(off.statusCode, off.body).toBe(200);
      const { orderId, itemIds } = await seedReturnableOrder(h.em());

      const error = refusal(
        await buyer('POST', '/api/v1/returns', language, {
          orderId,
          kind: 'return',
          lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }],
        }),
        422,
        'RETURN_REASON_INACTIVE',
      );

      expect(error.details).toEqual({ reasonId });
      expectTranslated(error, language, REASON_INACTIVE);
    });

    it('an unknown reason stays VALIDATION_FAILED', async () => {
      const { orderId, itemIds } = await seedReturnableOrder(h.em());

      const error = refusal(
        await buyer('POST', '/api/v1/returns', language, {
          orderId,
          kind: 'return',
          lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId: randomUUID() }],
        }),
        422,
        'VALIDATION_FAILED',
      );

      expect(error.details).toEqual({ code: 'unknown_reason' });
    });

    it('RETURN_COMMENTS_CLOSED when the case is finished', async () => {
      const id = await cancelledCase();

      const error = refusal(
        await buyer('POST', `/api/v1/returns/${id}/comments`, language, { body: 'Too late?' }),
        409,
        'RETURN_COMMENTS_CLOSED',
      );

      expect(error.details).toEqual({ returnCaseId: id, statusCode: 'cancelled' });
      expectTranslated(error, language, COMMENTS_CLOSED);
    });

    it('RETURN_CASE_CLOSED when a delivery method is chosen for a finished case', async () => {
      const id = await cancelledCase();

      const error = refusal(
        await buyer('POST', `/api/v1/returns/${id}/select-delivery-method`, language, {
          returnDeliveryMethodId: randomUUID(),
        }),
        409,
        'RETURN_CASE_CLOSED',
      );

      expect(error.details).toEqual({ returnCaseId: id, statusCode: 'cancelled' });
      expectTranslated(error, language, CASE_CLOSED);
    });

    it('RETURN_DELIVERY_METHOD_UNAVAILABLE when the method is not offered', async () => {
      const { id } = await openCase();
      const returnDeliveryMethodId = randomUUID();

      const error = refusal(
        await buyer('POST', `/api/v1/returns/${id}/select-delivery-method`, language, { returnDeliveryMethodId }),
        422,
        'RETURN_DELIVERY_METHOD_UNAVAILABLE',
      );

      expect(error.details).toEqual({ returnDeliveryMethodId });
      expectTranslated(error, language, DELIVERY_METHOD_UNAVAILABLE);
    });
  });

  describe.each(['en', 'pl'] as const)('for an operator working in %s', (language) => {
    beforeAll(async () => {
      await setAdminLanguage(language);
    });

    it(
      'RETURN_SETTLEMENT_IN_PROGRESS while another settlement of the order holds its lock',
      async () => {
        const { id, itemId, orderId } = await receivedCase();
        const key = returnCaseOrderLockKey(orderId);
        // Another settlement, on a connection of its own, holds the order's lock.
        const holder = await h.em().getKnex().client.acquireConnection();
        try {
          await h.em().getKnex().raw('select pg_advisory_lock(hashtext(?))', [key]).connection(holder);
          const error = refusal(await settleRefund(id, itemId, 100), 409, 'RETURN_SETTLEMENT_IN_PROGRESS');

          expect(error.details).toEqual({ orderId });
          expectTranslated(error, language, SETTLEMENT_IN_PROGRESS);
        } finally {
          await h.em().getKnex().raw('select pg_advisory_unlock(hashtext(?))', [key]).connection(holder);
          await h.em().getKnex().client.releaseConnection(holder);
        }
      },
      60_000,
    );

    it('RETURN_REFUND_EXCEEDS_PAID when a line is refunded above what may be refunded', async () => {
      const { id, itemId } = await receivedCase();

      const error = refusal(await settleRefund(id, itemId, 1000), 422, 'RETURN_REFUND_EXCEEDS_PAID');

      // The seeded line is 100.00 a unit, one unit returned.
      expect(error.details).toEqual({ returnCaseItemId: itemId, requested: '1000.00', maximum: '100.00', currency: 'PLN' });
      expectTranslated(error, language, both(REFUND_EXCEEDS_PAID, '1000.00', '100.00', 'PLN'));
    });

    it('RETURN_REFUND_GATEWAY_FAILED when the payment gateway refuses the refund', async () => {
      const { id, itemId, orderId } = await receivedCase();
      await withSystemScope('test: assign the seeded order to the fixture gateway', async () => {
        const em = h.em().fork();
        const order = await em.findOneOrFail(Order, { id: orderId });
        order.paymentMethodSnapshot = {
          code: PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS.REDIRECT,
          name: 'Payment gateway fixture',
          kind: 'gateway',
          adapter: PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS.REDIRECT,
        };
        await em.flush();
      });

      const error = refusal(await settleRefund(id, itemId, 100), 502, 'RETURN_REFUND_GATEWAY_FAILED');

      // The gateway's own words are a member of their own, never the sentence.
      expect(error.details).toEqual({
        settlementState: 'failed',
        failureReason: 'The payment gateway fixture does not issue external refunds.',
        providerDetails: null,
      });
      expectTranslated(error, language, GATEWAY_FAILED);
    });

    it('RETURN_STATUS_CODE_TAKEN when a status code exists', async () => {
      const code = await createStatus();

      const error = refusal(
        await admin('POST', '/api/v1/admin/returns/statuses', { code, name: { en: 'Again' }, defaultName: 'Again' }),
        409,
        'RETURN_STATUS_CODE_TAKEN',
      );

      expect(error.details).toEqual({ statusCode: code });
      expectTranslated(error, language, both(CODE_TAKEN, code));
    });

    it('RETURN_STATUS_TERMINAL_HAS_TRANSITIONS (mark_terminal) when a status with outgoing transitions is marked terminal', async () => {
      const code = await createStatus();
      // An edge of this file's own; `PUT …/transitions` would replace the whole graph.
      await h
        .em()
        .getConnection()
        .execute(
          `insert into "return_status_transitions" ("id", "from_status_code", "to_status_code", "is_system", "created_at") values (?, ?, 'cancelled', false, now())`,
          [randomUUID(), code],
        );

      const error = refusal(
        await admin('PATCH', `/api/v1/admin/returns/statuses/${code}`, { isTerminal: true }),
        409,
        'RETURN_STATUS_TERMINAL_HAS_TRANSITIONS',
      );

      expect(error.details).toEqual({ code: 'mark_terminal', statusCode: code, outgoingCount: 1 });
      expectTranslated(error, language, both(MARK_TERMINAL, code, 1));
    });

    it('RETURN_STATUS_TERMINAL_HAS_TRANSITIONS (add_transition) when a transition leaves a terminal status', async () => {
      const terminal = await createStatus(true);

      // Refused while validating, before the existing edges are replaced.
      const error = refusal(
        await admin('PUT', '/api/v1/admin/returns/transitions', {
          transitions: [{ fromStatusCode: terminal, toStatusCode: 'new' }],
        }),
        422,
        'RETURN_STATUS_TERMINAL_HAS_TRANSITIONS',
      );

      expect(error.details).toEqual({ code: 'add_transition', statusCode: terminal, toStatusCode: 'new' });
      expectTranslated(error, language, both(ADD_TRANSITION, terminal, 'new'));
    });

    it('RETURN_STATUS_NOT_DELETABLE (initial) when the initial status is deleted', async () => {
      const error = refusal(await admin('DELETE', '/api/v1/admin/returns/statuses/new'), 409, 'RETURN_STATUS_NOT_DELETABLE');

      expect(error.details).toEqual({ code: 'initial', statusCode: 'new' });
      expectTranslated(error, language, both(NOT_DELETABLE_INITIAL, 'new'));
    });

    it('RETURN_STATUS_IN_USE when cases are in the status', async () => {
      const code = await createStatus();
      const { id } = await openCase();
      await h.em().getConnection().execute(`update "return_cases" set "status_code" = ? where "id" = ?`, [code, id]);

      const error = refusal(await admin('DELETE', `/api/v1/admin/returns/statuses/${code}`), 409, 'RETURN_STATUS_IN_USE');

      expect(error.details).toEqual({ statusCode: code, caseCount: 1 });
      expectTranslated(error, language, both(IN_USE, code, 1));
    });
  });

  it('routes the new codes to returns, the module that raises them', () => {
    for (const code of [
      'RETURN_ORDER_NOT_ELIGIBLE',
      'RETURN_QUANTITY_EXCEEDS_RETURNABLE',
      'RETURN_REASON_INACTIVE',
      'RETURN_COMMENTS_CLOSED',
      'RETURN_CASE_CLOSED',
      'RETURN_DELIVERY_METHOD_UNAVAILABLE',
      'RETURN_SETTLEMENT_IN_PROGRESS',
      'RETURN_REFUND_EXCEEDS_PAID',
      'RETURN_REFUND_GATEWAY_FAILED',
      'RETURN_STATUS_CODE_TAKEN',
      'RETURN_STATUS_TERMINAL_HAS_TRANSITIONS',
      'RETURN_STATUS_NOT_DELETABLE',
      'RETURN_STATUS_IN_USE',
    ]) {
      expect(DECLARED_ERROR_TRANSLATION_TARGETS[code]?.moduleId, code).toBe('returns');
    }
  });
});
