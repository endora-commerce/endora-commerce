import type { EntityManager } from '@mikro-orm/postgresql';
import type { MfaActiveEnrolmentCounts, MfaEnrolmentCountPort } from '@endora-commerce/contracts';
import { MfaEnrolment } from '../entities/mfa-enrolment.entity.js';

/**
 * How many subjects hold an active second factor (owner ruling on D-96.5).
 *
 * The deactivation-confirmation dialog on `/platform/modules` renders one
 * static sentence per dependent, from a manifest. This is the first **live**
 * datum in it, and it is the most decision-relevant fact an operator can be
 * shown before switching this module off: the `whenAbsent` sentence says what
 * stops working, the count says to how many people.
 *
 * It lives here, behind a port, because `mfa_enrolments` is this module's
 * table. The kernel does not name it and no other module queries it; the
 * lifecycle surface asks a question and this module answers it.
 *
 * Nothing about the count is cached, denormalised or persisted outside this
 * table, deliberately: a number that survived deactivation would be a second
 * copy of the fact, and the only moment it is asked for is a moment at which
 * the real one is readable.
 */
export class MfaEnrolmentCountService implements MfaEnrolmentCountPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async countActiveEnrolments(): Promise<MfaActiveEnrolmentCounts> {
    const em = this.emFactory();
    const [admins, customers] = await Promise.all([
      em.count(MfaEnrolment, { status: 'active', subjectType: 'admin' }),
      em.count(MfaEnrolment, { status: 'active', subjectType: 'customer' }),
    ]);
    return { admins, customers };
  }
}
