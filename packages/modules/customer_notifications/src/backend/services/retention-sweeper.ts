import type { CustomerAccountReadPort } from '@endora-commerce/contracts';

/**
 * The two passes of the centre's retention sweep
 * (`specs/179-rfq-and-customer-notifications/` research R-16, data-model §2).
 *
 *  1. **Retention** — entries older than `customer_notifications.retention_days`
 *     are deleted, a batch at a time. Deletion, not archiving: there is no
 *     screen for archived entries.
 *  2. **Erasure** — the entries of accounts that `customer_accounts` reports
 *     deleted or anonymised, or no longer reports at all, are deleted. The
 *     table holds no foreign key to that module's table (the module must be
 *     detachable, Principle I), so the account owner is asked, a page of
 *     distinct account ids at a time.
 *
 * Both run inside the system scope the tick entered; each is idempotent, so a
 * second consumer ticking at once finds the first one's work already done.
 */

/** The period's range, held at every write path and again by the reader. */
export const RETENTION_DAYS_BOUNDS = { min: 7, max: 730 } as const;
export const RETENTION_DAYS_DEFAULT = 90;

/** A stored value outside the range is held to it rather than trusted. */
export function clampRetentionDays(value: number): number {
  if (!Number.isFinite(value)) return RETENTION_DAYS_DEFAULT;
  return Math.min(RETENTION_DAYS_BOUNDS.max, Math.max(RETENTION_DAYS_BOUNDS.min, Math.trunc(value)));
}

export interface RetentionStore {
  /** Whether a pass could find anything — yes or no, outside any scope. */
  hasWork(): Promise<boolean>;
  /** Deletes up to `limit` entries created before `cutoff`, oldest first. Answers how many went. */
  deleteCreatedBefore(cutoff: Date, limit: number): Promise<number>;
  /** The next `limit` distinct account ids holding entries, after `after` in id order. */
  accountIdsAfter(after: string | null, limit: number): Promise<string[]>;
  /** Deletes every entry of these accounts. Answers how many went. */
  deleteForAccounts(customerAccountIds: readonly string[]): Promise<number>;
}

export interface RetentionSweepResult {
  retentionDays: number;
  expired: number;
  erased: number;
}

export interface RetentionSweeperDeps {
  readonly store: RetentionStore;
  readonly retentionDays: () => Promise<number>;
  readonly customerAccounts: Pick<CustomerAccountReadPort, 'findByIds'>;
  /** Entries deleted per statement. Default 1000 (research R-16). */
  readonly batchSize?: number;
  /** Account ids asked about per call to the account owner. Default 500. */
  readonly accountPageSize?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class CustomerNotificationRetentionSweeper {
  constructor(private readonly deps: RetentionSweeperDeps) {}

  hasWork(): Promise<boolean> {
    return this.deps.store.hasWork();
  }

  async sweep(now: Date): Promise<RetentionSweepResult> {
    const retentionDays = clampRetentionDays(await this.deps.retentionDays());
    const expired = await this.#expire(new Date(now.getTime() - retentionDays * DAY_MS));
    const erased = await this.#erase();
    return { retentionDays, expired, erased };
  }

  async #expire(cutoff: Date): Promise<number> {
    const batch = this.deps.batchSize ?? 1000;
    let expired = 0;
    for (;;) {
      const deleted = await this.deps.store.deleteCreatedBefore(cutoff, batch);
      expired += deleted;
      if (deleted < batch) return expired;
    }
  }

  async #erase(): Promise<number> {
    const pageSize = this.deps.accountPageSize ?? 500;
    let erased = 0;
    let after: string | null = null;
    for (;;) {
      const page = await this.deps.store.accountIdsAfter(after, pageSize);
      if (page.length === 0) return erased;
      after = page[page.length - 1]!;
      // The wider read — soft-deleted accounts included — so a deleted account
      // is told apart from one that is gone.
      const known = await this.deps.customerAccounts.findByIds(page);
      const live = new Set(
        known.filter((account) => account.deletedAt === null && account.anonymizedAt === null).map((account) => account.id),
      );
      const gone = page.filter((id) => !live.has(id));
      if (gone.length > 0) erased += await this.deps.store.deleteForAccounts(gone);
      if (page.length < pageSize) return erased;
    }
  }
}
