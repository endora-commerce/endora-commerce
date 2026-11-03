import type { FormNotAcceptingReason, FormRestrictions, FormStatus } from '@endora-commerce/contracts';
import { formAvailability } from '../form-public-read.js';

/**
 * Whether a form takes a submission now (`specs/170-forms-module/` research R-12 step 3, FR-043).
 *
 * The same reading as the public read's `availability` (`formAvailability`), so the block and the
 * server never disagree about a form's state, plus the one rule only the request can decide:
 * signed-in-only against the actor. A form that does not exist, a draft and a form that was never
 * published are one `unavailable` — the answer tells nobody which it was (research R-11).
 */
export interface AvailabilityInput {
  readonly status: FormStatus;
  /** Whether the form serves a published version. */
  readonly hasPublishedVersion: boolean;
  /** The served version's restrictions. */
  readonly restrictions: FormRestrictions;
  readonly acceptedEntryCount: number;
  /** Whether the request's actor is a signed-in customer. */
  readonly signedIn: boolean;
  readonly now: Date;
}

export type Availability = { readonly accepting: true } | { readonly accepting: false; readonly reason: FormNotAcceptingReason };

export function submissionAvailability(input: AvailabilityInput | null): Availability {
  if (input === null || input.status === 'draft' || !input.hasPublishedVersion) {
    return { accepting: false, reason: 'unavailable' };
  }
  const state = formAvailability(input.status, input.restrictions, input.acceptedEntryCount, input.now);
  if (state !== 'open') return { accepting: false, reason: state };
  if (input.restrictions.signedInOnly && !input.signedIn) return { accepting: false, reason: 'sign_in_required' };
  return { accepting: true };
}
