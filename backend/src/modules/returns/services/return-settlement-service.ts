import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import type { SettlementPrefill, SettlementRequest, SettlementResult } from '@b2b/contracts';
import type { EventBus } from '../../../events/bus.js';
import { HttpError } from '../../../http/error-envelope.js';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnCaseItem } from '../entities/return-case-item.entity.js';
import { Refund } from '../entities/refund.entity.js';
import { RETURN_STATUS_RESOLVED } from '../domain/return-status-graph.js';
import type { ReturnTransitionService } from './return-transition-service.js';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';
import type { PaymentRefundPort } from '../ports/payment-refund.port.js';
import type { CorrectiveInvoicePort } from '../ports/corrective-invoice.port.js';
import type { CreditTopupPort } from '../ports/credit-topup.port.js';

const EPS = 0.005;

export interface ReturnSettlementServiceDeps {
  emFactory: () => EntityManager;
  events: EventBus;
  transitions: ReturnTransitionService;
  graphService: ReturnStatusGraphService;
  paymentRefund: PaymentRefundPort;
  correctiveInvoice: CorrectiveInvoicePort;
  creditTopup: CreditTopupPort;
}

/**
 * ReturnSettlementService — feature 046 (US5).
 *
 * Validates per-line refund amounts (never exceeding the paid amount), advances
 * the case to `resolved`, and orchestrates the financial side-effects through
 * the documented ports: money refund (payments), store credit (credit_limits),
 * and the corrective invoice (invoices). Replacement/repair resolutions move no
 * money.
 */
export class ReturnSettlementService {
  constructor(private readonly deps: ReturnSettlementServiceDeps) {}

  async getPrefill(id: string): Promise<SettlementPrefill> {
    const em = this.deps.emFactory();
    const rc = await em.findOne(ReturnCase, { id });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const items = await em.find(ReturnCaseItem, { returnCaseId: id });
    return {
      currency: rc.currency,
      resolutionOptions: ['refund', 'credit', 'replacement', 'repair'],
      items: items.map((it) => ({
        returnCaseItemId: it.id,
        productName: it.productName,
        quantity: it.quantity,
        defaultRefundAmount: Number(it.defaultRefundAmount),
        approvedRefundAmount: Number(it.approvedRefundAmount),
      })),
    };
  }

  async settle(id: string, adminUserId: string, input: SettlementRequest): Promise<SettlementResult> {
    const em = this.deps.emFactory();
    const rc = await em.findOne(ReturnCase, { id });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');

    // Fail fast if the case cannot reach `resolved` before mutating anything.
    const graph = await this.deps.graphService.loadGraph();
    if (!graph.canTransition(rc.statusCode, RETURN_STATUS_RESOLVED)) {
      throw new HttpError(
        409,
        ERROR_CODES.INVALID_TRANSITION,
        `Cannot settle a case in status "${rc.statusCode}".`,
      );
    }
    if (input.resolutionType === 'refund' && !input.refundPaymentMethodId) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A refund payment method is required.', {
        code: 'payment_method_required',
      });
    }

    const items = await em.find(ReturnCaseItem, { returnCaseId: id });
    const byId = new Map(items.map((it) => [it.id, it]));
    let total = 0;
    for (const line of input.lines) {
      const item = byId.get(line.returnCaseItemId);
      if (!item) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Unknown return line.', {
          code: 'unknown_line',
        });
      }
      if (line.approvedRefundAmount > Number(item.defaultRefundAmount) + EPS) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'Refund amount cannot exceed the amount paid for the line.',
          { code: 'refund_exceeds_paid' },
        );
      }
      item.approvedRefundAmount = line.approvedRefundAmount.toFixed(2);
      total += line.approvedRefundAmount;
    }
    total = round2(total);
    await em.flush();

    const movesMoney = input.resolutionType === 'refund' || input.resolutionType === 'credit';

    await this.deps.transitions.apply(
      id,
      RETURN_STATUS_RESOLVED,
      { kind: 'admin', adminUserId, source: 'settlement' },
      {
        mutate: (target) => {
          target.resolutionType = input.resolutionType;
          target.refundPaymentMethodId = input.refundPaymentMethodId ?? null;
          target.totalRefundAmount = total.toFixed(2);
          target.resolvedAt = new Date();
        },
      },
    );

    const result: SettlementResult = { totalRefundAmount: total };
    if (!movesMoney) {
      this.emitSettled(rc, null, total);
      return result;
    }

    const refund = em.create(Refund, {
      returnCaseId: id,
      resolutionType: input.resolutionType === 'refund' ? 'refund' : 'credit',
      amount: total.toFixed(2),
      currency: rc.currency,
      paymentMethodId: input.refundPaymentMethodId ?? null,
      settlementState: 'pending_manual',
    });

    if (input.resolutionType === 'refund') {
      const outcome = await this.deps.paymentRefund.refund({
        orderId: rc.orderId,
        amount: total,
        currency: rc.currency,
        ...(input.refundPaymentMethodId ? { paymentMethodId: input.refundPaymentMethodId } : {}),
        idempotencyKey: rc.id,
      });
      refund.settlementState = outcome.state;
      refund.externalReference = outcome.externalReference ?? null;
      refund.providerDetails = outcome.providerDetails ?? null;
      refund.failureReason = outcome.failureReason ?? null;
      result.refund = { settlementState: outcome.state, externalReference: outcome.externalReference ?? null };
    } else {
      const credit = rc.organizationId
        ? await this.deps.creditTopup.creditFromReturn({
            organizationId: rc.organizationId,
            amount: total,
            currency: rc.currency,
            returnCaseId: rc.id,
          })
        : { applied: false };
      refund.settlementState = credit.applied ? 'issued' : 'pending_manual';
      refund.creditLimitTopupApplied = credit.applied;
      result.creditLimitTopupApplied = credit.applied;
      result.refund = { settlementState: refund.settlementState };
    }

    if (input.createCorrectiveInvoice ?? true) {
      const inv = await this.deps.correctiveInvoice.createCorrection({
        orderId: rc.orderId,
        lines: items.map((it) => ({
          productName: it.productName,
          quantity: it.quantity,
          amount: Number(it.approvedRefundAmount),
        })),
        total,
        currency: rc.currency,
      });
      refund.correctiveInvoiceId = inv.invoiceId;
      result.correctiveInvoiceId = inv.invoiceId;
    }

    em.persist(refund);
    await em.flush();
    this.emitSettled(rc, refund, total);
    return result;
  }

  private emitSettled(rc: ReturnCase, refund: Refund | null, total: number): void {
    const payload = {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      returnCaseId: rc.id,
      refundId: refund?.id ?? null,
      resolutionType: rc.resolutionType,
      amount: total,
      currency: rc.currency,
      settlementState: refund?.settlementState ?? null,
    };
    this.deps.events.emit('return.refund.settled.v1', payload);
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
