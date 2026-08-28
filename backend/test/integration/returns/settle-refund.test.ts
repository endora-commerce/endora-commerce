import { Invoice } from '../../helpers/package-entities.js';
import { randomUUID } from 'crypto';

import { dirname, resolve } from 'node:path';

import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { withModuleOff } from '../../helpers/off-state.js';

import { CreditLimit, Refund, ReturnCase } from '../../helpers/package-entities.js';



import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';

import { setSellerSettings } from '../invoices/helpers.js';

import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

import { TranslationBundle } from '../../../src/modules/_i18n/entities/translation-bundle.entity.js';

import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { Order } from '../../helpers/package-entities.js';
import { gatewayRefundRegistryOf } from '../../helpers/package-singletons.js';


const I18N_MODULE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/modules/_i18n',
);

/**
 * Feature 046 (US5) — settlement: refund amounts (capped at paid), money
 * refund, store credit, replacement, and corrective invoice.
 */
describe('returns — settlement (US5)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    // Needed by the invoiced counterpart below: issuance refuses without the
    // seller's own company data.
    await setSellerSettings(h);
    // Issue #161 — the message assertions in the switched-off-gateway block
    // need a bundle to resolve against. `setupBackendServer` passes no
    // lifecycle manifest registry, so `reconcileBundles` is a no-op under the
    // harness (`test/unit/_i18n/reconcile-timing.test.ts` says so in full) and
    // `translation_bundles` stays empty; every error message then falls back to
    // the *written* one, which for `ModuleDisabledError` already contains the
    // module id — so an assertion over the rendered sentence would pass with
    // the sentence never consulted. Installing the bundle is what makes it
    // measure the wire, and what lets it go red without the fix.
    await h.adminI18n.i18nService.installBundlesForModule('_i18n', I18N_MODULE_PATH, 'i18n');
  });
  afterAll(async () => {
    // `translation_bundles` is not in the harness' truncate list, so the rows
    // installed above would outlive this file.
    await h.em().nativeDelete(TranslationBundle, { moduleId: '_i18n' });
    await teardownBackendServer(h);
  });

  /** Create a case, authorize it, and move it to `received` so it can settle. */
  async function receivedCase(): Promise<{ id: string; itemId: string; orderId: string }> {
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    const detail = (created.json() as { data: { id: string; items: Array<{ id: string }> } }).data;
    await h.app.inject({ method: 'POST', url: `/api/v1/admin/returns/${detail.id}/authorize`, cookies: ADMIN_COOKIE });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${detail.id}/transition`,
      cookies: ADMIN_COOKIE,
      payload: { to: 'received' },
    });
    return { id: detail.id, itemId: detail.items[0]!.id, orderId };
  }

  /**
   * Issue #104 / D-71 — a switched-off payment gateway must not be usable for a
   * refund, and "not usable" means the settlement is **refused**.
   *
   * The execution path has been presence-correct since feature 074:
   * `gatewayRefundRegistry` skips a handler whose owner is not effectively
   * present, so a switched-off PSP is never called. What was wrong is where the
   * skip landed. `PaymentRefundProvider` answered `pending_manual`, and every
   * layer above reads anything but `'failed'` as success — the case resolved,
   * a `Refund` row was written, a corrective invoice was issued, the customer
   * was mailed, and `ReturnDetail.tsx` said "Settled." over money that had
   * never moved.
   *
   * The last clause of each assertion block is the requirement; the status code
   * is the mechanism. `withModuleOff` drives the flip and asserts it took
   * before anything below observes a surface, on both axes.
   */
  describe('a switched-off payment gateway (#104, D-71)', () => {
    const STRIPE_SNAPSHOT: Order['paymentMethodSnapshot'] = {
      code: 'stripe_card',
      name: 'Card (Stripe)',
      kind: 'gateway',
      adapter: 'stripe',
    };

    /** A `received` case on an order that was paid through Stripe. */
    async function stripePaidCase(): Promise<{ id: string; itemId: string; orderId: string }> {
      const seeded = await receivedCase();
      // `seedReturnableOrder` seeds a bank-transfer order; this block is about
      // the gateway arm, and the provider resolves the PSP from the snapshot.
      await withSystemScope('test: mark the seeded order as Stripe-paid', async () => {
        const em = h.em().fork();
        const order = await em.findOneOrFail(Order, { id: seeded.orderId });
        order.paymentMethodSnapshot = STRIPE_SNAPSHOT;
        await em.flush();
      });
      return seeded;
    }

    async function settleRefund(
      id: string,
      itemId: string,
    ): Promise<{
      statusCode: number;
      headers: Record<string, unknown>;
      error?: { code?: string; message?: string; details?: unknown };
    }> {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/returns/${id}/settlement`,
        cookies: ADMIN_COOKIE,
        payload: {
          resolutionType: 'refund',
          lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 100 }],
          refundPaymentMethodId: randomUUID(),
          createCorrectiveInvoice: true,
        },
      });
      const body = res.json() as { error?: { code?: string; message?: string; details?: unknown } };
      return {
        statusCode: res.statusCode,
        headers: res.headers as Record<string, unknown>,
        ...(body.error ? { error: body.error } : {}),
      };
    }

    /** What the refused settlement must NOT have done. */
    async function expectNothingSettled(id: string, orderId: string): Promise<void> {
      const state = await withSystemScope('test: assert nothing settled', async () => {
        const em = h.em().fork();
        const rc = await em.findOneOrFail(ReturnCase, { id });
        return {
          statusCode: rc.statusCode,
          resolvedAt: rc.resolvedAt ?? null,
          resolutionType: rc.resolutionType ?? null,
          refunds: await em.find(Refund, { returnCaseId: id }),
          corrections: await em.find(Invoice, { orderId, kind: 'correction' }),
        };
      });
      expect(state.statusCode, 'the case must not have reached a terminal status').toBe('received');
      expect(state.resolvedAt).toBeNull();
      expect(state.resolutionType).toBeNull();
      expect(state.refunds, 'no refund row for money that never moved').toHaveLength(0);
      expect(
        state.corrections,
        'no corrective invoice against a refund that was refused',
      ).toHaveLength(0);
    }

    it('has the stripe handler contributed, so the assertions below are about presence', () => {
      // Without this the provider would take the no-integration branch and
      // every refusal below would be measuring an adapter nobody registered.
      expect(gatewayRefundRegistryOf(h.container).ownerOf('stripe')).toBe('stripe');
      expect(gatewayRefundRegistryOf(h.container).list()).toContain('stripe');
    });

    it('refuses while the operator has the gateway switched off, and settles nothing', async () => {
      const { id, itemId, orderId } = await stripePaidCase();

      await withModuleOff('stripe', 'deactivated', async () => {
        const res = await settleRefund(id, itemId);
        expect(res.statusCode).toBe(503);
        expect(res.error?.code).toBe('MODULE_DISABLED');
        expect(res.headers['retry-after']).toBe('60');
        // Issue #161 — and the operator has to be told *which* module. The id
        // was on the error object all along (asserted in
        // `test/unit/payments/payment-refund-provider.test.ts`), but the
        // envelope replaces an operator-visible message with the registered
        // sentence for its code, and `MODULE_DISABLED` is one code for every
        // gated port in the platform: what reached the admin was "Module
        // Disabled.", and the remedy — switch `stripe` back on — was named
        // nowhere on the response. It is now in both places a client can use.
        expect(res.error?.message).toBe(
          'The "stripe" module is off, so this action was refused. ' +
            'Check its state on the Modules screen.',
        );
        expect(res.error?.details).toEqual({ module: 'stripe' });
      });

      await expectNothingSettled(id, orderId);
    });

    it('refuses while the deployment does not offer the gateway at all', async () => {
      const { id, itemId, orderId } = await stripePaidCase();

      await withModuleOff('stripe', 'platform-unavailable', async () => {
        const res = await settleRefund(id, itemId);
        expect(res.statusCode).toBe(503);
        expect(res.error?.code).toBe('MODULE_DISABLED');
      });

      await expectNothingSettled(id, orderId);
    });

    it('stops refusing once the gateway is switched back on', async () => {
      const { id, itemId } = await stripePaidCase();

      // Off is reversible. What the refund then does is between the handler and
      // Stripe — with no credentials configured it reports a failed refund,
      // which is a different answer with a different status. The one thing that
      // must be gone is the claim that the module is absent.
      const res = await settleRefund(id, itemId);
      expect(res.error?.code).not.toBe('MODULE_DISABLED');
      expect(res.statusCode).not.toBe(503);
    });
  });

  /**
   * Issue #135 (product ruling 2026-08-17) — a settled return on an order that
   * was never invoiced produces **no** corrective invoice. The refund is real
   * and stays recorded on the return case and the payment record; only the
   * VAT-shaped document goes away, because there is no VAT document to correct.
   *
   * The settlement itself must still succeed: this path runs after the PSP
   * refund has already gone through, so a throw here would leave money moved
   * and the case unsettled.
   */
  it('settles a refund on a never-invoiced order without a corrective invoice', async () => {
    const { id, itemId } = await receivedCase();

    const prefill = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${id}/settlement`, cookies: ADMIN_COOKIE });
    const pf = (prefill.json() as { data: { items: Array<{ defaultRefundAmount: number }> } }).data;
    expect(pf.items[0]!.defaultRefundAmount).toBe(100);

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: {
        resolutionType: 'refund',
        lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 100 }],
        refundPaymentMethodId: randomUUID(),
        createCorrectiveInvoice: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as {
        data: {
          totalRefundAmount: number;
          refund: { settlementState: string };
          correctiveInvoiceId: string | null;
          correctiveInvoice: { issued: boolean; reason?: string };
        };
      }
    ).data;
    expect(data.totalRefundAmount).toBe(100);
    expect(data.refund.settlementState).toBe('issued'); // bank_transfer order → recorded as issued
    // The absence is stated, not implied.
    expect(data.correctiveInvoice).toEqual({ issued: false, reason: 'order_not_invoiced' });
    expect(data.correctiveInvoiceId).toBeNull();

    const after = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${id}`, cookies: ADMIN_COOKIE });
    expect((after.json() as { data: { statusCode: string } }).data.statusCode).toBe('resolved');

    // The refund is recorded on the case, and no document was written for it.
    const settled = await withSystemScope('test: assert refund recorded', async () => {
      const em = h.em().fork();
      const rc = await em.findOneOrFail(ReturnCase, { id });
      const refund = await em.findOneOrFail(Refund, { returnCaseId: id });
      const corrections = await em.find(Invoice, { orderId: rc.orderId, kind: 'correction' });
      return { amount: Number(refund.amount), correctiveInvoiceId: refund.correctiveInvoiceId, corrections };
    });
    expect(settled.amount).toBe(100);
    expect(settled.correctiveInvoiceId).toBeFalsy();
    expect(settled.corrections).toHaveLength(0);
  });

  /**
   * The counterpart to the test above: an order that **was** invoiced still
   * gets its correction. The two pin each other — neither "always issue" nor
   * "never issue" passes both.
   */
  it('issues the corrective invoice when the order was invoiced', async () => {
    const { id, itemId, orderId } = await receivedCase();
    const issued = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(issued.statusCode).toBe(201);

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: {
        resolutionType: 'refund',
        lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 100 }],
        refundPaymentMethodId: randomUUID(),
        createCorrectiveInvoice: true,
      },
    });
    expect(res.statusCode).toBe(200);
    const data = (
      res.json() as {
        data: {
          correctiveInvoiceId: string | null;
          correctiveInvoice: { issued: boolean; invoiceId?: string; number?: string };
        };
      }
    ).data;
    expect(data.correctiveInvoice.issued).toBe(true);
    expect(data.correctiveInvoiceId).toBeTruthy();
    expect(data.correctiveInvoice.invoiceId).toBe(data.correctiveInvoiceId);

    const correction = await withSystemScope('test: assert correction', () =>
      h.em().fork().findOneOrFail(Invoice, { orderId, kind: 'correction' }),
    );
    expect(correction.id).toBe(data.correctiveInvoiceId);
    expect(correction.originalInvoiceId).toBeTruthy();
  });

  it('rejects a refund amount above the paid amount', async () => {
    const { id, itemId } = await receivedCase();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: {
        resolutionType: 'refund',
        lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 999 }],
        refundPaymentMethodId: randomUUID(),
      },
    });
    expect(res.statusCode).toBe(422);
  });

  it('requires a payment method for a money refund', async () => {
    const { id, itemId } = await receivedCase();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: { resolutionType: 'refund', lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 100 }] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('credits the organization credit limit for a credit resolution', async () => {
    // Grant a credit limit so the top-up applies.
    const em = h.em();
    em.create(CreditLimit, { organizationId: TEST_ORGANIZATION_ID, grantedAmount: '500.00', currency: 'PLN' });
    await em.flush();

    const { id, itemId } = await receivedCase();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: { resolutionType: 'credit', lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 100 }] },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { creditLimitTopupApplied: boolean; refund: { settlementState: string } } }).data;
    expect(data.creditLimitTopupApplied).toBe(true);
    expect(data.refund.settlementState).toBe('issued');

    const limit = await withSystemScope('test: assert credit topup', () =>
      h.em().findOneOrFail(CreditLimit, { organizationId: TEST_ORGANIZATION_ID }),
    );
    expect(Number(limit.grantedAmount)).toBe(600);
  });

  it('issues no money for a replacement resolution', async () => {
    const { id, itemId } = await receivedCase();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${id}/settlement`,
      cookies: ADMIN_COOKIE,
      payload: { resolutionType: 'replacement', lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 0 }] },
    });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: { refund?: unknown } }).data;
    expect(data.refund).toBeUndefined();

    const after = await h.app.inject({ method: 'GET', url: `/api/v1/admin/returns/${id}`, cookies: ADMIN_COOKIE });
    expect((after.json() as { data: { statusCode: string } }).data.statusCode).toBe('resolved');
  });
});
