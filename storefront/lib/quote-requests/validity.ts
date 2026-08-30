import type { MessageKey } from '../i18n/messages';
import type { RfqStatus } from '../api/rfq';

/**
 * The per-request validity deadline (`expiresAt`) an operator sets through
 * `expiresInDays`, read as the three states the buyer's screens have to tell
 * apart.
 *
 * The deadline is a rule and not decoration. Since !1137 the buyer is refused
 * `410 RFQ_EXPIRED` on accept-revision and `410 QUOTE_VALIDITY_ENDED` on
 * convert-to-order once it has passed, and until this change no storefront
 * component rendered `expiresAt` at all — `RfqDetail` and `RfqSummary` carried
 * it and nothing displayed it, so the buyer's first sight of the deadline was
 * the refusal.
 *
 * **An absent deadline is a legitimate state, not an empty field.** `expiresAt`
 * is nullable; absent means the operator set none, and `validityHasLapsed`
 * answers `false` for it, so nothing refuses the buyer. Such a request must
 * render no validity sentence at all rather than a blank where a date would go
 * — "none" and "lapsed" are different answers about the same field and neither
 * may be rendered as the other.
 *
 * Kept out of the page components so the arithmetic and the gate are unit
 * testable without rendering a route: the storefront harness is SSR-only
 * (`renderToString`, node env), so logic that decides anything lives in a pure
 * exported function.
 */

export type RfqValidity =
  | { kind: 'none' }
  | { kind: 'active'; expiresAt: string }
  | { kind: 'lapsed'; expiresAt: string };

/**
 * Classifies a request's `expiresAt` against a reference instant.
 *
 * The predicate is the server's, character for character:
 * `RfqService.validityHasLapsed` is `expiresAt != null && getTime() <= nowMs`.
 * A boundary that disagreed with it by a millisecond would produce the one
 * outcome this whole change exists to remove — a control the screen offers and
 * the API refuses, or the reverse.
 *
 * An unparsable timestamp answers `active`: the screen may not tell a buyer
 * their offer has lapsed unless it can show them the date it lapsed on. The
 * server is the authority either way, and an over-permissive screen sends the
 * buyer into a 410 that says the truth, while an over-strict one disables a
 * button that would have worked.
 */
export function rfqValidity(expiresAt: string | null | undefined, now: Date): RfqValidity {
  if (expiresAt === null || expiresAt === undefined || expiresAt === '') return { kind: 'none' };
  const at = new Date(expiresAt);
  // `NaN <= now` is false, so an unparsable value falls through to `active`.
  return at.getTime() <= now.getTime()
    ? { kind: 'lapsed', expiresAt }
    : { kind: 'active', expiresAt };
}

/**
 * The label that precedes the rendered date, or `null` where there is no date
 * and therefore nothing to say.
 *
 * Two labels rather than one, because "expires <date>" reads as a promise the
 * platform has stopped keeping once the date is behind us — the same correction
 * !1141 made to the operator's header.
 */
export function validityLabelKey(validity: RfqValidity): MessageKey | null {
  switch (validity.kind) {
    case 'none':
      return null;
    case 'active':
      return 'quoteRequests.validity.validUntil';
    case 'lapsed':
      return 'quoteRequests.validity.endedOn';
  }
}

/**
 * Which of the buyer's two price-consuming actions the deadline currently
 * refuses, and the sentence that says so.
 *
 * Derived from the controls the page actually renders rather than from a list
 * of statuses (Tesler): Accept is on screen exactly while the server sets
 * `awaitingCustomerRevisionAcceptance`, and Place order exactly while the
 * status is `Approved`. Those are the two routes !1137 made refuse, so the gate
 * and the rule cannot drift apart by someone forgetting to extend a status
 * list. It also lands on the same three statuses !1141 chose for the operator's
 * banner — on a Canceled, Completed or Expired request the deadline decides
 * nothing and a warning would be crying wolf.
 *
 * Reject-revision and Resubmit are deliberately never gated. !1137 refuses
 * neither: declining a lapsed offer consumes no price the seller committed to,
 * and refusing it would leave the buyer no way to clear a row they have been
 * told is dead — while `resubmit` is their way forward and raises a new request
 * carrying no deadline.
 *
 * `noticeKey` mirrors the split between the two error codes, which name the
 * same date from the two sides the buyer meets it on. An offer that lapsed
 * undecided can still be replaced by a fresh one; an accepted quote that ran
 * out is a dead end at the API — `modify` refuses any status but `Pending` and
 * `Created from admin`, so nobody can move that deadline — and the sentence
 * says so and names `resubmit` instead of implying an extension the buyer
 * cannot get.
 */
export interface RfqValidityGate {
  acceptBlocked: boolean;
  convertBlocked: boolean;
  noticeKey: MessageKey | null;
}

export function rfqValidityGate(input: {
  status: RfqStatus;
  awaitingCustomerRevisionAcceptance: boolean;
  validity: RfqValidity;
}): RfqValidityGate {
  const lapsed = input.validity.kind === 'lapsed';
  const acceptBlocked = lapsed && input.awaitingCustomerRevisionAcceptance;
  const convertBlocked = lapsed && input.status === 'Approved';
  // Accept takes precedence when a row somehow carries both: it is the earlier
  // decision, and the buyer cannot reach the later one without it.
  const noticeKey: MessageKey | null = acceptBlocked
    ? 'quoteRequests.validity.acceptBlocked'
    : convertBlocked
      ? 'quoteRequests.validity.convertBlocked'
      : null;
  return { acceptBlocked, convertBlocked, noticeKey };
}

/**
 * The deadline as the buyer reads it — date **and** time.
 *
 * `expiresAt` is written as `now + expiresInDays * 86_400_000`, so it carries a
 * time of day and rarely falls on midnight. A date alone would tell a buyer
 * their offer is good "until 12.09.2026" while it lapses at 09:14 that morning,
 * which is the same class of defect as not rendering it at all. The rest of
 * this screen already prints its instants with `toLocaleString`.
 *
 * Rendered in the *server's* zone, which is the zone the deadline was computed
 * in; there is no client boundary here to re-render it in the buyer's.
 */
export function formatValidityInstant(expiresAt: string, locale: string): string {
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return expiresAt;
  try {
    return at.toLocaleString(locale);
  } catch {
    return at.toISOString();
  }
}
