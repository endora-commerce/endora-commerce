/**
 * What an impersonation audit entry may say (issue #470, D-288;
 * `specs/conventions/audit-state.md`).
 *
 * An impersonation is recorded against a `@CustomerScoped` customer account,
 * and the platform audit log is one global table read under `audit_log:read`
 * without Organization reach. So `impersonation.start` names whether a reason
 * was given, how long it was and the id of the `admin_impersonation_reasons`
 * row that holds it (`valueChangeId`, §3) — never the reason (free text, §2) —
 * and whether the start was scoped to an Organization, never which one (the
 * tenant anchor, §2).
 */

/**
 * Every top-level key an impersonation audit state may hold. Anything else is
 * a value until somebody classifies it on purpose —
 * `impersonation-audit-sentinels.test.ts` holds every recorded state to this
 * list.
 */
export const ADMIN_USERS_AUDIT_KEYS: ReadonlySet<string> = new Set([
  // Whether the administrator gave a reason, and its length.
  'hasReason',
  'reasonLength',
  // Whether the start named the Organization the account belongs to.
  'organizationScoped',
  // The `admin_impersonation_reasons` row holding the reason, by id.
  'valueChangeId',
  // How many reason rows an anonymisation erased (`impersonation.reasons_erase`).
  'deleted',
]);

/** The `stateAfter` of `impersonation.start`. */
export function impersonationStartAuditState(input: {
  readonly reason: string | null;
  readonly reasonId: string | null;
  readonly organizationScoped: boolean;
}): Record<string, unknown> {
  return {
    hasReason: input.reason !== null,
    ...(input.reason !== null ? { reasonLength: input.reason.length } : {}),
    organizationScoped: input.organizationScoped,
    ...(input.reasonId !== null ? { valueChangeId: input.reasonId } : {}),
  };
}
