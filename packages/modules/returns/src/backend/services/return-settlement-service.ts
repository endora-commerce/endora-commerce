import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, compareDecimals, isUuidShape, returnCaseOrderLockKey, roundHalfUp } from '@endora-commerce/contracts';
import type {
  CorrectiveInvoiceInput,
  CorrectiveInvoicePort,
  CreditTopupPort,
  OrderReturnContext,
  OrderReturnContextPort,
  PaymentRefundPort,
  SettlementPrefill,
  SettlementRequest,
  SettlementResult,
} from '@endora-commerce/contracts';
import type { EventBus } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnCaseItem } from '../entities/return-case-item.entity.js';
import { Refund } from '../entities/refund.entity.js';
import { RETURN_STATUS_RESOLVED } from '../domain/return-status-graph.js';
import { approvedAmount, carriedDiscount, settlementApproved, sumApproved } from '../domain/refund-math.js';
import { isLineReturnable } from './return-eligibility.js';
import { chargeApproved, isWithinWithdrawalWindow, type ChargeRefund } from '../domain/charge-refunds.js';
import { withdrawalPeriodAnchor } from '../domain/withdrawal-period.js';
import { caseCharges, caseDefaults, loadOrderCases, type OrderCases } from './default-refund-service.js';
import {
  consentRequiredFor,
  defaultResolution,
  refundMethodDiffers,
  resolutionNeedsConsent,
  type ConsentState,
} from '../domain/consumer-withdrawal.js';
import type { ReturnTransitionService } from './return-transition-service.js';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';

/** How long a settlement waits for another settlement of the same order. */
const SETTLEMENT_LOCK_TIMEOUT = '15s';
/** PostgreSQL's `lock_not_available`, raised when `lock_timeout` elapses. */
const LOCK_NOT_AVAILABLE = '55P03';

export interface ReturnSettlementServiceDeps {
  emFactory: () => EntityManager;
  events: EventBus;
  transitions: ReturnTransitionService;
  graphService: ReturnStatusGraphService;
  paymentRefund: PaymentRefundPort;
  correctiveInvoice: CorrectiveInvoicePort;
  creditTopup: CreditTopupPort;
  /**
   * `orders`' return context (a hard manifest dependency): the order facts the
   * default refund is recomputed from at settlement (issue #875), and the
   * order's own payment method, which the refund of a consumer withdrawal
   * proposes and is compared with (issue #905, design D1).
   */
  orderContext: OrderReturnContextPort;
  /**
   * Whether the order's Organization is personal (B2C), through
   * `organizations`' port (issue #876): a consumer's withdrawal that completes
   * the order refunds the delivery and the payment surcharge. Absent: no
   * Organization is, and no case refunds a charge.
   */
  isPersonalOrganization?: (organizationId: string | null, placedAt?: Date) => Promise<boolean>;
  /**
   * `returns.time_zone` for a sales channel (issue #905): the zone the
   * withdrawal window that decides the charges' default counts calendar days
   * in, as `ReturnCaseService` counts the free-return window.
   */
  resolveTimeZone: (salesChannelId: string) => Promise<string>;
  auditLog?: AuditPort;
}

/** The order's two charges as recomputed for this case (issue #876). */
interface CaseChargeRefunds {
  delivery: ChargeRefund;
  surcharge: ChargeRefund;
}

/** A line's default as recomputed for this settlement (issues #874, #875). */
interface LineDefault {
  /** The default of the goods, stored on the line: the next case's telescoping `earlier`. */
  refund: string;
  discount: string;
  /** What may be refunded: the default, bounded by the line ceiling. */
  effective: string;
  /** Whether the line was returnable when bought — a non-returnable complaint line's 0 is an amount. */
  returnable: boolean;
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
 *     caps. The default of each line is recomputed from the cases settled by
 *     now (issue #875): an amount equal to a default settles at the recomputed
 *     one, a lower one is kept, anything else is refused. Nothing is assigned
 *     and nothing is flushed.
 *  2. **Attempt every external effect: money, then document.** The gateway
 *     refund or the store credit, then the corrective invoice. Outcomes are
 *     held in memory. A refusal here — a `ModuleDisabledError` from a
 *     switched-off `payments`, `credit_limits` or `invoices`, a gateway
 *     rejection — propagates, and because nothing has been written the case is
 *     still `received` and the whole settlement is retryable.
 *  3. **Build the `Refund` row from those outcomes**, including its
 *     `settlementState` and its provider details.
 *  4. **One unit of work** — the item amounts and recomputed defaults, the `Refund` row, the audit
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
    if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const rc = await em.findOne(ReturnCase, { id });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const items = await em.find(ReturnCaseItem, { returnCaseId: id });
    // An open case previews what the settlement would recompute (issue #875):
    // the default on the settled basis, bounded by the line ceiling, and the
    // stored approved amount mapped onto it as the settlement maps it. Read
    // without the lock, so another settlement of the order may still move it;
    // the settlement itself decides. A settled case shows what it settled at.
    const order = await this.deps.orderContext.getReturnContext(rc.orderId);
    const context = rc.resolutionType == null ? order : null;
    const history = context ? await loadOrderCases(em, rc.orderId) : null;
    const defaults = context && history ? await this.#recompute(em, rc, items, context, history) : null;
    const charges = context && history ? await this.#charges(rc, items, context, history) : null;
    return {
      currency: rc.currency,
      ...this.#prefillCharges(rc, charges),
      resolutionOptions: ['refund', 'credit', 'replacement', 'repair'],
      // Issue #905 (design D1) — a consumer withdrawal settles as a refund to
      // the order's own method; the other resolutions wait for consent.
      defaultResolution: defaultResolution(),
      consentRequiredFor: consentRequiredFor(consentStateOf(rc)),
      defaultRefundPaymentMethodId: order?.paymentMethodId ?? null,
      items: items.map((it) => {
        const d = defaults?.get(it.id);
        if (!d) {
          return {
            returnCaseItemId: it.id,
            productName: it.productName,
            quantity: it.quantity,
            defaultRefundAmount: Number(it.defaultRefundAmount),
            approvedRefundAmount: Number(it.approvedRefundAmount),
          };
        }
        const mapped = this.#approved(rc, it, d, it.approvedRefundAmount);
        return {
          returnCaseItemId: it.id,
          productName: it.productName,
          quantity: it.quantity,
          // The most the operator may approve.
          defaultRefundAmount: Number(d.effective),
          approvedRefundAmount: Number('approved' in mapped ? mapped.approved : d.effective),
        };
      }),
    };
  }

  /**
   * The charges the prefill shows (issue #876): on an open case, each charge
   * whose recomputed cap is above 0, at its recomputed default — what an
   * omitted field settles at (ruling Q2 on PR #965); on a settled case, what it
   * settled at, with `cap` equal to `approved` and a charge settled at 0 left
   * out (ruling Q4: the cap at settlement is in the `return.settled` audit
   * entry). Absent when there is none, so a business customer's or a partial
   * case shows nothing.
   */
  #prefillCharges(rc: ReturnCase, charges: CaseChargeRefunds | null): Pick<SettlementPrefill, 'charges'> {
    const out: NonNullable<SettlementPrefill['charges']> = {};
    const one = (key: 'delivery' | 'surcharge', approved: string) => {
      if (charges) {
        const recomputed = charges[key];
        if (compareDecimals(recomputed.cap, 0) <= 0) return;
        out[key] = { cap: Number(recomputed.cap), approved: Number(recomputed.default) };
        return;
      }
      if (rc.resolutionType == null) return;
      if (compareDecimals(approved, 0) > 0) out[key] = { cap: Number(approved), approved: Number(approved) };
    };
    one('delivery', rc.approvedDeliveryRefund);
    one('surcharge', rc.approvedSurchargeRefund);
    return Object.keys(out).length > 0 ? { charges: out } : {};
  }

  /**
   * The order's charges `rc` refunds, recomputed on the settled basis (issue
   * #876): the cap and the default of the delivery and of the surcharge, over
   * the same cases as the goods ({@link caseCharges}). The window is the case's:
   * the channel's free-return window it was opened in, or the statutory 14 days
   * from the order's completing status.
   */
  async #charges(
    rc: ReturnCase,
    items: readonly ReturnCaseItem[],
    context: OrderReturnContext,
    history: OrderCases,
  ): Promise<CaseChargeRefunds> {
    return caseCharges({
      context,
      history,
      basis: 'settled',
      excludeCaseId: rc.id,
      kind: rc.kind,
      current: items.map((it) => ({ orderItemId: it.orderItemId, quantity: it.quantity })),
      isPersonal: (await this.deps.isPersonalOrganization?.(context.organizationId, context.placedAt)) ?? false,
      withinWindow: isWithinWithdrawalWindow({
        freeReturnEligible: rc.freeReturnEligible,
        submittedAt: rc.submittedAt,
        completingAt: withdrawalPeriodAnchor(context),
        timeZone: await this.deps.resolveTimeZone(context.salesChannelId),
      }),
    });
  }

  /**
   * The default of each line of `rc`, recomputed from the order's other cases
   * on the settled basis (issues #874, #875): the kept state is the returns
   * settled with money, and a complaint settled with money counts against
   * what is left paid and against its line. `null` when the order cannot be
   * read: the prefill then shows the stored figures, and the settlement has
   * already refused.
   */
  async #recompute(
    em: EntityManager,
    rc: ReturnCase,
    items: readonly ReturnCaseItem[],
    known?: OrderReturnContext,
    loaded?: OrderCases,
  ): Promise<Map<string, LineDefault> | null> {
    const context = known ?? (await this.deps.orderContext.getReturnContext(rc.orderId));
    if (!context) return null;
    const history = loaded ?? (await loadOrderCases(em, rc.orderId));
    const computed = caseDefaults({
      context,
      history,
      basis: 'settled',
      excludeCaseId: rc.id,
      kind: rc.kind,
      current: items.map((it) => ({ orderItemId: it.orderItemId, quantity: it.quantity })),
    });
    const returnable = new Map(context.lines.map((l) => [l.orderItemId, isLineReturnable(l.returnableAtPurchase)]));
    return new Map(
      items.map((it, i) => {
        const c = computed[i]!;
        return [
          it.id,
          { refund: c.refund, discount: c.discount, effective: c.effective, returnable: returnable.get(it.orderItemId) ?? true },
        ] as const;
      }),
    );
  }

  /** What `requested` settles at on line `it`, against its recomputed default ({@link settlementApproved}). */
  #approved(rc: ReturnCase, it: ReturnCaseItem, d: LineDefault, requested: string | number) {
    return settlementApproved({
      requested,
      previousDefault: it.defaultRefundAmount,
      recomputedDefault: d.refund,
      effectiveDefault: d.effective,
      zeroIsAmount: rc.kind === 'complaint' && !d.returnable,
    });
  }

  /**
   * One settlement of an order at a time (issue #417, review of PR #423): a
   * correction reads the earlier corrections of the invoice — the cap and the
   * cumulative nets — so two cases of one order settled at once would both read
   * the same ones. The lock is the one case creation takes, keyed by the order,
   * held on a connection of its own for the whole settlement: the ports keep
   * their own units of work, so the ordering law below is unchanged. A
   * settlement that waits longer than {@link SETTLEMENT_LOCK_TIMEOUT} for it is
   * refused as retryable, with nothing written, rather than holding a
   * connection the one it waits for may need.
   */
  async settle(id: string, adminUserId: string, input: SettlementRequest): Promise<SettlementResult> {
    const em = this.deps.emFactory();
    if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const rc = await em.findOne(ReturnCase, { id });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    return em.getKnex().transaction(async (lock) => {
      await lock.raw(`set local lock_timeout = '${SETTLEMENT_LOCK_TIMEOUT}'`);
      try {
        await lock.raw('select pg_advisory_xact_lock(hashtext(?))', [returnCaseOrderLockKey(rc.orderId)]);
      } catch (err) {
        if ((err as { code?: string }).code !== LOCK_NOT_AVAILABLE) throw err;
        throw new HttpError(
          409,
          ERROR_CODES.RETURN_SETTLEMENT_IN_PROGRESS,
          'Another return of this order is being settled. Try again in a moment.',
          { orderId: rc.orderId },
        );
      }
      return this.#settle(id, adminUserId, input);
    });
  }

  async #settle(id: string, adminUserId: string, input: SettlementRequest): Promise<SettlementResult> {
    // Read again under the lock: a settlement that waited sees what the one it
    // waited for wrote — the case it may have resolved, the correction it issued.
    const em = this.deps.emFactory();
    if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const rc = await em.findOne(ReturnCase, { id });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');

    // The default is recomputed from the order (issue #875), so an order that
    // cannot be read refuses the settlement, before any effect and with nothing
    // written — as case creation does. A switched-off `orders` throws its own
    // `ModuleDisabledError` (503), which is never caught here.
    const context = await this.deps.orderContext.getReturnContext(rc.orderId);
    if (!context) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Order not found.');

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
    // Issue #905 (design D1) — a consumer withdrawal settles otherwise than by
    // a refund only with the consumer's consent to that resolution on record.
    if (resolutionNeedsConsent(consentStateOf(rc), input.resolutionType)) {
      throw new HttpError(
        422,
        ERROR_CODES.RETURN_ALTERNATIVE_RESOLUTION_CONSENT_REQUIRED,
        `A consumer withdrawal is settled as a refund unless the consumer has agreed to a ${input.resolutionType}. Record their consent first.`,
        { resolution: input.resolutionType },
      );
    }
    const withdrawalAudit = await this.#withdrawalAudit(rc, input);

    // Step 1 — validate. The approved amounts are computed into a map and
    // **not** assigned: an assignment on a managed entity is a write the next
    // flush carries, and under the ordering law nothing is written until step 4.
    const items = await em.find(ReturnCaseItem, { returnCaseId: id });
    const byId = new Map(items.map((it) => [it.id, it]));
    const requestedByItemId = new Map<string, number>();
    for (const line of input.lines) {
      if (!byId.has(line.returnCaseItemId)) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Unknown return line.', {
          code: 'unknown_line',
        });
      }
      requestedByItemId.set(line.returnCaseItemId, line.approvedRefundAmount);
    }
    // The default, recomputed under the lock from the cases settled by now
    // (issue #875): a case settled out of creation order, or after an earlier
    // case was rejected, refunds what leaves the kept goods' invoice equal to
    // what is left paid, and a complaint is outside the kept state (issue
    // #874), bounded with the returns of its line by what the line was paid
    // (the line ceiling).
    const history = await loadOrderCases(em, rc.orderId);
    const recomputed = await this.#recompute(em, rc, items, context, history);
    const defaultOf = (it: ReturnCaseItem): LineDefault =>
      recomputed?.get(it.id) ?? {
        refund: roundHalfUp(it.defaultRefundAmount),
        discount: roundHalfUp(it.defaultDiscountAmount),
        effective: roundHalfUp(it.defaultRefundAmount),
        returnable: true,
      };
    // What this settlement refunds, over **every** line of the case: a line the
    // request leaves out settles at its stored approved amount, and the
    // correction below credits it at that amount, so the refund and the
    // correction come from one set of lines (review of PR #423, B1). An amount
    // equal to a default is the default approved, and settles at the
    // recomputed one; a lower one is kept as typed; anything else is refused.
    const approvedByItemId = new Map<string, number>();
    for (const it of items) {
      const requested = requestedByItemId.get(it.id) ?? it.approvedRefundAmount;
      const outcome = this.#approved(rc, it, defaultOf(it), requested);
      if ('refused' in outcome) {
        // The amounts are two-decimal strings: the envelope fills a placeholder
        // with `String(value)` (issue #625).
        throw new HttpError(
          422,
          ERROR_CODES.RETURN_REFUND_EXCEEDS_PAID,
          'Refund amount cannot exceed the amount paid for the line.',
          {
            returnCaseItemId: it.id,
            requested: approvedAmount(requested),
            maximum: approvedAmount(defaultOf(it).effective),
            currency: rc.currency,
          },
        );
      }
      // At the two places it is stored at, half-up (issue #417).
      approvedByItemId.set(it.id, Number(outcome.approved));
    }
    const approvedOf = (it: ReturnCaseItem): number => approvedByItemId.get(it.id)!;
    // Issue #876 — the order's delivery cost and payment surcharge, recomputed
    // under the lock from the cases settled by now: only a consumer's
    // withdrawal that completes the order has a cap above 0, and within the
    // window its default is the cap. An omitted amount settles at the
    // recomputed default; a present one exactly as sent, 0 included, when it
    // is within the cap (ruling Q2 on PR #965; art. 13(2)); anything above the
    // cap is refused — a partial case cannot be given a charge (ruling E1).
    // A replacement or a repair is not a withdrawal: the buyer keeps the
    // goods, so its cap is 0 (ruling Q1) and an amount above 0 is refused.
    const withdraws = input.resolutionType === 'refund' || input.resolutionType === 'credit';
    const NO_CHARGE: ChargeRefund = { cap: '0.00', default: '0.00' };
    const recomputedCharges = await this.#charges(rc, items, context, history);
    const charges: CaseChargeRefunds = withdraws ? recomputedCharges : { delivery: NO_CHARGE, surcharge: NO_CHARGE };
    const chargeOutcome = (
      charge: 'delivery' | 'surcharge',
      requested: number | undefined,
      recomputed: ChargeRefund,
    ): string => {
      const outcome = chargeApproved({ requested, recomputed });
      if ('refused' in outcome) {
        // The line's code, with the charge as the token that picks its sentence.
        throw new HttpError(
          422,
          ERROR_CODES.RETURN_REFUND_EXCEEDS_PAID,
          'Refund amount cannot exceed what was paid for the charge.',
          {
            code: charge,
            requested: roundHalfUp(requested ?? 0),
            maximum: roundHalfUp(recomputed.cap),
            currency: rc.currency,
          },
        );
      }
      return outcome.approved;
    };
    const deliveryRefund = chargeOutcome('delivery', input.deliveryRefundAmount, charges.delivery);
    const surchargeRefund = chargeOutcome('surcharge', input.surchargeRefundAmount, charges.surcharge);
    // What the money moves: the goods, plus the charges (issue #876) — so on a
    // consumer's completing withdrawal it is more than the sum of the lines.
    const total = sumApproved([...items.map(approvedOf), deliveryRefund, surchargeRefund]);
    // Which charges were refunded, by kind — never how much (#470, D-288: the
    // audit log is read without the Organization's reach).
    const refundedCharges = (
      [
        ['delivery', deliveryRefund],
        ['surcharge', surchargeRefund],
      ] as const
    )
      .filter(([, approved]) => compareDecimals(approved, 0) > 0)
      .map(([kind]) => kind);
    const chargesAudited = refundedCharges.length > 0 ? { refundedCharges } : {};
    // What the audit entry records of the recompute: which line's default
    // moved, and which line the ceiling bound — by id, never by amount (#470).
    const recomputedDefaultItemIds = items
      .filter((it) => compareDecimals(defaultOf(it).refund, it.defaultRefundAmount) !== 0)
      .map((it) => it.id);
    const ceilingBoundItemIds = items
      .filter((it) => compareDecimals(defaultOf(it).effective, defaultOf(it).refund) < 0)
      .map((it) => it.id);

    const movesMoney = input.resolutionType === 'refund' || input.resolutionType === 'credit';

    // The correction this settlement will ask for, built once and validated
    // **before** any money moves (issue #417, review of PR #423): a correction
    // that cannot be made must never follow a refund that was.
    const wantsCorrection = movesMoney && (input.createCorrectiveInvoice ?? true);
    // A complaint settled with money is a price reduction of goods the buyer
    // keeps (issue #885, product-owner ruling of 2026-11-07): it credits no
    // quantity and carries no discount, because the discount stays with the
    // kept goods. A complaint resolved by replacement or repair moves no money
    // and asks for no correction.
    const priceReduction = rc.kind === 'complaint';
    const correctionInput: CorrectiveInvoiceInput = {
      orderId: rc.orderId,
      lines: items.map((it) => {
        // The approved amount for this settlement, which is not on the row
        // yet: the rows are written in step 4.
        const amount = approvedOf(it);
        const line = {
          // The order item is what ties this credit to the invoice line it
          // corrects, so the correction can mirror that line's VAT rate.
          orderItemId: it.orderItemId,
          productName: it.productName,
          quantity: it.quantity,
          amount,
        };
        if (priceReduction) return { ...line, basis: 'price_reduction' as const };
        // Against the effective default: a return approved at it carries its
        // full default discount, because the goods leave and their share of
        // the discount leaves with them (the #885 amendment, section 4).
        const d = defaultOf(it);
        const discount = carriedDiscount(d.discount, d.effective, amount);
        return {
          ...line,
          basis: 'returned_goods' as const,
          // The order-level discount this amount carries (issue #417).
          ...(compareDecimals(discount, 0) > 0 ? { discount: Number(discount) } : {}),
        };
      }),
      total,
      currency: rc.currency,
      // One correction per return case, however often the settlement is
      // retried. Not per order: a second partial return against the same
      // order is a different case and gets its own document.
      idempotencyKey: rc.id,
      // The case a price-reduction line names (issue #885).
      ...(priceReduction && rc.rmaNumber ? { caseReference: rc.rmaNumber } : {}),
      // Issue #876 — the charges a consumer's completing withdrawal refunds,
      // credited on the invoice's delivery and surcharge lines.
      ...(compareDecimals(deliveryRefund, 0) > 0 || compareDecimals(surchargeRefund, 0) > 0
        ? {
            charges: {
              ...(compareDecimals(deliveryRefund, 0) > 0 ? { delivery: Number(deliveryRefund) } : {}),
              ...(compareDecimals(surchargeRefund, 0) > 0 ? { surcharge: Number(surchargeRefund) } : {}),
            },
          }
        : {}),
    };
    if (wantsCorrection) await this.deps.correctiveInvoice.validateCorrection(correctionInput);

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
          // The gateway's own words travel as `failureReason`, never as the
          // sentence: they are in whatever language the provider writes
          // (issue #625).
          throw new HttpError(502, ERROR_CODES.RETURN_REFUND_GATEWAY_FAILED, 'Payment gateway rejected the refund.', {
            settlementState: gatewayOutcome.state,
            failureReason: gatewayOutcome.failureReason ?? null,
            providerDetails: gatewayOutcome.providerDetails ?? null,
          });
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

      if (wantsCorrection) correction = await this.deps.correctiveInvoice.createCorrection(correctionInput);
    }

    // Step 3 — the outcomes, as the values the row and the response carry.
    const result: SettlementResult = { totalRefundAmount: total };
    const refundFields = movesMoney
      ? {
          returnCaseId: id,
          resolutionType: (input.resolutionType === 'refund' ? 'refund' : 'credit') as
            | 'refund'
            | 'credit',
          amount: approvedAmount(total),
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
          target.totalRefundAmount = approvedAmount(total);
          // Issue #876 — the recomputed default and the approved amount of each charge.
          target.defaultDeliveryRefund = charges.delivery.default;
          target.approvedDeliveryRefund = deliveryRefund;
          target.defaultSurchargeRefund = charges.surcharge.default;
          target.approvedSurchargeRefund = surchargeRefund;
          target.resolvedAt = new Date();

          for (const it of await tx.find(ReturnCaseItem, { returnCaseId: id })) {
            const approved = approvedByItemId.get(it.id);
            if (approved !== undefined) it.approvedRefundAmount = approvedAmount(approved);
            // The recomputed default of the goods, which the next case of the
            // order reads as `earlier` (issue #875).
            const original = byId.get(it.id);
            if (original) {
              const d = defaultOf(original);
              it.defaultRefundAmount = d.refund;
              it.defaultDiscountAmount = d.discount;
            }
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
              // No amount (#470): what was refunded is on the refund and the case.
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
              ...withdrawalAudit,
              ...(recomputedDefaultItemIds.length > 0 ? { recomputedDefaultItemIds } : {}),
              ...(ceilingBoundItemIds.length > 0 ? { ceilingBoundItemIds } : {}),
              ...chargesAudited,
            },
          });
        },
      },
    );

    // Step 5 — after commit.
    this.emitSettled(rc, refund, total);
    return result;
  }

  /**
   * What the audit row says about a consumer withdrawal (issue #905, design
   * D1): that it was one, and — for a refund — whether the money went to
   * another payment method than the order's own. Not refused: a
   * cash-on-delivery order cannot be refunded by the same means.
   */
  async #withdrawalAudit(rc: ReturnCase, input: SettlementRequest): Promise<Record<string, unknown>> {
    if (rc.consumerWithdrawal !== true) return {};
    if (input.resolutionType !== 'refund') return { consumerWithdrawal: true };
    const order = await this.deps.orderContext.getReturnContext(rc.orderId);
    return {
      consumerWithdrawal: true,
      refundMethodDiffers: refundMethodDiffers(consentStateOf(rc), input.refundPaymentMethodId, order?.paymentMethodId ?? null),
    };
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

/** The two facts of a case the consent gate reads (issue #905). */
function consentStateOf(rc: ReturnCase): ConsentState {
  return {
    consumerWithdrawal: rc.consumerWithdrawal ?? null,
    alternativeConsentResolution: rc.alternativeConsentResolution ?? null,
  };
}
