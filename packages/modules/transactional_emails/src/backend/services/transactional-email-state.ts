import type { EntityManager } from '@mikro-orm/postgresql';
import type { TransactionalEmailStatePort } from '@endora-commerce/contracts';
import { TransactionalEmail } from '../entities/transactional-email.entity.js';

/**
 * `transactionalEmailStatePort` (`specs/180-off-platform-complaints/` D-11, research
 * R-21): whether an e-mail is switched on, read before it is sent — the returns form
 * promises a confirmation only while it is. The flag is the one the sender reads before
 * answering `deactivated`; a code with no definition answers `false`.
 */
export class TransactionalEmailStateService implements TransactionalEmailStatePort {
  constructor(private readonly emFactory: () => Pick<EntityManager, 'findOne'>) {}

  async isActive(code: string): Promise<boolean> {
    const email = await this.emFactory().findOne(TransactionalEmail, { code });
    return email?.active === true;
  }
}
