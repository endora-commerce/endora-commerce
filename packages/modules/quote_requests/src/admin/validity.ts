/**
 * The per-request validity deadline (`expiresAt`) an operator sets through
 * `expiresInDays`, read as the three states the detail screen has to tell
 * apart. Kept out of `RfqDetail.tsx` so the arithmetic can be unit-tested
 * without mounting the screen.
 *
 * The deadline is a rule and not decoration: past it the customer is refused
 * `410 RFQ_EXPIRED` on accept-revision and `410 QUOTE_VALIDITY_ENDED` on
 * convert-to-order. An absent deadline means the operator set none, which
 * refuses nothing — so "none" and "lapsed" are different answers about the
 * same field and neither may be rendered as the other.
 */

import { QUOTE_VALIDITY_DAYS_MAX } from '@endora-commerce/contracts';

/** One day in milliseconds — the unit `expiresInDays` is counted in. */
export const MS_PER_DAY = 86_400_000;

export type RfqValidity =
  | { kind: 'none' }
  | { kind: 'active'; expiresAt: string }
  | { kind: 'lapsed'; expiresAt: string };

/**
 * Classifies a request's `expiresAt` against a reference instant.
 *
 * An unparsable timestamp answers `active`: the screen may not tell an
 * operator that a customer is being refused unless it can show the date they
 * are refused from. The server is the authority in either case.
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
 * What a typed `expiresInDays` field says, read the way the contract reads it
 * (`quoteValidityDaysSchema`: a whole number from 0 to
 * {@link QUOTE_VALIDITY_DAYS_MAX}). `blank` is not `0`: on a shared quote a
 * blank field leaves the deadline as it is, while `0` removes it.
 */
export type ValidityDaysInput =
  | { kind: 'blank' }
  | { kind: 'days'; days: number }
  | { kind: 'invalid' };

export function parseValidityDays(raw: string): ValidityDaysInput {
  const trimmed = raw.trim();
  if (trimmed === '') return { kind: 'blank' };
  const days = Number(trimmed);
  if (!Number.isInteger(days) || days < 0 || days > QUOTE_VALIDITY_DAYS_MAX) return { kind: 'invalid' };
  return { kind: 'days', days };
}

/**
 * The deadline the API will store for a typed `expiresInDays`, computed with
 * the arithmetic the server uses (`RfqAdminService.modify`:
 * `new Date(Date.now() + expiresInDays * 86_400_000)`).
 *
 * The preview this feeds is the operator's only sight of the date before it
 * becomes a commitment the customer is held to, so it has to be the server's
 * own answer rather than an approximation of it.
 *
 * Returns `null` for a blank field, for input the contract would refuse, and
 * for `0`: 0 days means no deadline on every write of the validity
 * (`specs/192-quote-request-draft-share/` FR-032, as `normaliseShareValidityDays`
 * reads it on the server). The caller tells the three apart with
 * {@link parseValidityDays}, because they are different sentences on screen.
 */
export function deadlineForDays(raw: string, now: Date): Date | null {
  const input = parseValidityDays(raw);
  if (input.kind !== 'days' || input.days === 0) return null;
  return new Date(now.getTime() + input.days * MS_PER_DAY);
}

/**
 * Whether a non-blank `expiresInDays` field would be refused by the contract.
 * Blank is not an error — it is the "keep the current deadline" case.
 */
export function isValidityDaysInvalid(raw: string): boolean {
  return parseValidityDays(raw).kind === 'invalid';
}

/**
 * The `expiresInDays` an edit of a quote not yet shared sends, given what the
 * field held when it opened (`shareValidityDays`, or blank): absent while it is
 * unchanged, `null` once emptied (no deadline), else the number — `0` included,
 * which the server stores as no deadline too. Call it with valid input only.
 */
export function unsharedValidityDaysPayload(raw: string, initial: string): number | null | undefined {
  const input = parseValidityDays(raw);
  if (raw.trim() === initial.trim()) return undefined;
  if (input.kind === 'days') return input.days;
  return null;
}
