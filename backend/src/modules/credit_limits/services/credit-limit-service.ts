import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { LockMode } from '@mikro-orm/core';
import type { EventBase, EventBus } from '../../../events/bus.js';
import { CreditLimit } from '../entities/credit-limit.entity.js';
import { CreditLimitReservation } from '../entities/credit-limit-reservation.entity.js';

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

export class CreditLimitService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly events: CreditLimitEventBus,
  ) {}

  async getForOrganization(organizationId: string): Promise<CreditLimit | null> {
    const em = this.emFactory();
    return em.findOne(CreditLimit, { organizationId });
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
    const em = this.emFactory();
    const limit = em.create(CreditLimit, {
      organizationId: input.organizationId,
      grantedAmount: input.grantedAmount.toFixed(2),
      currency: input.currency,
      ...(input.grantedByAdminUserId !== undefined
        ? { grantedByAdminUserId: input.grantedByAdminUserId }
        : {}),
    });
    await em.persistAndFlush(limit);
    this.events.emit('credit_limit.granted.v1', {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      organizationId: input.organizationId,
      amount: input.grantedAmount,
    });
    return limit;
  }

  async adjust(input: {
    organizationId: string;
    grantedAmount: number;
    allowOverAllocation?: boolean;
  }): Promise<{ ok: true; limit: CreditLimit } | { ok: false; code: 'ADJUSTMENT_BELOW_ACTIVE' }> {
    const em = this.emFactory();
    return em.transactional(async (tx) => {
      const limit = await tx.findOne(
        CreditLimit,
        { organizationId: input.organizationId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!limit) {
        // Caller maps to 404; we don't have a separate "not granted" code in
        // this enum — the route will translate.
        throw new Error('CREDIT_LIMIT_NOT_GRANTED');
      }
      const reservedSum = await this.#sumActiveReservations(tx, limit.id);
      if (
        !input.allowOverAllocation &&
        input.grantedAmount < reservedSum
      ) {
        return { ok: false, code: 'ADJUSTMENT_BELOW_ACTIVE' as const };
      }
      limit.grantedAmount = input.grantedAmount.toFixed(2);
      await tx.flush();
      this.events.emit('credit_limit.adjusted.v1', {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        organizationId: input.organizationId,
        amount: input.grantedAmount,
      });
      return { ok: true, limit };
    });
  }

  async reserve(input: {
    organizationId: string;
    orderId: string;
    amount: number;
    currency: string;
    /** When called inside the order-placement transaction, the caller passes its tx em. */
    tx?: EntityManager;
  }): Promise<ReserveResult> {
    const run = async (em: EntityManager): Promise<ReserveResult> => {
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
        amount: input.amount.toFixed(2),
        currency: input.currency,
        status: 'active',
      });
      await em.persistAndFlush(reservation);

      this.events.emit('credit_limit.reserved.v1', {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        organizationId: input.organizationId,
        orderId: input.orderId,
        amount: input.amount,
      });
      return {
        ok: true,
        reservationId: reservation.id,
        availableAmountAfter: available - input.amount,
      };
    };

    if (input.tx) return run(input.tx);
    const em = this.emFactory();
    return em.transactional(run);
  }

  async releaseByOrder(input: {
    orderId: string;
    reason: 'invoice_paid' | 'order_cancelled' | 'admin_revocation';
  }): Promise<ReleaseResult> {
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

  async #sumActiveReservations(em: EntityManager, creditLimitId: string): Promise<number> {
    const rows = await em.getConnection().execute<{ total: string | number | null }[]>(
      `select coalesce(sum(amount), 0) as total
       from credit_limit_reservations
       where credit_limit_id = ? and status = 'active'`,
      [creditLimitId],
    );
    return Number(rows[0]?.total ?? 0);
  }
}
