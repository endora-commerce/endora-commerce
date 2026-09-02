/**
 * Which customer accounts hold a second factor — this module's own view of a
 * fact `mfa` owns.
 *
 * A function type rather than an interface, and not shared with `admin_users`,
 * because there is nothing to share: the published shape is
 * `MfaEnrolmentStatePort` in `@endora-commerce/contracts`, and this is only the
 * shape in which *this* module's mapper wants the answer — `subjectType` is
 * already decided, and a `Set` is what a list surface asks per row.
 *
 * `backend.ts` builds the one implementation: it decides `mfa`'s presence and
 * then resolves the port, so an absent owner produces an empty set rather than
 * a `ModuleDisabledError` on a customer's own account page. That is a declared
 * degrade — see the `degrades-without` entry for `mfaEnrolmentStatePort` in
 * this module's manifest — and not a caught gate.
 */
export type TwoFactorEnrolmentReader = (
  customerAccountIds: readonly string[],
) => Promise<ReadonlySet<string>>;
