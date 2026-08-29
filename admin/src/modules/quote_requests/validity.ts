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
 * The deadline the API will store for a typed `expiresInDays`, computed with
 * the arithmetic the server uses (`RfqAdminService.modify`:
 * `new Date(Date.now() + expiresInDays * 86_400_000)`).
 *
 * The preview this feeds is the operator's only sight of the date before it
 * becomes a commitment the customer is held to, so it has to be the server's
 * own answer rather than an approximation of it.
 *
 * Returns `null` for input the contract would reject
 * (`z.number().int().nonnegative()`) and for a blank field, which means "leave
 * the deadline as it is" — the caller distinguishes the two by looking at the
 * raw string, because they are different sentences on screen.
 */
export function deadlineForDays(raw: string, now: Date): Date | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const days = Number(trimmed);
  if (!Number.isInteger(days) || days < 0) return null;
  return new Date(now.getTime() + days * MS_PER_DAY);
}

/**
 * Whether a non-blank `expiresInDays` field would be refused by the contract.
 * Blank is not an error — it is the "keep the current deadline" case.
 */
export function isValidityDaysInvalid(raw: string, now: Date): boolean {
  return raw.trim() !== '' && deadlineForDays(raw, now) === null;
}
