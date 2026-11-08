import type { AlternativeResolution, ResolutionType } from '@endora-commerce/contracts';
import { isWithdrawalAvailableAt, type WithdrawalPeriod } from './withdrawal-period.js';

/**
 * Consumer withdrawal — pure domain (issue #905, design §2 and D1).
 *
 * **Who counts.** A case is a consumer's withdrawal from a distance contract
 * when it is a `return` (a complaint never is), its Organization is personal (a
 * company Organization never is: the platform cannot tell a sole trader buying
 * through one, Polish art. 38a, which stays out of scope), and it was filed
 * while the withdrawal function was available for the order — the statutory
 * period, the channel's longer free-return window, and the grace after both
 * (`withdrawal-period.ts`). A personal Organization's return filed after that is
 * a commercial return under the shop's own policy. The answer is stored on the
 * case when it is filed, which is when the law fixes the case's nature, so
 * every later rule reads one column. `null` on that column is a case filed
 * before the classification existed, and is read as `false`.
 *
 * **What it settles as.** A consumer who withdraws is reimbursed by the same
 * means of payment unless they expressly agree otherwise (Directive 2011/83
 * art. 13(1)). A credit, a replacement and a repair all reimburse otherwise, so
 * each needs the consumer's consent **to that resolution** on record; a refund
 * never does.
 */

/** Every resolution but a refund: each needs the consumer's consent on a consumer withdrawal. */
export const ALTERNATIVE_RESOLUTIONS: readonly AlternativeResolution[] = ['credit', 'replacement', 'repair'];

export interface ConsumerWithdrawalFacts {
  readonly kind: 'return' | 'complaint';
  /** The case's Organization is personal (B2C), as `organizations` reports it. */
  readonly organizationIsPersonal: boolean;
  /** The order's withdrawal period (`withdrawalPeriod`). */
  readonly period: WithdrawalPeriod;
  /** When the case is filed. */
  readonly submittedAt: Date;
}

/** Whether a case filed with these facts is a consumer withdrawal. */
export function classifyConsumerWithdrawal(facts: ConsumerWithdrawalFacts): boolean {
  return (
    facts.kind === 'return' &&
    facts.organizationIsPersonal &&
    isWithdrawalAvailableAt(facts.period, facts.submittedAt)
  );
}

/** The two facts of a case the consent gate reads. */
export interface ConsentState {
  /** `null` = filed before the classification existed; read as `false`. */
  readonly consumerWithdrawal: boolean | null;
  readonly alternativeConsentResolution: AlternativeResolution | null;
}

/** The resolution a settlement starts on. */
export function defaultResolution(): ResolutionType {
  return 'refund';
}

/** The resolutions the case cannot settle as until the consumer's consent to them is recorded. */
export function consentRequiredFor(state: ConsentState): AlternativeResolution[] {
  if (state.consumerWithdrawal !== true) return [];
  return ALTERNATIVE_RESOLUTIONS.filter((resolution) => resolution !== state.alternativeConsentResolution);
}

/** Whether settling the case as `resolution` needs a consent that is not on record. */
export function resolutionNeedsConsent(state: ConsentState, resolution: ResolutionType): boolean {
  return (consentRequiredFor(state) as ResolutionType[]).includes(resolution);
}

/**
 * Whether a consumer withdrawal is refunded to another payment method than the
 * order's own. Not refused — a cash-on-delivery order cannot be refunded "by the
 * same means", and a bank transfer is the accepted practice there — but
 * recorded in the settlement's audit row. `null` where the rule does not apply:
 * not a consumer withdrawal, or the order's method is not known.
 */
export function refundMethodDiffers(
  state: Pick<ConsentState, 'consumerWithdrawal'>,
  chosenPaymentMethodId: string | null | undefined,
  orderPaymentMethodId: string | null,
): boolean | null {
  if (state.consumerWithdrawal !== true || orderPaymentMethodId === null) return null;
  return (chosenPaymentMethodId ?? null) !== orderPaymentMethodId;
}

/** Why a consent dated `consentGivenAt` cannot be recorded, or `null` when it can. */
export function consentDateRefusal(
  consentGivenAt: Date,
  submittedAt: Date,
  now: Date,
): 'consent_in_future' | 'consent_before_submission' | null {
  if (consentGivenAt.getTime() > now.getTime()) return 'consent_in_future';
  if (consentGivenAt.getTime() < submittedAt.getTime()) return 'consent_before_submission';
  return null;
}
