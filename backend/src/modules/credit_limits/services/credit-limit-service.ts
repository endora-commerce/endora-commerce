import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import type { EventBase, EventBus } from '../../../events/bus.js';
import type { Command, CommandBus } from '../../../commands/index.js';
import { CreditLimit } from '../entities/credit-limit.entity.js';
import { CreditLimitReservation } from '../entities/credit-limit-reservation.entity.js';
import { CreditLimitReturnTopup } from '../entities/credit-limit-return-topup.entity.js';
import type { CreditTopupResult, OrganizationInheritancePort } from '@endora-commerce/contracts';

/**
 * CreditLimitService (T214) — implements the contract documented in
 * specs/001-b2b-platform-foundation/contracts/credit_limits.contract.md.
 *
 * - reserve: SELECT … FOR UPDATE on the credit_limits row to serialise
 *   concurrent placers (R-10, SC-011 zero-silent-breach). Returns a
 *   discriminated-union result instead of throwing — the caller (place-order
 *   path) maps `LIMIT_INSUFFICIENT` to a 409 response.
 * - releaseByOrder: idempotent — second call for the same order returns
 *   { ok: false, code: 'ALREADY_RELEASED' } rather than re-crediting.
 *
 * Both methods may be called inside an outer transaction or alone; the
 * service's `tx` factory parameter lets the caller pass its own EM.
 */

export interface CreditLimitEvents extends Record<string, EventBase> {
  'credit_limit.granted.v1': EventBase & { organizationId: string; amount: number };
  'credit_limit.adjusted.v1': EventBase & { organizationId: string; amount: number };
  'credit_limit.revoked.v1': EventBase & { organizationId: string };
  'credit_limit.reserved.v1': EventBase & {
    organizationId: string;
    orderId: string;
    amount: number;
  };
  'credit_limit.released.v1': EventBase & {
    organizationId: string;
    orderId: string;
    amount: number;
    reason: string;
  };
}
export type CreditLimitEventBus = EventBus<CreditLimitEvents>;

export type ReserveResult =
  | { ok: true; reservationId: string; availableAmountAfter: number }
  | { ok: false; code: 'LIMIT_INSUFFICIENT'; availableAmount: number }
  | { ok: false; code: 'CREDIT_LIMIT_NOT_GRANTED' }
  | { ok: false; code: 'CURRENCY_MISMATCH' };

export type ReleaseResult =
  | { ok: true; reservationId: string; availableAmountAfter: number }
  | { ok: false; code: 'RESERVATION_NOT_FOUND' | 'ALREADY_RELEASED' };

export type AdjustResult =
  | { ok: true; limit: CreditLimit }
  | { ok: false; code: 'ADJUSTMENT_BELOW_ACTIVE' };

/**
 * What `creditFromReturn` answers (D-91).
 *
 * `CreditTopupResult` — the shape `returns` states and this module satisfies —
 * plus the one fact the port does not carry: whether this call is the one that
 * moved the grant. A retried settlement is `applied: true, alreadyApplied:
 * true`, which is what keeps the audit row and the domain event to one per
 * return case while the caller still sees a credited return.
 */
export interface CreditFromReturnResult extends CreditTopupResult {
  alreadyApplied: boolean;
}

export class CreditLimitService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: CreditLimitEventBus,
    /**
     * Feature 054 — when injected, `adjust` runs through the Command Bus so the
     * mutation is audited co-transactionally (Principle XIII). Optional: existing
     * tests construct this service without a bus and keep the legacy (unaudited)
     * path, which stays byte-identical.
     */
    private readonly commandBus?: CommandBus,
    /**
     * Feature 056 — organizations-owned resolution port. When injected, a
     * descendant with no own `CreditLimit` row transacts against the nearest
     * ancestor's per the effective mode (shared_pool / independent_default).
     * Absent ⇒ flat behavior (byte-for-byte the pre-feature single-org path).
     */
    private readonly inheritance?: OrganizationInheritancePort,
  ) {}

  async getForOrganization(organizationId: string): Promise<CreditLimit | null> {
    const em = this.emFactory();
    const own = await em.findOne(CreditLimit, { organizationId });
    if (own || !this.inheritance) return own;
    // Feature 056 — fall back to the nearest ancestor holding a limit. The owner
    // may lie outside the caller's tenant scope, so the org filter is disabled
    // for this resolution read (the reserve/enforcement path is separate).
    const { ownerOrgId } = await this.inheritance.creditOwner(organizationId);
    if (!ownerOrgId || ownerOrgId === organizationId) return null;
    return em.findOne(
      CreditLimit,
      { organizationId: ownerOrgId },
      { filters: { org: false } },
    );
  }

  async listAll(): Promise<CreditLimit[]> {
    const em = this.emFactory();
    return em.find(CreditLimit, {}, { orderBy: { createdAt: 'desc' } });
  }

  async listActiveReservations(creditLimitId: string): Promise<CreditLimitReservation[]> {
    const em = this.emFactory();
    return em.find(CreditLimitReservation, { creditLimitId, status: 'active' });
  }

  async grant(input: {
    organizationId: string;
    grantedAmount: number;
    currency: string;
    grantedByAdminUserId?: string;
  }): Promise<CreditLimit> {
    // Feature 054 — audited path via the Command Bus (one co-transactional audit
    // row + the event on commit). Legacy fallback for bus-less constructions.
    if (this.commandBus) return this.commandBus.run(this.#grantCommand(input));
    const em = this.emFactory();
    const limit = this.#applyGrant(em, input);
    await em.flush();
    this.#emitGranted(input);
    return limit;
  }

  #grantCommand(input: {
    organizationId: string;
    grantedAmount: number;
    currency: string;
    grantedByAdminUserId?: string;
  }): Command<CreditLimit> {
    return {
      action: 'credit_limit.grant',
      objectType: 'credit_limit',
      objectId: input.organizationId,
      run: async ({ em }) => {
        const limit = this.#applyGrant(em, input);
        return {
          result: limit,
          after: {
            organizationId: input.organizationId,
            grantedAmount: limit.grantedAmount,
            currency: input.currency,
          },
        };
      },
      event: () => ({
        eventName: 'credit_limit.granted.v1',
        payload: {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          organizationId: input.organizationId,
          amount: input.grantedAmount,
        },
      }),
    };
  }

  /**
   * Pure grant write on the given em — creates the row (auto-persisted via
   * MikroORM `persistOnCreate`; no explicit flush), no event. The caller's
   * transaction (Command Bus) or explicit `flush` commits it.
   */
  #applyGrant(
    em: EntityManager,
    input: { organizationId: string; grantedAmount: number; currency: string; grantedByAdminUserId?: string },
  ): CreditLimit {
    return em.create(CreditLimit, {
      organizationId: input.organizationId,
      grantedAmount: input.grantedAmount.toFixed(2),
      currency: input.currency,
      ...(input.grantedByAdminUserId !== undefined
        ? { grantedByAdminUserId: input.grantedByAdminUserId }
        : {}),
    });
  }

  #emitGranted(input: { organizationId: string; grantedAmount: number }): void {
    this.events.emit('credit_limit.granted.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      organizationId: input.organizationId,
      amount: input.grantedAmount,
    });
  }

  async adjust(input: {
    organizationId: string;
    grantedAmount: number;
    allowOverAllocation?: boolean;
  }): Promise<AdjustResult> {
    // Feature 054 — audited path: the Command Bus records the mutation
    // co-transactionally and dispatches the event on commit.
    if (this.commandBus) {
      return this.commandBus.run(this.#adjustCommand(input));
    }
    // Legacy fallback (no bus injected — e.g. unit tests): unaudited, but
    // byte-identical to the pre-054 behavior.
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const r = await this.#applyAdjust(tx, input);
      if (r.result.ok) this.#emitAdjusted(input);
      return r.result;
    });
  }

  /** The `adjust` write expressed as a Command (audited via the bus). */
  #adjustCommand(input: {
    organizationId: string;
    grantedAmount: number;
    allowOverAllocation?: boolean;
  }): Command<AdjustResult> {
    return {
      action: 'credit_limit.adjust',
      objectType: 'credit_limit',
      objectId: input.organizationId,
      run: async ({ em }) => {
        const r = await this.#applyAdjust(em, input);
        if (!r.result.ok) {
          // No mutation happened → commit without an audit row.
          return { result: r.result, skipAudit: true };
        }
        return { result: r.result, before: r.before ?? null, after: r.after ?? null };
      },
      event: (result) =>
        result.ok
          ? {
              eventName: 'credit_limit.adjusted.v1',
              payload: {
                eventId: randomUUID(),
                occurredAt: new Date().toISOString(),
                organizationId: input.organizationId,
                amount: input.grantedAmount,
              },
            }
          : undefined,
    };
  }

  /**
   * Pure adjust write on the given em — no audit, no event. Returns the caller
   * result plus the before/after snapshot for auditing. The pessimistic lock and
   * over-allocation guard are preserved exactly.
   */
  async #applyAdjust(
    em: EntityManager,
    input: { organizationId: string; grantedAmount: number; allowOverAllocation?: boolean },
  ): Promise<{
    result: AdjustResult;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }> {
    const limit = await em.findOne(
      CreditLimit,
      { organizationId: input.organizationId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!limit) {
      // Caller maps to 404; we don't have a separate "not granted" code in
      // this enum — the route will translate.
      throw new Error('CREDIT_LIMIT_NOT_GRANTED');
    }
    const reservedSum = await this.#sumActiveReservations(em, limit.id);
    if (!input.allowOverAllocation && input.grantedAmount < reservedSum) {
      return { result: { ok: false, code: 'ADJUSTMENT_BELOW_ACTIVE' } };
    }
    const before = { organizationId: input.organizationId, grantedAmount: limit.grantedAmount };
    limit.grantedAmount = input.grantedAmount.toFixed(2);
    const after = { organizationId: input.organizationId, grantedAmount: limit.grantedAmount };
    return { result: { ok: true, limit }, before, after };
  }

  /**
   * Credit an organization's grant for a settled return, **once per return
   * case** (D-91).
   *
   * The settlement ordering law attempts every external effect before it writes
   * any state, so a refusal from a later step leaves a case an admin can settle
   * again — and the retry arrives here with the same `returnCaseId`. Until D-91
   * this method's caller read the grant and added to it, ignoring the
   * `returnCaseId` it was already being handed, so the second attempt credited
   * the organization a second time.
   *
   * The credit and the `credit_limit_return_topups` row are written by one
   * Command, so they commit together: the fact that a case was credited cannot
   * outlive the credit, and the credit cannot outlive the fact. The unique
   * index on `return_case_id` settles two concurrent retries.
   */
  async creditFromReturn(input: {
    organizationId: string;
    amount: number;
    currency: string;
    returnCaseId: string;
  }): Promise<CreditFromReturnResult> {
    if (this.commandBus) {
      return this.commandBus.run(this.#creditFromReturnCommand(input));
    }
    // Legacy fallback (no bus injected — e.g. unit tests): the same write,
    // unaudited, in the same single transaction.
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const applied = await this.#applyCreditFromReturn(tx, input);
      if (applied.result.applied && !applied.result.alreadyApplied) {
        this.#emitAdjusted({
          organizationId: input.organizationId,
          grantedAmount: applied.result.availableAmountAfter ?? 0,
        });
      }
      return applied.result;
    });
  }

  /** The `creditFromReturn` write expressed as a Command (audited via the bus). */
  #creditFromReturnCommand(input: {
    organizationId: string;
    amount: number;
    currency: string;
    returnCaseId: string;
  }): Command<CreditFromReturnResult> {
    return {
      action: 'credit_limit.credit_from_return',
      objectType: 'credit_limit',
      objectId: input.organizationId,
      run: async ({ em }) => {
        const applied = await this.#applyCreditFromReturn(em, input);
        // Nothing moved: the organization has no grant, or this case was
        // already credited. Commit without an audit row, as `adjust` does.
        if (!applied.result.applied || applied.result.alreadyApplied) {
          return { result: applied.result, skipAudit: true };
        }
        return {
          result: applied.result,
          before: applied.before ?? null,
          after: applied.after ?? null,
        };
      },
      event: (result) =>
        result.applied && !result.alreadyApplied
          ? {
              eventName: 'credit_limit.adjusted.v1',
              payload: {
                eventId: randomUUID(),
                occurredAt: new Date().toISOString(),
                organizationId: input.organizationId,
                amount: result.availableAmountAfter ?? 0,
              },
            }
          : undefined,
    };
  }

  /**
   * Pure credit-from-return write on the given em — no audit, no event.
   *
   * The marker row is read first: an organization that has already been
   * credited for this case is answered with the grant as it stands, so a retry
   * is a no-op rather than a second credit. The grant itself is read under the
   * same pessimistic lock `adjust` uses, and the over-allocation guard does not
   * apply — a credit raises the grant, so it can never fall below what is
   * already reserved.
   */
  async #applyCreditFromReturn(
    em: EntityManager,
    input: { organizationId: string; amount: number; currency: string; returnCaseId: string },
  ): Promise<{
    result: CreditFromReturnResult;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  }> {
    const alreadyCredited = await em.findOne(CreditLimitReturnTopup, {
      returnCaseId: input.returnCaseId,
    });
    if (alreadyCredited) {
      const limit = await em.findOne(CreditLimit, { organizationId: input.organizationId });
      return {
        result: {
          applied: true,
          alreadyApplied: true,
          ...(limit ? { availableAmountAfter: Number(limit.grantedAmount) } : {}),
        },
      };
    }

    const limit = await em.findOne(
      CreditLimit,
      { organizationId: input.organizationId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    // No grant to credit. A declared outcome, not a failure: the settlement
    // records `pending_manual` and an operator settles it out of band.
    if (!limit) return { result: { applied: false, alreadyApplied: false } };

    const before = { organizationId: input.organizationId, grantedAmount: limit.grantedAmount };
    const newAmount = this.#round2(Number(limit.grantedAmount) + input.amount);
    limit.grantedAmount = newAmount.toFixed(2);
    em.persist(
      em.create(CreditLimitReturnTopup, {
        returnCaseId: input.returnCaseId,
        organizationId: input.organizationId,
        amount: input.amount.toFixed(2),
        currency: input.currency,
      }),
    );
    return {
      result: { applied: true, alreadyApplied: false, availableAmountAfter: newAmount },
      before,
      after: {
        organizationId: input.organizationId,
        grantedAmount: limit.grantedAmount,
        returnCaseId: input.returnCaseId,
      },
    };
  }

  #emitAdjusted(input: { organizationId: string; grantedAmount: number }): void {
    this.events.emit('credit_limit.adjusted.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      organizationId: input.organizationId,
      amount: input.grantedAmount,
    });
  }

  async reserve(input: {
    organizationId: string;
    orderId: string;
    amount: number;
    currency: string;
    /**
     * The order-placement transaction. **Required** since D-94.5: the one
     * caller always passed it, and the optional shape is what let this method
     * double as a standalone transaction — a lie about the seam.
     * `credit_limit_reservations_order_fk` (`on delete restrict`) means the
     * reservation row cannot exist before the order does, and the
     * `PESSIMISTIC_WRITE` this takes on the organization's credit row has to
     * be held until placement commits or credit is consumed for an order that
     * rolled back.
     */
    tx: EntityManager;
  }): Promise<ReserveResult> {
    // `reserve` runs inside the caller's order-placement transaction — since
    // D-94.5 that is structural rather than conditional, because `tx` is
    // required — and is a system operation, not an admin action; the credit movement
    // is captured by the credit_limit.reserved.v1 event and the reservation row,
    // not the admin audit log. The exemption itself sits on `#reserveFlat` and
    // `#reserveInherited`, which are where the write is — a marker here guarded
    // nothing, and since D-89(c) the staleness half says so instead of counting
    // it as a live exemption.
    return this.inheritance
      ? this.#reserveInherited(input.tx, input)
      : this.#reserveFlat(input.tx, input);
  }

  /** Pre-feature flat reservation — locks the org's own row (unchanged). */
  async #reserveFlat(
    em: EntityManager,
    input: { organizationId: string; orderId: string; amount: number; currency: string },
  ): Promise<ReserveResult> {
    // command-coverage-ignore: reservation path invoked by reserve() inside the
    // caller's order-placement transaction — a system operation, not an admin
    // action. The credit movement is captured by the credit_limit.reserved.v1
    // event and the reservation row, not the admin audit log.
    const limit = await em.findOne(
      CreditLimit,
      { organizationId: input.organizationId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!limit) return { ok: false, code: 'CREDIT_LIMIT_NOT_GRANTED' as const };
    if (limit.currency !== input.currency) {
      return { ok: false, code: 'CURRENCY_MISMATCH' as const };
    }
    const granted = Number(limit.grantedAmount);
    const reservedSum = await this.#sumActiveReservations(em, limit.id);
    const available = granted - reservedSum;
    if (available < input.amount) {
      return { ok: false, code: 'LIMIT_INSUFFICIENT' as const, availableAmount: available };
    }
    const reservation = em.create(CreditLimitReservation, {
      creditLimitId: limit.id,
      orderId: input.orderId,
      reservingOrganizationId: input.organizationId,
      amount: input.amount.toFixed(2),
      currency: input.currency,
      status: 'active',
    });
    await em.persistAndFlush(reservation);
    this.#emitReserved(input);
    return { ok: true, reservationId: reservation.id, availableAmountAfter: available - input.amount };
  }

  /**
   * Feature 056 — inherited reservation. Resolves the owning ancestor-or-self
   * (`creditOwner`) and the effective mode:
   *   - shared_pool: FOR-UPDATE lock on the OWNER's row; `available = granted −
   *     Σ active reservations against the owner row` (every subtree reservation
   *     references the owner row, so this sums the whole subtree). Concurrent
   *     draws serialize on the one owner row → zero double-spend (SC-004).
   *   - independent_default: lock the owner's row but sum only THIS descendant's
   *     active reservations (via `reserving_organization_id`, this module's own
   *     record of who drew each one), so each branch draws its full inherited
   *     amount without affecting siblings.
   *
   * A root org with its own limit is its own owner (shared_pool default), which
   * collapses to the flat behavior byte-for-byte.
   */
  async #reserveInherited(
    em: EntityManager,
    input: { organizationId: string; orderId: string; amount: number; currency: string },
  ): Promise<ReserveResult> {
    // command-coverage-ignore: reservation path invoked by reserve() inside the
    // caller's order-placement transaction — a system operation, not an admin
    // action. The credit movement is captured by the credit_limit.reserved.v1
    // event and the reservation row, not the admin audit log.
    const { ownerOrgId, mode } = await this.inheritance!.creditOwner(input.organizationId);
    if (!ownerOrgId) return { ok: false, code: 'CREDIT_LIMIT_NOT_GRANTED' as const };

    // Lock the owning ancestor's row FOR UPDATE. Raw SQL bypasses the @OrgScoped
    // filter (the owner may lie outside the reserving descendant's tenant scope)
    // and gives precise lock control on the money path.
    const ownerRows = (await em.getConnection().execute(
      `select "id", "granted_amount", "currency" from "credit_limits"
         where "organization_id" = ? for update`,
      [ownerOrgId],
      'all',
      em.getTransactionContext(),
    )) as Array<{ id: string; granted_amount: string; currency: string }>;
    const owner = ownerRows[0];
    if (!owner) return { ok: false, code: 'CREDIT_LIMIT_NOT_GRANTED' as const };
    if (owner.currency !== input.currency) {
      return { ok: false, code: 'CURRENCY_MISMATCH' as const };
    }

    const granted = Number(owner.granted_amount);
    const reservedSum =
      mode === 'shared_pool'
        ? await this.#sumReservationsForLimit(em, owner.id)
        : await this.#sumReservationsForOrg(em, input.organizationId);
    const available = granted - reservedSum;
    if (available < input.amount) {
      return { ok: false, code: 'LIMIT_INSUFFICIENT' as const, availableAmount: available };
    }

    const reservation = em.create(CreditLimitReservation, {
      creditLimitId: owner.id,
      orderId: input.orderId,
      reservingOrganizationId: input.organizationId,
      amount: input.amount.toFixed(2),
      currency: input.currency,
      status: 'active',
    });
    await em.persistAndFlush(reservation);
    this.#emitReserved(input);
    return { ok: true, reservationId: reservation.id, availableAmountAfter: available - input.amount };
  }

  #emitReserved(input: { organizationId: string; orderId: string; amount: number }): void {
    this.events.emit('credit_limit.reserved.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      organizationId: input.organizationId,
      orderId: input.orderId,
      amount: input.amount,
    });
  }

  /** Σ active reservations against a credit_limits row (transaction-scoped). */
  async #sumReservationsForLimit(em: EntityManager, creditLimitId: string): Promise<number> {
    const rows = (await em.getConnection().execute(
      `select coalesce(sum(amount), 0) as total
         from credit_limit_reservations
         where credit_limit_id = ? and status = 'active'`,
      [creditLimitId],
      'all',
      em.getTransactionContext(),
    )) as Array<{ total: string | number | null }>;
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Σ active reservations consumed by a specific organization, for the
   * independent_default mode. Transaction-scoped.
   *
   * Reads `reserving_organization_id`, this module's own record of who drew the
   * credit. Until feature 075 it joined `orders` for the same value — a read
   * of another module's table, taken on the money path with a
   * `PESSIMISTIC_WRITE` held on the owner's credit row, for a figure `reserve`
   * is handed by its caller and writes onto the reservation row itself.
   */
  async #sumReservationsForOrg(em: EntityManager, organizationId: string): Promise<number> {
    const rows = (await em.getConnection().execute(
      `select coalesce(sum(amount), 0) as total
         from credit_limit_reservations
         where status = 'active' and reserving_organization_id = ?`,
      [organizationId],
      'all',
      em.getTransactionContext(),
    )) as Array<{ total: string | number | null }>;
    return Number(rows[0]?.total ?? 0);
  }

  async releaseByOrder(input: {
    orderId: string;
    reason: 'invoice_paid' | 'order_cancelled' | 'admin_revocation';
  }): Promise<ReleaseResult> {
    // command-coverage-ignore: releaseByOrder is an automatic system operation
    // (invoice-paid / order-cancelled / admin-revocation) captured by the
    // credit_limit.released.v1 event and the reservation row, not the admin audit
    // log. It also runs in its own pessimistic-lock transaction.
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const reservation = await tx.findOne(
        CreditLimitReservation,
        { orderId: input.orderId },
        { orderBy: { createdAt: 'desc' }, lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!reservation) return { ok: false, code: 'RESERVATION_NOT_FOUND' as const };
      if (reservation.status !== 'active') {
        return { ok: false, code: 'ALREADY_RELEASED' as const };
      }
      const limit = await tx.findOne(
        CreditLimit,
        { id: reservation.creditLimitId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      reservation.status = 'released';
      reservation.releasedAt = new Date();
      reservation.releasedReason = input.reason;
      await tx.flush();

      const reservedSum = limit ? await this.#sumActiveReservations(tx, limit.id) : 0;
      const granted = limit ? Number(limit.grantedAmount) : 0;

      this.events.emit('credit_limit.released.v1', {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        organizationId: limit?.organizationId ?? '',
        orderId: input.orderId,
        amount: Number(reservation.amount),
        reason: input.reason,
      });
      return {
        ok: true,
        reservationId: reservation.id,
        availableAmountAfter: granted - reservedSum,
      };
    });
  }

  /** Two-decimal rounding for a money amount held as a JS number. */
  #round2(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /**
   * Σ active reservations against a credit_limits row — transaction-scoped, like
   * its two feature-056 siblings below.
   *
   * `em.execute`, not `em.getConnection().execute`: a connection carries no
   * transaction context. `releaseByOrder` flips the reservation to `released`
   * and flushes *inside* its transaction before asking this question, so read on
   * a pooled connection the sum still counted the reservation it had just
   * freed — every release understated `availableAmountAfter` by exactly the
   * amount released (issue #207).
   * `test/integration/credit_limits/release-reads-its-transaction.test.ts` is
   * that case.
   */
  async #sumActiveReservations(em: EntityManager, creditLimitId: string): Promise<number> {
    const rows = await em.execute<{ total: string | number | null }[]>(
      `select coalesce(sum(amount), 0) as total
       from credit_limit_reservations
       where credit_limit_id = ? and status = 'active'`,
      [creditLimitId],
    );
    return Number(rows[0]?.total ?? 0);
  }
}
