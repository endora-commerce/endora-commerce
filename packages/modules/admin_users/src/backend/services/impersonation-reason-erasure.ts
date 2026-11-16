import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { ImpersonationReason } from '../entities/impersonation-reason.entity.js';

export const IMPERSONATION_REASONS_ERASE_SCOPE_REASON =
  'admin_users: erase the impersonation reasons of an anonymised customer account';

/**
 * Issue #470 — erase the impersonation reasons written about an anonymised
 * customer account (`customer_account.anonymized.v1`).
 *
 * Until the reason left the audit log it sat in the `impersonation.start`
 * entry, which the anonymisation's audit redaction (#844) erases; now that it
 * sits in `admin_impersonation_reasons`, the rows go here, in the system scope
 * (the account belongs to its Organization, whoever runs the sweep). One audit
 * entry against the account records how many went — a count, never a reason —
 * and none is written when there was nothing to erase.
 */
export async function eraseImpersonationReasons(
  emFactory: () => EntityManager,
  auditLog: AuditPort,
  customerAccountId: string,
): Promise<number> {
  return withSystemScope(IMPERSONATION_REASONS_ERASE_SCOPE_REASON, () =>
    emFactory().transactional(async (tx) => {
      const deleted = await tx.nativeDelete(ImpersonationReason, { customerAccountId });
      if (deleted > 0) {
        auditLog.recordWithin(tx, {
          action: 'impersonation.reasons_erase',
          objectType: 'customer_account',
          objectId: customerAccountId,
          stateBefore: null,
          stateAfter: { deleted },
        });
      }
      return deleted;
    }),
  );
}
