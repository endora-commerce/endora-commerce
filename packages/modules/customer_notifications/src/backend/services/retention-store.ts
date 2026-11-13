import type { EntityManager } from '@mikro-orm/postgresql';
import { CustomerNotification } from '../entities/customer-notification.entity.js';
import type { RetentionStore } from './retention-sweeper.js';
import { anyRowExists } from './scheduled-work-probe.js';

/**
 * {@link RetentionStore} over MikroORM — the statements of the retention
 * sweep. Everything but {@link hasWork} runs inside the system scope the tick
 * entered, through the ORM, so the tenancy guard sees every read and write.
 */
export class MikroRetentionStore implements RetentionStore {
  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * One bit, read outside any scope (issue #120): whether the table holds any
   * entry. Any entry is work for the erasure pass, whose question — is its
   * account still live — only the account owner can answer, inside the scope;
   * an empty table is the idle tick, which enters none.
   */
  async hasWork(): Promise<boolean> {
    return anyRowExists(this.emFactory(), [{ from: 'from "customer_notifications"', params: [] }]);
  }

  async deleteCreatedBefore(cutoff: Date, limit: number): Promise<number> {
    const em = this.emFactory();
    const due = await em.find(
      CustomerNotification,
      { createdAt: { $lt: cutoff } },
      { fields: ['id'], orderBy: { createdAt: 'asc' }, limit },
    );
    if (due.length === 0) return 0;
    // command-coverage-ignore: customer notification bookkeeping — retention of
    // entries past their period, not an audited domain-state mutation (R-19).
    return em.nativeDelete(CustomerNotification, { id: { $in: due.map((row) => row.id) } });
  }

  async accountIdsAfter(after: string | null, limit: number): Promise<string[]> {
    const rows = (await this.emFactory()
      .createQueryBuilder(CustomerNotification, 'n')
      .select('n.customerAccountId', true)
      .where(after === null ? {} : { customerAccountId: { $gt: after } })
      .orderBy({ customerAccountId: 'asc' })
      .limit(limit)
      .execute('all')) as Array<{ customerAccountId: string }>;
    return rows.map((row) => row.customerAccountId);
  }

  deleteForAccounts(customerAccountIds: readonly string[]): Promise<number> {
    // command-coverage-ignore: customer notification bookkeeping — the entries
    // of accounts that were deleted or anonymised (data-model §2).
    return this.emFactory().nativeDelete(CustomerNotification, {
      customerAccountId: { $in: [...customerAccountIds] },
    });
  }
}
