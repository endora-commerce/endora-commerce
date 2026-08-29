/**
 * Which admin users hold a second factor — the module's own view of a fact
 * `mfa` owns.
 *
 * A function type rather than an interface, and declared here rather than
 * shared with `customer_accounts`, because there is nothing to share: the
 * published shape is `MfaEnrolmentStatePort` in `@endora-commerce/contracts`,
 * and this is only the shape in which *this* module's serializers want the
 * answer — the `subjectType` argument is already decided, and a `Set` is what a
 * list surface asks per row.
 *
 * `backend.ts` builds the one implementation: it decides `mfa`'s presence and
 * then resolves the port, so an absent owner produces an empty set rather than
 * a `ModuleDisabledError` nobody could answer on an admin list. That is a
 * declared degrade — see the `degrades-without` entry for `mfaEnrolmentStatePort`
 * in this module's manifest — and not a caught gate.
 */
export type TwoFactorEnrolmentReader = (
  adminUserIds: readonly string[],
) => Promise<ReadonlySet<string>>;
