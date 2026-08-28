import type { EntityManager } from '@mikro-orm/postgresql';
import type { MfaSubjectType } from '@endora-commerce/contracts';
import { MfaEnrolmentStateService } from '../../../packages/modules/mfa/src/backend/services/mfa-enrolment-state.service.js';

/**
 * `mfa`'s enrolment answer, for a test that builds an `admin_users` or
 * `customer_accounts` service by hand.
 *
 * The **real** implementation rather than a stub, for the reason
 * `customer-account-ports.ts` gives about the ports beside it: it is the class
 * the container registers, so a hand-built service reads the same table the
 * composed one does. A stub returning an empty set would reproduce, inside the
 * test rig, exactly the constant `false` this seam exists to remove — and every
 * assertion about `twoFactorEnabled` made through such a rig would be vacuous.
 *
 * `MfaEnrolmentStateService` holds no module-scope state — it is a class over
 * the caller's `emFactory` — so reaching its source here duplicates no
 * singleton (D-168 / `check:singleton-identity` conjunct 2).
 */
export function twoFactorEnrolmentsFor(
  emFactory: () => EntityManager,
  subjectType: MfaSubjectType,
): (ids: readonly string[]) => Promise<ReadonlySet<string>> {
  const service = new MfaEnrolmentStateService(emFactory);
  return async (ids) => new Set(await service.activeSubjectIds(subjectType, ids));
}
