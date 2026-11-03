import type { CustomerAccountReadPort } from '@endora-commerce/contracts';
import type { Command, CommandBus, CommandContext } from '@endora-commerce/platform/commands';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { FormEntry } from '../entities/form-entry.entity.js';
import { releaseCounters } from './entry-commands.js';

/**
 * FR-047 — the entries attributed to an anonymised customer account are erased, with their notes
 * (`specs/170-forms-module/` research R-17; OQ-1: at **anonymisation**, the irreversible step, so a
 * soft-deleted account restored within its window keeps its entries).
 *
 * Two triggers, one Command `forms.entries.erase_for_account` on the account:
 *
 * - **the event** — `customer_account.anonymized.v1`, heard within the sweep step that anonymised
 *   the account ({@link ErasureService.eraseForAccount}, in the system scope: the account's entries
 *   belong to its organisation, whoever runs the sweep);
 * - **the reconciliation** — the maintenance tick pages through the distinct attributed account ids
 *   of `form_entries`, {@link RECONCILE_PAGE} at a time, asks `customer_accounts` for them through
 *   its read port, and erases the entries of every account that is anonymised or no longer resolves
 *   ({@link ErasureService.reconcile}). It is state-based, so an anonymisation that happened while
 *   this module was off — its subscriber gated — is caught on the first tick after the return.
 *
 * Entries are matched by attribution only, never by e-mail: an anonymous entry that carries the
 * same address is not this account's to the platform (documented for the operator). Audit states
 * hold counts and form ids — never an answer or the address.
 */

type Em = CommandContext['em'];

export const ERASURE_BATCH = 500;
export const RECONCILE_PAGE = 500;
export const FORMS_ERASE_FOR_ACCOUNT_REASON = 'forms: erase the entries of an anonymised customer account';

/** `forms.entries.erase_for_account` — at most `limit` entries attributed to the account. */
export function eraseForAccountCommand(customerAccountId: string, limit = ERASURE_BATCH): Command<number> {
  return {
    action: 'forms.entries.erase_for_account',
    objectType: 'customer_account',
    objectId: customerAccountId,
    run: async ({ em }) => {
      const entries = await em.find(
        FormEntry,
        { customerAccountId },
        { fields: ['id', 'formId', 'status'], orderBy: { id: 'asc' }, limit },
      );
      if (entries.length === 0) return { result: 0, skipAudit: true };
      // Notes go by the foreign key's cascade.
      await em.nativeDelete(FormEntry, { id: { $in: entries.map((entry) => entry.id) } });
      const perForm = await releaseCounters(em, entries);
      return {
        result: entries.length,
        before: null,
        after: { deleted: entries.length, formIds: [...perForm.keys()].sort() },
      };
    },
  };
}

export interface ErasureServiceDeps {
  readonly emFactory: () => Em;
  readonly commandBus: CommandBus;
  readonly customerAccounts: Pick<CustomerAccountReadPort, 'findByIds'>;
}

export class ErasureService {
  constructor(private readonly deps: ErasureServiceDeps) {}

  /** The subscriber's body: every entry of the account, in the system scope. Answers the count. */
  eraseForAccount(customerAccountId: string): Promise<number> {
    return withSystemScope(FORMS_ERASE_FOR_ACCOUNT_REASON, () => this.#erase(customerAccountId));
  }

  /**
   * Whether the reconciliation could find anything — a global read, outside any scope. Entries
   * exist only under a form, so no form means no entry; the attributed ids themselves are tenant
   * data and are read only inside the scope.
   */
  async hasWork(): Promise<boolean> {
    const rows = (await this.deps
      .emFactory()
      .getConnection()
      .execute(`select exists (select 1 from "forms") as "any"`)) as Array<{ any: boolean }>;
    return rows[0]?.any === true;
  }

  /** One reconciliation pass, in the system scope the tick entered. Answers how many entries went. */
  async reconcile(): Promise<number> {
    let erased = 0;
    let after: string | null = null;
    for (;;) {
      const page = await this.#attributedAccounts(after);
      if (page.length === 0) break;
      after = page[page.length - 1]!;
      const known = await this.deps.customerAccounts.findByIds(page);
      const live = new Set(known.filter((account) => account.anonymizedAt === null).map((account) => account.id));
      for (const id of page) if (!live.has(id)) erased += await this.#erase(id);
      if (page.length < RECONCILE_PAGE) break;
    }
    return erased;
  }

  async #erase(customerAccountId: string): Promise<number> {
    let erased = 0;
    for (;;) {
      const batch = await this.deps.commandBus.run(eraseForAccountCommand(customerAccountId));
      erased += batch;
      if (batch < ERASURE_BATCH) return erased;
    }
  }

  /** The next page of distinct attributed account ids after `after`, in id order (keyset paging). */
  async #attributedAccounts(after: string | null): Promise<string[]> {
    const rows = (await this.deps
      .emFactory()
      .createQueryBuilder(FormEntry, 'e')
      .select('e.customerAccountId', true)
      .where(after === null ? { customerAccountId: { $ne: null } } : { customerAccountId: { $ne: null, $gt: after } })
      .orderBy({ customerAccountId: 'asc' })
      .limit(RECONCILE_PAGE)
      .execute('all')) as Array<{ customerAccountId: string }>;
    return rows.map((row) => row.customerAccountId);
  }
}
