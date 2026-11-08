import type { EntityManager } from '@mikro-orm/postgresql';
import type { CartAnonymizationPort } from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';

/** Issue #920 — not implemented yet. */
export class CartAnonymizationService implements CartAnonymizationPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog: AuditPort,
  ) {}

  async anonymizeForCustomerAccount(_customerAccountId: string): Promise<number> {
    void this.emFactory;
    void this.auditLog;
    return 0;
  }
}
