import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import type { SettlementPrefill, SettlementRequest, SettlementResult } from '@b2b/contracts';
import type { EventBus } from '../../../events/bus.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import { HttpError } from '../../../http/error-envelope.js';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnCaseItem } from '../entities/return-case-item.entity.js';
import { Refund } from '../entities/refund.entity.js';
import { RETURN_STATUS_RESOLVED } from '../domain/return-status-graph.js';
import { exceedsCap, sumApproved } from '../domain/refund-math.js';
import type { ReturnTransitionService } from './return-transition-service.js';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';
import type { PaymentRefundPort } from '../ports/payment-refund.port.js';
import type { CorrectiveInvoicePort } from '../ports/corrective-invoice.port.js';
import type { CreditTopupPort } from '../ports/credit-topup.port.js';

export interface ReturnSettlementServiceDeps {
  emFactory: () => EntityManager;
  events: EventBus;
  transitions: ReturnTransitionService;
  graphService: ReturnStatusGraphService;
  paymentRefund: PaymentRefundPort;
  correctiveInvoice: CorrectiveInvoicePort;
  creditTopup: CreditTopupPort;
  auditLog?: AuditLogService;
}

/**
 * ReturnSettlementService — feature 046 (US5).
 *
 * Validates per-line refund amounts (never exceeding the paid amount), advances
 * the case to `resolved`, and orchestrates the financial side-effects through
 * the documented ports: money refund (payments), store credit (credit_limits),
 * and the corrective invoice (invoices). Replacement/repair resolutions move no
 * money.
 *
 * **The ordering law (D-91, issue #157). Every external effect is attempted
 * before any state is written, and the case reaches `resolved` in the same unit
 * of work as the `Refund` row that records what happened.** In order:
 *
 *  1. **Validate** — the graph transition, the refund method, the per-line
 *     caps. Nothing is assigned and nothing is flushed.
 *  2. **Attempt every external effect: money, then document.** The gateway
 *     refund or the store credit, then the corrective invoice. Outcomes are
 *     held in memory. A refusal here — a `ModuleDisabledError` from a
 *     switched-off `payments`, `credit_limits` or `invoices`, a gateway
 *     rejection — propagates, and because nothing has been written the case is
 *     still `received` and the whole settlement is retryable.
 *  3. **Build the `Refund` row from those outcomes**, including its
 *     `settlementState` and its provider details.
 *  4. **One unit of work** — the item amounts, the `Refund` row, the audit
 *     entry and the transition to `resolved`, in the transition's single flush.
 *     Either the case is resolved with a complete record of what happened, or
 *     it is untouched.
 *  5. **After commit** — the settled event.
 *
 * The gateway arm has followed this since feature 046 ("a PSP rejection must
 * not leave the RMA looking successfully settled"); the `credit` and
 * corrective-invoice arms called their ports *after* the case was resolved and
 * flushed, so a refusal arrived too late to prevent anything and left "case
 * resolved, refund row absent, money possibly already moved" behind. That is a
 * fact about the relationship between an irreversible effect and a state
 * change, not a fact about PSPs — so it holds for a store credit and for a VAT
 * document, and any arm added later follows it too.
 *
 * The retry the law makes reachable is what makes the two non-gateway effects
 * take a key: `creditFromReturn` applies once per return case and
 * `createCorrection` takes `idempotencyKey: rc.id`, the same key
 * `paymentRefund.refund` has always taken.
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

    // Step 1 — validate. The approved amounts are computed into a map and
    // **not** assigned: an assignment on a managed entity is a write the next
    // flush carries, and under the ordering law nothing is written until step 4.
    const items = await em.find(ReturnCaseItem, { returnCaseId: id });
    const byId = new Map(items.map((it) => [it.id, it]));
    const approvedByItemId = new Map<string, number>();
    const perLine: number[] = [];
    for (const line of input.lines) {
      const item = byId.get(line.returnCaseItemId);
      if (!item) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Unknown return line.', {
          code: 'unknown_line',
        });
      }
      if (exceedsCap(line.approvedRefundAmount, Number(item.defaultRefundAmount))) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'Refund amount cannot exceed the amount paid for the line.',
          { code: 'refund_exceeds_paid' },
        );
      }
      approvedByItemId.set(line.returnCaseItemId, line.approvedRefundAmount);
      perLine.push(line.approvedRefundAmount);
    }
    const total = sumApproved(perLine);

    const movesMoney = input.resolutionType === 'refund' || input.resolutionType === 'credit';

    // Step 2 — every external effect, money first, then the document. A refusal
    // from any of them propagates with the case still in `received` and nothing
    // written, which is what makes the settlement retryable.
    let gatewayOutcome: Awaited<ReturnType<PaymentRefundPort['refund']>> | null = null;
    let creditApplied: boolean | null = null;
    let correction: Awaited<ReturnType<CorrectiveInvoicePort['createCorrection']>> | null = null;

    if (movesMoney) {
      if (input.resolutionType === 'refund') {
        gatewayOutcome = await this.deps.paymentRefund.refund({
          orderId: rc.orderId,
          amount: total,
          currency: rc.currency,
          ...(input.refundPaymentMethodId ? { paymentMethodId: input.refundPaymentMethodId } : {}),
          idempotencyKey: rc.id,
        });
        if (gatewayOutcome.state === 'failed') {
          throw new HttpError(
            502,
            ERROR_CODES.VALIDATION_FAILED,
            gatewayOutcome.failureReason ?? 'Payment gateway rejected the refund.',
            {
              code: 'gateway_refund_failed',
              settlementState: gatewayOutcome.state,
              providerDetails: gatewayOutcome.providerDetails ?? null,
            },
          );
        }
      } else {
        // `credit_limits` applies once per return case, so this survives the
        // retry the law above makes reachable.
        const credit = rc.organizationId
          ? await this.deps.creditTopup.creditFromReturn({
              organizationId: rc.organizationId,
              amount: total,
              currency: rc.currency,
              returnCaseId: rc.id,
            })
          : { applied: false };
        creditApplied = credit.applied;
      }

      if (input.createCorrectiveInvoice ?? true) {
        correction = await this.deps.correctiveInvoice.createCorrection({
          orderId: rc.orderId,
          lines: items.map((it) => ({
            // The order item is what ties this credit to the invoice line it
            // corrects, so the correction can mirror that line's VAT rate.
            orderItemId: it.orderItemId,
            productName: it.productName,
            quantity: it.quantity,
            // The approved amount for this settlement, which is not on the row
            // yet: the rows are written in step 4.
            amount: approvedByItemId.get(it.id) ?? Number(it.approvedRefundAmount),
          })),
          total,
          currency: rc.currency,
          // One correction per return case, however often the settlement is
          // retried. Not per order: a second partial return against the same
          // order is a different case and gets its own document.
          idempotencyKey: rc.id,
        });
      }
    }

    // Step 3 — the outcomes, as the values the row and the response carry.
    const result: SettlementResult = { totalRefundAmount: total };
    const refundFields = movesMoney
      ? {
          returnCaseId: id,
          resolutionType: (input.resolutionType === 'refund' ? 'refund' : 'credit') as
            | 'refund'
            | 'credit',
          amount: total.toFixed(2),
          currency: rc.currency,
          paymentMethodId: input.refundPaymentMethodId ?? null,
          settlementState: 'pending_manual' as Refund['settlementState'],
          externalReference: null as string | null,
          providerDetails: null as Record<string, unknown> | null,
          failureReason: null as string | null,
          creditLimitTopupApplied: false,
          correctiveInvoiceId: null as string | null,
          // D-92 — the three-way answer on the row, so it survives a page
          // reload. `not_requested` is the default because the caller can
          // switch the correction off; the two other values are set below,
          // inside the branch that asked for one.
          correctiveInvoiceOutcome:
            'not_requested' as Refund['correctiveInvoiceOutcome'],
        }
      : null;

    if (refundFields) {
      if (gatewayOutcome) {
        refundFields.settlementState = gatewayOutcome.state;
        refundFields.externalReference = gatewayOutcome.externalReference ?? null;
        refundFields.providerDetails = gatewayOutcome.providerDetails ?? null;
        refundFields.failureReason = gatewayOutcome.failureReason ?? null;
        result.refund = {
          settlementState: gatewayOutcome.state,
          externalReference: gatewayOutcome.externalReference ?? null,
          failureReason: gatewayOutcome.failureReason ?? null,
        };
      } else {
        refundFields.settlementState = creditApplied ? 'issued' : 'pending_manual';
        refundFields.creditLimitTopupApplied = creditApplied ?? false;
        result.creditLimitTopupApplied = creditApplied ?? false;
        result.refund = { settlementState: refundFields.settlementState };
      }

      if (correction) {
        // An order that was never invoiced has nothing to correct (#135). The
        // settlement still stands — the refund is recorded on the return case
        // and on the payment record — and the result says which of the two
        // happened, because a silent absence would read as a lost document.
        if (correction.issued) {
          refundFields.correctiveInvoiceId = correction.invoiceId;
          refundFields.correctiveInvoiceOutcome = 'issued';
          result.correctiveInvoiceId = correction.invoiceId;
          result.correctiveInvoice = {
            issued: true,
            invoiceId: correction.invoiceId,
            number: correction.number,
          };
        } else {
          refundFields.correctiveInvoiceOutcome = 'not_due';
          result.correctiveInvoiceId = null;
          result.correctiveInvoice = { issued: false, reason: correction.reason };
        }
      }
    }

    // Step 4 — one unit of work. `transitions.apply` flushes once, so the item
    // amounts, the `Refund` row, the audit entry and the resolution commit
    // together or not at all.
    let refund: Refund | null = null;
    await this.deps.transitions.apply(
      id,
      RETURN_STATUS_RESOLVED,
      { kind: 'admin', adminUserId, source: 'settlement' },
      {
        mutate: async (target, tx) => {
          target.resolutionType = input.resolutionType;
          target.refundPaymentMethodId = input.refundPaymentMethodId ?? null;
          target.totalRefundAmount = total.toFixed(2);
          target.resolvedAt = new Date();

          for (const it of await tx.find(ReturnCaseItem, { returnCaseId: id })) {
            const approved = approvedByItemId.get(it.id);
            if (approved !== undefined) it.approvedRefundAmount = approved.toFixed(2);
          }

          if (refundFields) {
            refund = tx.create(Refund, refundFields);
            tx.persist(refund);
          }

          // The audit entry is part of the write, not a best-effort call after
          // it: it used to sit behind `catch { /* ignore audit failures */ }`,
          // which is a comment rather than a decision (Principle XIII's
          // co-transactional clause).
          this.deps.auditLog?.recordWithin(tx, {
            actorAdminUserId: adminUserId,
            action: 'return.settled',
            objectType: 'return_case',
            objectId: rc.id,
            stateAfter: {
              resolutionType: input.resolutionType,
              amount: total.toFixed(2),
              currency: rc.currency,
              settlementState: refundFields?.settlementState ?? null,
              // Says which of the three happened — issued, not due, or never
              // asked for — so "no corrective invoice" is readable after the
              // fact instead of being an absent field (#135).
              correctiveInvoice: result.correctiveInvoice
                ? result.correctiveInvoice.issued
                  ? 'issued'
                  : result.correctiveInvoice.reason
                : 'not_requested',
            },
          });
        },
      },
    );

    // Step 5 — after commit.
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
