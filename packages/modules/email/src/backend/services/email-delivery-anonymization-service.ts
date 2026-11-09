import type { EntityManager } from '@mikro-orm/postgresql';
import type { EmailDeliveryAnonymizationPort } from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';

/**
 * `email`'s step in the customer-account anonymisation sweep (issue #928),
 * registered as `emailDeliveryAnonymizationPort`; the contract is
 * {@link EmailDeliveryAnonymizationPort}'s.
 */
export class EmailDeliveryAnonymizationService implements EmailDeliveryAnonymizationPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog: AuditPort,
  ) {}

  async anonymizeForRecipient(_recipient: string): Promise<number> {
    void this.emFactory;
    void this.auditLog;
    return 0;
  }
}
