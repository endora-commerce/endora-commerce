/** Active enrolments by kind of account. */
export interface ActiveEnrolmentCounts {
  readonly admin: number;
  readonly customer: number;
}

export interface UnusableEnrolmentsReportDeps {
  readonly hasEncryptionKey: boolean;
  /** This module's own table: how many active enrolments each kind of account holds. */
  readonly countActiveEnrolments: () => Promise<ActiveEnrolmentCounts>;
  readonly error: (fields: Record<string, unknown>, message: string) => void;
}

/**
 * Issue #948 — an enrolment made while the instance held its encryption key
 * cannot be checked once the key is gone: its secret is stored encrypted, and
 * this module serves no code-entry step without the key. Sign-in therefore asks
 * no second factor of its holder (owner ruling Q6, 2026-11-08), which would
 * otherwise have locked out exactly the accounts that opted into one.
 *
 * Logged at every boot, at error level, while any such enrolment exists. Reads
 * nothing when the key is configured, which is every instance not in this
 * state.
 */
export async function reportUnusableEnrolments(deps: UnusableEnrolmentsReportDeps): Promise<void> {
  if (deps.hasEncryptionKey) return;
  const counts = await deps.countActiveEnrolments();
  if (counts.admin === 0 && counts.customer === 0) return;
  deps.error(
    { unusableEnrolments: { admin: counts.admin, customer: counts.customer } },
    `MFA_SECRET_ENCRYPTION_KEY is not set, so the second factor of ${counts.admin} administrator ` +
      `and ${counts.customer} customer enrolment(s) cannot be checked. Two-step verification is not ` +
      'asked for: those accounts sign in with their password alone. Set MFA_SECRET_ENCRYPTION_KEY ' +
      '(the key the enrolments were made with) and restart to apply it again.',
  );
}
