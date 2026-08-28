import type { EntityManager } from '@mikro-orm/postgresql';
import type { MfaEnrolmentStatePort, MfaSubjectType } from '@endora-commerce/contracts';
import { MfaEnrolment } from '../entities/mfa-enrolment.entity.js';

/**
 * Who currently holds a second factor, for the surfaces that publish
 * `twoFactorEnabled`.
 *
 * It lives here for the reason `MfaEnrolmentCountService` beside it does:
 * `mfa_enrolments` is this module's table, and the two identity modules that
 * publish the field own the *subject*, not its enrolment. Until this port
 * existed each of them derived the field from a `two_factor_confirmed_at`
 * column on its own table that no code has ever written — so the answer was a
 * constant `false` on six responses, including the buyer's own account page.
 *
 * The read is a subset over the ids the caller already has, not a count and not
 * a per-row lookup: every caller is a list surface, and one query per row
 * behind `/admin-users` is how a correct field becomes a slow screen.
 *
 * `subjectId` is indexed and `status` is indexed; the pair is exactly the
 * partial unique index the enrolment table was created with, so the subset is a
 * single index scan.
 */
export class MfaEnrolmentStateService implements MfaEnrolmentStatePort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async activeSubjectIds(
    subjectType: MfaSubjectType,
    subjectIds: readonly string[],
  ): Promise<string[]> {
    if (subjectIds.length === 0) return [];
    const rows = await this.emFactory().find(
      MfaEnrolment,
      { status: 'active', subjectType, subjectId: { $in: [...new Set(subjectIds)] } },
      { fields: ['subjectId'] },
    );
    return rows.map((row) => row.subjectId);
  }
}
