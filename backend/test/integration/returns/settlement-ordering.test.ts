import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { CreditLimit } from '../../../src/modules/credit_limits/entities/credit-limit.entity.js';
import { Invoice } from '../../../src/modules/invoices/entities/invoice.entity.js';
import { ReturnCase } from '../../../src/modules/returns/entities/return-case.entity.js';
import { ReturnCaseItem } from '../../../src/modules/returns/entities/return-case-item.entity.js';
import { Refund } from '../../../src/modules/returns/entities/refund.entity.js';
import { ADMIN_COOKIE, CUSTOMER_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import { setSellerSettings } from '../invoices/helpers.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * The settlement ordering law (D-91, issue #157).
 *
 * **Every external effect is attempted before any state is written, and the
 * case reaches `resolved` in the same unit of work as the `Refund` row that
 * records what happened.** A refusal therefore always leaves the case in
 * `received` with nothing written, and the whole settlement is retryable.
 *
 * The gateway arm has followed that rule since feature 046 — its class comment
 * says so — and `test/integration/returns/settle-refund.test.ts` pins it. The
 * `credit` and corrective-invoice arms did the opposite: both ports were called
 * *after* `transitions.apply` had already resolved the case and flushed the
 * item amounts, so a refusal from `credit_limits` or `invoices` arrived too
 * late to prevent anything and left "case resolved, no refund row" behind.
 *
 * Every assertion below is about the state a refusal leaves, and the last one
 * is about money: the retry the new order makes reachable must not credit an
 * organization twice.
 */
describe('returns — the settlement ordering law (D-91)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    // Issuance refuses without the seller's own company data.
    await setSellerSettings(h);
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** Create a case, authorize it, and move it to `received` so it can settle. */
  async function receivedCase(): Promise<{ id: string; itemId: string; orderId: string }> {
    // Feature 078, D-95 retired this file's one-channel-per-file workaround: the
    // seeder resolves the real system-default channel and the numbering pattern
    // carries the channel, so several corrective invoices in one file no longer
    // race for the same number.
    const { orderId, itemIds } = await seedReturnableOrder(h.em());
    const reasonId = await anyReasonId(h.em());
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/returns',
      cookies: CUSTOMER_COOKIE,
      payload: { orderId, kind: 'return', lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId }] },
    });
    const detail = (created.json() as { data: { id: string; items: Array<{ id: string }> } }).data;
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${detail.id}/authorize`,
      cookies: ADMIN_COOKIE,
    });
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/returns/${detail.id}/transition`,
      cookies: ADMIN_COOKIE,
      payload: { to: 'received' },
    });
    return { id: detail.id, itemId: detail.items[0]!.id, orderId };
  }

  /** Issue the order's original VAT invoice, so a correction has something to correct. */
  async function issueInvoice(orderId: string): Promise<void> {
    const issued = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/invoices`,
      cookies: ADMIN_COOKIE,
      payload: { kind: 'invoice' },
    });
    expect(issued.statusCode, issued.body).toBe(201);
  }

  /** Grant the test organization a credit limit, so a top-up applies. */
  async function grantCreditLimit(amount: number): Promise<void> {
    await withSystemScope('test: grant a credit limit', async () => {
      const em = h.em().fork();
      const existing = await em.findOne(CreditLimit, { organizationId: TEST_ORGANIZATION_ID });
      if (existing) {
        existing.grantedAmount = amount.toFixed(2);
      } else {
        em.create(CreditLimit, {
          organizationId: TEST_ORGANIZATION_ID,
          grantedAmount: amount.toFixed(2),
          currency: 'PLN',
        });
      }
      await em.flush();
    });
  }

  const grantedAmount = async (): Promise<number> =>
    withSystemScope('test: read the credit limit', async () =>
      Number(
        (await h.em().fork().findOneOrFail(CreditLimit, { organizationId: TEST_ORGANIZATION_ID }))
          .grantedAmount,
      ),
    );

  function settle(
    id: string,
    payload: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: Record<string, unknown> }> {
    return h.app
      .inject({
        method: 'POST',
        url: `/api/v1/admin/returns/${id}/settlement`,
        cookies: ADMIN_COOKIE,
        payload,
      })
      .then((res) => ({ statusCode: res.statusCode, body: res.json() as Record<string, unknown> }));
  }

  /**
   * What a refused settlement must not have done. The `approvedRefundAmount`
   * assertion is the one the old order could not satisfy even in principle: the
   * item amounts were flushed at line 105, before any port was called.
   */
  async function expectNothingSettled(
    id: string,
    orderId: string,
    opts: { itemId: string; untouchedAmount: number },
  ): Promise<void> {
    const state = await withSystemScope('test: assert nothing settled', async () => {
      const em = h.em().fork();
      const rc = await em.findOneOrFail(ReturnCase, { id });
      return {
        statusCode: rc.statusCode,
        resolvedAt: rc.resolvedAt ?? null,
        resolutionType: rc.resolutionType ?? null,
        item: await em.findOneOrFail(ReturnCaseItem, { id: opts.itemId }),
        refunds: await em.find(Refund, { returnCaseId: id }),
        corrections: await em.find(Invoice, { orderId, kind: 'correction' }),
        audits: await em.find(AuditLogEntry, { action: 'return.settled', objectId: id }),
      };
    });
    expect(state.statusCode, 'the case must not have reached a terminal status').toBe('received');
    expect(state.resolvedAt).toBeNull();
    expect(state.resolutionType).toBeNull();
    expect(
      Number(state.item.approvedRefundAmount),
      'the approved amounts belong to the same unit of work as the resolution',
    ).toBe(opts.untouchedAmount);
    expect(state.refunds, 'no refund row for a settlement that was refused').toHaveLength(0);
    expect(state.corrections, 'no corrective invoice for a settlement that was refused').toHaveLength(0);
    expect(state.audits, 'nothing to audit — nothing happened').toHaveLength(0);
  }

  it('a refusal from credit_limits leaves the case in received with nothing written', async () => {
    await grantCreditLimit(500);
    const { id, itemId, orderId } = await receivedCase();

    await withModuleOff('credit_limits', 'deactivated', async () => {
      const res = await settle(id, {
        resolutionType: 'credit',
        lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 60 }],
        createCorrectiveInvoice: false,
      });
      expect(res.statusCode).toBe(503);
      expect((res.body as { error?: { code?: string } }).error?.code).toBe('MODULE_DISABLED');
    });

    // 100 is the seeded default; the settlement asked for 60 and got nowhere.
    await expectNothingSettled(id, orderId, { itemId, untouchedAmount: 100 });
    expect(await grantedAmount(), 'no credit for a settlement that was refused').toBe(500);
  });

  it('a refusal from invoices leaves the case in received with nothing written', async () => {
    const { id, itemId, orderId } = await receivedCase();
    await issueInvoice(orderId);

    await withModuleOff('invoices', 'deactivated', async () => {
      const res = await settle(id, {
        resolutionType: 'refund',
        lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 60 }],
        refundPaymentMethodId: randomUUID(),
        createCorrectiveInvoice: true,
      });
      expect(res.statusCode).toBe(503);
      expect((res.body as { error?: { code?: string } }).error?.code).toBe('MODULE_DISABLED');
    });

    await expectNothingSettled(id, orderId, { itemId, untouchedAmount: 100 });
  });

  /**
   * The retry is what the new order makes reachable, and what makes the two
   * non-gateway effects need an idempotency key. The first attempt credits the
   * organization and is then refused by `invoices`; the second must settle the
   * case with **one** credit, one refund row and one corrective invoice.
   *
   * A credit applied twice is money, so the credit-limit reading is the
   * assertion this test exists for.
   */
  it('a retry after the module comes back settles exactly once', async () => {
    await grantCreditLimit(500);
    const { id, itemId, orderId } = await receivedCase();
    await issueInvoice(orderId);

    await withModuleOff('invoices', 'deactivated', async () => {
      const refused = await settle(id, {
        resolutionType: 'credit',
        lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 60 }],
        createCorrectiveInvoice: true,
      });
      expect(refused.statusCode).toBe(503);
    });

    // The credit did move before the document was refused: the effects run
    // money-first, and the top-up is what the retry must not repeat.
    expect(await grantedAmount()).toBe(560);

    const retried = await settle(id, {
      resolutionType: 'credit',
      lines: [{ returnCaseItemId: itemId, approvedRefundAmount: 60 }],
      createCorrectiveInvoice: true,
    });
    expect(retried.statusCode).toBe(200);

    expect(await grantedAmount(), 'the organization is credited once, not twice').toBe(560);

    const settled = await withSystemScope('test: assert the settlement', async () => {
      const em = h.em().fork();
      return {
        rc: await em.findOneOrFail(ReturnCase, { id }),
        refunds: await em.find(Refund, { returnCaseId: id }),
        corrections: await em.find(Invoice, { orderId, kind: 'correction' }),
        audits: await em.find(AuditLogEntry, { action: 'return.settled', objectId: id }),
      };
    });
    expect(settled.rc.statusCode).toBe('resolved');
    expect(settled.refunds, 'one refund row records what happened').toHaveLength(1);
    expect(Number(settled.refunds[0]!.amount)).toBe(60);
    expect(settled.refunds[0]!.creditLimitTopupApplied).toBe(true);
    expect(settled.corrections, 'one corrective invoice, not two').toHaveLength(1);
    expect(settled.refunds[0]!.correctiveInvoiceId).toBe(settled.corrections[0]!.id);
    expect(settled.audits, 'the audit entry is part of the write, not best-effort').toHaveLength(1);
  });
});
