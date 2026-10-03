import type { OrderTransitionEffectKind } from '@endora-commerce/contracts';
import type { OrderTransitionEffectReason } from '../entities/order-transition-effect.entity.js';
import { mayHoldCreditLimitReservation } from './credit-limit-reservation.js';

/**
 * Which follow-ups a transition owes — decided from state `orders` owns, and
 * from nothing else (`specs/142-order-transition-atomicity/`, D2).
 *
 * `orders` decides *that* something is owed: the status it is writing and
 * `paymentMethodSnapshot.kind`, its own record of whether placement drew
 * credit. The owner decides *how* it is released, behind its port. Neither
 * function here asks whether the owner is present — a release is owed whether
 * or not its owner can perform it right now, and writing the row regardless is
 * exactly what lets a module that is switched off give the stock or the credit
 * back once it returns.
 *
 * Pure, so the rule can be read and tested without a database.
 */

export interface OwedEffect {
  readonly effect: OrderTransitionEffectKind;
  readonly reason: OrderTransitionEffectReason;
}

/** The order facts the rule reads. An `Order` entity satisfies it. */
export interface EffectSubject {
  paymentMethodSnapshot?: { kind?: string } | null;
}

/**
 * The module each release belongs to — the one whose presence decides whether
 * the release can run now or has to wait.
 */
const EFFECT_OWNERS: Readonly<Record<OrderTransitionEffectKind, string>> = {
  'stock.release': 'inventory',
  'credit.release': 'credit_limits',
};

export function ownerOfEffect(effect: OrderTransitionEffectKind): string {
  return EFFECT_OWNERS[effect];
}

/**
 * A lifecycle transition to `to`.
 *
 * Keyed to the `cancelled` system status, as the hook this replaces was: a
 * deployment that adds terminal statuses of its own does not widen it. The
 * stock release is owed by **every** cancellation — also by an order placed
 * while `inventory` was off, whose release then completes having released
 * nothing — because `orders` cannot know what `inventory` holds without asking
 * it. The credit release is owed only by an order that can hold a reservation.
 *
 * The lifecycle status `paid` owes nothing: only the *payment* status releases
 * credit, and this feature keeps that asymmetry rather than widening it.
 */
export function effectsOwedByStatusTransition(order: EffectSubject, to: string): OwedEffect[] {
  if (to !== 'cancelled') return [];
  const owed: OwedEffect[] = [{ effect: 'stock.release', reason: 'order_cancelled' }];
  if (mayHoldCreditLimitReservation(order)) {
    owed.push({ effect: 'credit.release', reason: 'order_cancelled' });
  }
  return owed;
}

/** A payment-status change to `to`. */
export function effectsOwedByPaymentStatusChange(order: EffectSubject, to: string): OwedEffect[] {
  if (to !== 'paid' || !mayHoldCreditLimitReservation(order)) return [];
  return [{ effect: 'credit.release', reason: 'invoice_paid' }];
}
