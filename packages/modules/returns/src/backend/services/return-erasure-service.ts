import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerAccountReadPort, ObjectStoragePort } from '@endora-commerce/contracts';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnCaseAttachment } from '../entities/return-case-attachment.entity.js';

/**
 * Erasing a customer's personal data from their return cases
 * (`specs/180-off-platform-complaints/` FR-B43, D-8, research R-15).
 *
 * Feature 180 is what makes `returns` hold personal data — the contact data, the
 * ship-back address and the files of a case — so it is what makes it take part in the
 * customer anonymisation: on every case **filed by** the account the contact and the
 * address are nulled and `personal_data_erased_at` stamped, and every file of those cases
 * and every pending upload of the account goes, bytes first, then the row. Lines,
 * purchase data and comments stay, so the case remains workable. One audited Command per
 * account run, names and counts only. The event erases at once; the maintenance sweep
 * reconciles what was missed while the module was off.
 *
 * **Two erasures of one account may run at once** — the event's subscriber and the daily
 * sweep, or two sweeps. Each run therefore takes a transaction-scoped advisory lock keyed by
 * the account inside its Command, and reads the cases and files only **after** it holds the
 * lock: the second run then finds what the first left — nothing — and records nothing. A
 * file whose bytes are already gone (a run that deleted them and then rolled back) counts as
 * deleted.
 */

export const RETURNS_ERASE_FOR_ACCOUNT_REASON = 'returns: erase the personal data of an anonymised customer account';
export const RECONCILE_PAGE = 500;

export interface ReturnErasureServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
  readonly customerAccounts: Pick<CustomerAccountReadPort, 'findByIds'>;
  /** `assets_library`'s object store, where the files' bytes are (research R-12). */
  readonly storage: Pick<ObjectStoragePort, 'getForBackend'>;
  readonly now?: () => Date;
}

export class ReturnErasureService {
  constructor(private readonly deps: ReturnErasureServiceDeps) {}

  /** The event's body: erase in the system scope — there is no request behind it. */
  eraseForAccount(customerAccountId: string): Promise<number> {
    return withSystemScope(RETURNS_ERASE_FOR_ACCOUNT_REASON, () => this.erase(customerAccountId));
  }

  /** Erase one account's data; answers the number of cases stamped. Runs inside a system scope. */
  async erase(customerAccountId: string): Promise<number> {
    // A cheap look first, so the sweep does not open a transaction per account for nothing.
    const em = this.deps.emFactory();
    const pending =
      (await em.count(ReturnCase, { customerAccountId, personalDataErasedAt: null })) +
      (await em.count(ReturnCaseAttachment, { customerAccountId }));
    if (pending === 0) return 0;
    return this.deps.commandBus.run(
      eraseCommand(customerAccountId, this.now(), (row) => this.deleteObject(row)),
    );
  }

  /** Accounts anonymised while `returns` was off whose cases still hold their data. */
  async reconcile(): Promise<number> {
    let erased = 0;
    let after: string | null = null;
    for (;;) {
      const page = await this.filers(after);
      if (page.length === 0) break;
      after = page[page.length - 1]!;
      const known = await this.deps.customerAccounts.findByIds(page);
      const anonymised = new Set(known.filter((a) => a.anonymizedAt != null).map((a) => a.id));
      for (const id of page) if (anonymised.has(id)) erased += await this.erase(id);
      if (page.length < RECONCILE_PAGE) break;
    }
    return erased;
  }

  async hasWork(): Promise<boolean> {
    const rows = (await this.deps
      .emFactory()
      .getConnection()
      .execute(`select exists (select 1 from "return_cases" where "personal_data_erased_at" is null) as "any"`)) as Array<{
      any: boolean;
    }>;
    return rows[0]?.any === true;
  }

  /** Delete pending uploads past their expiry: the object, then the row. Answers how many. */
  async sweepExpiredUploads(now: Date): Promise<number> {
    const em = this.deps.emFactory();
    const expired = await em.find(ReturnCaseAttachment, { returnCaseId: null, expiresAt: { $lt: now } }, { limit: 500 });
    for (const row of expired) {
      await this.deleteObject(row);
      // command-coverage-ignore: an unclaimed upload past its 24-hour life is a staging
      // row nobody filed; deleting it is housekeeping, not a domain change (research R-11).
      await em.nativeDelete(ReturnCaseAttachment, { id: row.id });
    }
    return expired.length;
  }

  private async deleteObject(row: Pick<ReturnCaseAttachment, 'storageBackend' | 'storageLocator'>): Promise<void> {
    if (!row.storageBackend || !row.storageLocator) return;
    const store = await this.deps.storage.getForBackend(row.storageBackend as never);
    try {
      await store.delete({ locator: row.storageLocator });
    } catch (error) {
      // Already gone is deleted: the object a rolled-back run removed is not missing data.
      if (!isAlreadyGone(error)) throw error;
    }
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  private async filers(after: string | null): Promise<string[]> {
    const rows = (await this.deps
      .emFactory()
      .createQueryBuilder(ReturnCase, 'c')
      .select('c.customerAccountId', true)
      // A guest case has no account to anonymise (`specs/181-guest-complaints/` FR-075):
      // it is never a filer here, and a null would end the page cursor.
      .where(
        after === null
          ? { personalDataErasedAt: null, customerAccountId: { $ne: null } }
          : { personalDataErasedAt: null, customerAccountId: { $gt: after } },
      )
      .orderBy({ customerAccountId: 'asc' })
      .limit(RECONCILE_PAGE)
      .execute()) as Array<{ customerAccountId: string }>;
    return rows.map((r) => r.customerAccountId);
  }
}

/** The advisory-lock namespace of an account's erasure (the first key of the two-key form). */
const ERASURE_LOCK_NAMESPACE = 180;

/**
 * `return_case.erase_personal_data` — one entry per account run; counts and field names only.
 * Holds the account's erasure lock for the transaction and reads under it, so a concurrent
 * run of the same account waits and then finds nothing left, recording nothing.
 */
function eraseCommand(
  customerAccountId: string,
  at: Date,
  deleteObject: (row: ReturnCaseAttachment) => Promise<void>,
): Command<number> {
  return {
    action: 'return_case.erase_personal_data',
    objectType: 'return_case',
    objectId: customerAccountId,
    run: async ({ em }) => {
      await em
        .getConnection()
        .execute(
          'select pg_advisory_xact_lock(?::int, hashtext(?))',
          [ERASURE_LOCK_NAMESPACE, customerAccountId],
          'all',
          em.getTransactionContext(),
        );
      const cases = await em.find(ReturnCase, { customerAccountId, personalDataErasedAt: null }, { fields: ['id'] });
      const caseIds = cases.map((c) => c.id);
      const files = await em.find(ReturnCaseAttachment, {
        $or: [...(caseIds.length > 0 ? [{ returnCaseId: { $in: caseIds } }] : []), { customerAccountId }],
      });
      if (caseIds.length === 0 && files.length === 0) return { result: 0, skipAudit: true };
      // The bytes before the rows: a row left behind is erased again, an object left
      // behind would be unreachable.
      for (const row of files) await deleteObject(row);
      const fileIds = files.map((f) => f.id);
      if (caseIds.length > 0) {
        await em.nativeUpdate(
          ReturnCase,
          { id: { $in: caseIds } },
          { contact: null, returnAddress: null, personalDataErasedAt: at },
        );
      }
      if (fileIds.length > 0) await em.nativeDelete(ReturnCaseAttachment, { id: { $in: fileIds } });
      return {
        result: caseIds.length,
        before: null,
        after: { caseCount: caseIds.length, attachmentCount: fileIds.length, fields: ['contact', 'returnAddress'] },
      };
    },
  };
}

/**
 * Whether an object store's refusal to delete says the object is not there: the local
 * store's `ENOENT`, a cloud store's 404 or `NoSuchKey`, anywhere in the `cause` chain.
 */
export function isAlreadyGone(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth += 1) {
    const e = current as {
      code?: unknown;
      name?: unknown;
      status?: unknown;
      statusCode?: unknown;
      $metadata?: { httpStatusCode?: unknown };
      cause?: unknown;
    };
    if (e.code === 'ENOENT' || e.code === 404 || e.name === 'NoSuchKey' || e.name === 'NotFound') return true;
    if (e.status === 404 || e.statusCode === 404 || e.$metadata?.httpStatusCode === 404) return true;
    current = e.cause;
  }
  return false;
}
