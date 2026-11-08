import { LockMode, type FilterQuery } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AddressRecord,
  AddressServicePort,
  CustomerAccountReadPort,
  OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { rethrowIfModuleDisabled, type AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { CustomerAddress } from '../entities/customer-address.entity.js';
import { addressFingerprint, takesOverDefault } from './address-fingerprint.js';

/**
 * The personal address book's retirement (`specs/173-b2c-address-book-merge/`
 * release 1; FR-006 – FR-009, OD-2, OD-9).
 *
 * Every live, unrefused `customer_addresses` row is processed once, account by
 * account:
 *
 * - **B2C** — the account's Organization is personal: each row is **moved**
 *   into that Organization's book through `addresses`' own write port, which
 *   validates the country and audits its write. A row equal to one the book
 *   already holds (`addressFingerprint`) is linked to it instead of copied; a
 *   personal default becomes the Organization default only where the book has
 *   none of that kind. The source row is soft-deleted, linked to its new row
 *   (`mergedIntoAddressId`, `mergedAt`) and audited `customer_address.merge`.
 *   A write the owner refuses with an `HttpError` leaves the row live with the
 *   code in `mergeRefusal`, audited `customer_address.merge_refused`, and the
 *   account's other rows go on.
 * - **Everyone else** — a company member, an individual whose personal
 *   Organization is already soft-deleted (anonymized), or an account whose
 *   Organization cannot be found: each row is **erased** — its personal fields blanked, its
 *   default cleared, the row soft-deleted — and audited
 *   `customer_address.erased`. Nothing is copied: those rows are private.
 *
 * **Idempotent and resumable.** A processed row is soft-deleted or refused, and
 * only live unrefused rows are selected, so a second run finds nothing. A crash
 * between the Organization write and the source update leaves an Organization
 * address equal to the still-live row, which the next run links rather than
 * copying again.
 *
 * **Tenancy.** This module may not pin a context to one Organization
 * (`module-composition.md` item 10a, D-285), so the job runs under the system
 * scope its worker enters and every Organization write names the account's own
 * `organizationId`, which `addresses` constrains every statement by. Accounts
 * and Organizations are read through the ports this module already depends on;
 * the only table written directly is this module's own.
 *
 * The audit rows carry a null actor: the job is system-initiated, as the
 * retention sweep's cascade is (`anonymizeIfOrphaned`).
 */

export const ADDRESS_BOOK_RETIREMENT_BATCH_SIZE = 100;

export interface AddressBookRetirementResult {
  /** Accounts that had rows to process. */
  accounts: number;
  /** Rows copied into an Organization book. */
  moved: number;
  /** Rows linked to an equal address the book already held. */
  deduplicated: number;
  /** Rows blanked and soft-deleted rather than moved — every erasure, whatever the reason. */
  erased: number;
  /**
   * Of {@link erased}, the rows of accounts whose Organization could not be
   * found at all — data Principle XI says cannot exist, so the worker warns.
   */
  erasedWithoutOrganization: number;
  /** Rows `addresses` refused; they stay live for the operator. */
  refused: number;
}

export interface AddressBookRetirementDeps {
  readonly emFactory: () => EntityManager;
  readonly accounts: Pick<CustomerAccountReadPort, 'findByIds'>;
  readonly organizations: Pick<OrganizationDetailsPort, 'findByIds'>;
  readonly addresses: Pick<AddressServicePort, 'list' | 'createAddress'>;
  readonly auditLog: AuditPort;
  readonly batchSize?: number;
}

const ZERO: AddressBookRetirementResult = {
  accounts: 0,
  moved: 0,
  deduplicated: 0,
  erased: 0,
  erasedWithoutOrganization: 0,
  refused: 0,
};

/** Live rows the job has not processed. Shared by every statement that selects them. */
const PENDING = `"deleted_at" is null and "merge_refusal" is null`;

const ERASED = '-';

/**
 * The rows {@link AddressBookRetirementService.anonymizeForAccount} still has
 * work on: any field of the scrub not yet written, `deletedAt` included (issue
 * #927). A field added to the scrub is added here, or a row missing only that
 * field is never selected again. Built per call: the ORM may rewrite a filter
 * object it is handed.
 */
export function anonymizationResidue(): { $or: Array<FilterQuery<CustomerAddress>> } {
  return {
    $or: [
      { deletedAt: null },
      { recipientName: { $ne: ERASED } },
      { street: { $ne: ERASED } },
      { city: { $ne: ERASED } },
      { postalCode: { $ne: ERASED } },
      { phone: { $ne: null } },
      { isDefault: true },
    ],
  };
}

/** What the first phase of a move decided for one row. */
type Decision =
  | { readonly kind: 'link'; readonly target: AddressRecord; readonly deduplicated: boolean }
  | { readonly kind: 'refuse'; readonly code: string };

export class AddressBookRetirementService {
  constructor(private readonly deps: AddressBookRetirementDeps) {}

  /**
   * Whether any row is left to process — one boolean over this module's own
   * table, asked with no tenant context so the worker enters its system scope
   * (and writes its escape-hatch audit record) only when there is work.
   */
  async hasWork(): Promise<boolean> {
    const rows = await this.deps
      .emFactory()
      .execute<Array<{ pending: boolean }>>(
        `select exists (select 1 from "customer_addresses" where ${PENDING}) as "pending"`,
      );
    return rows[0]?.pending === true;
  }

  /** Every pending row, in batches of accounts, for a caller already in a system scope. */
  async runInScope(): Promise<AddressBookRetirementResult> {
    const total = { ...ZERO };
    const batchSize = this.deps.batchSize ?? ADDRESS_BOOK_RETIREMENT_BATCH_SIZE;
    let after: string | null = null;
    for (;;) {
      const accountIds = await this.#nextAccounts(after, batchSize);
      if (accountIds.length === 0) break;
      const { personalOrganizationOf, withoutOrganization } = await this.#classify(accountIds);
      for (const accountId of accountIds) {
        const organizationId = personalOrganizationOf.get(accountId);
        const outcome =
          organizationId !== undefined ? await this.#move(accountId, organizationId) : await this.#erase(accountId);
        if (withoutOrganization.has(accountId)) total.erasedWithoutOrganization += outcome.erased;
        if (outcome.moved + outcome.deduplicated + outcome.erased + outcome.refused === 0) continue;
        total.accounts += 1;
        total.moved += outcome.moved;
        total.deduplicated += outcome.deduplicated;
        total.erased += outcome.erased;
        total.refused += outcome.refused;
      }
      after = accountIds[accountIds.length - 1]!;
    }
    return total;
  }

  /**
   * The rows the job refused for one account — live, with their reason — for
   * the admin card (OD-6, FR-008: visible to the operator only).
   *
   * The caller has already read the account through `customer_accounts`'
   * `@OrgScoped` read model, which is the organization check:
   * `customer_addresses` carries no `organization_id`, so the guard's
   * `allowed-set` arm matches nothing here and would hide a sales
   * representative's own customer's rows. The widening is narrow by
   * construction — the statement pins `customerAccountId` — and goes with the
   * table in release 2.
   */
  listRefused(customerAccountId: string): Promise<CustomerAddress[]> {
    return withSystemScope(
      `customers: refused personal addresses of customer account ${customerAccountId}, authorised by its own @OrgScoped account read`,
      () =>
        this.deps.emFactory().find(
          CustomerAddress,
          { customerAccountId, deletedAt: null, mergeRefusal: { $ne: null } },
          { orderBy: { createdAt: 'asc', id: 'asc' } },
        ),
    );
  }

  /**
   * Blank **every** row of the account in the retired book — the ones the job
   * moved or erased, the ones the customer deleted, a refused one — the
   * retention sweep's step for an account it anonymizes (issue #927). The rows
   * the job moved are soft-deleted copies that still hold the data, so nothing
   * else ever reaches them. The same fields get the same values as the
   * Organization book's scrub (`'-'`, no phone, not default, country kept); a
   * row keeps its `deletedAt`, provenance and refusal code, none of which is
   * personal. One `customer_address.anonymized` entry per row, with a null
   * actor, no personal data and `wasDeleted`, in the scrub's transaction.
   *
   * Idempotent: only a row some part of the scrub is missing from is selected,
   * so a repeat call writes and records nothing. Answers how many rows it
   * scrubbed. For every account, whatever its Organization: the book was the
   * account's own. Run under the system scope the sweep's tick enters.
   */
  async anonymizeForAccount(customerAccountId: string): Promise<number> {
    return this.deps.emFactory().transactional(async (em) => {
      const rows = await em.find(
        CustomerAddress,
        { customerAccountId, ...anonymizationResidue() },
        { orderBy: { createdAt: 'asc', id: 'asc' }, lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      const now = new Date();
      for (const row of rows) {
        const wasDeleted = row.deletedAt != null;
        // command-coverage-ignore: the retention sweep's system-initiated
        // scrub, audited below with the null actor that fact deserves.
        row.recipientName = ERASED;
        row.street = ERASED;
        row.city = ERASED;
        row.postalCode = ERASED;
        row.phone = null;
        row.isDefault = false;
        row.deletedAt ??= now;
        this.deps.auditLog.recordWithin(em, {
          actorAdminUserId: null,
          action: 'customer_address.anonymized',
          objectType: 'customer_address',
          objectId: row.id,
          stateBefore: { customerAccountId, kind: row.kind, wasDeleted },
          stateAfter: { anonymizedAt: now.toISOString() },
        });
      }
      await em.flush();
      return rows.length;
    });
  }

  /** The next batch of accounts with pending rows, by keyset over the account id. */
  async #nextAccounts(after: string | null, limit: number): Promise<string[]> {
    const rows = await this.deps
      .emFactory()
      .execute<Array<{ id: string }>>(
        `select distinct "customer_account_id" as "id" from "customer_addresses"
          where ${PENDING}${after === null ? '' : ` and "customer_account_id" > ?`}
          order by "customer_account_id" asc limit ?`,
        after === null ? [limit] : [after, limit],
      );
    return rows.map((row) => row.id);
  }

  /**
   * `personalOrganizationOf`: account id → its personal Organization's id, for
   * the accounts of the batch whose Organization is personal and live
   * (`OrganizationRecord.isPersonal`, the one test of B2C; a soft-deleted one
   * has been anonymized, and its rows are erased — architect ruling Q2). An
   * account absent from the map is erased. `withoutOrganization`: the accounts
   * whose Organization, or whose account record, could not be found at all.
   */
  async #classify(accountIds: readonly string[]): Promise<{
    personalOrganizationOf: Map<string, string>;
    withoutOrganization: Set<string>;
  }> {
    const accounts = await this.deps.accounts.findByIds(accountIds);
    const organizationIds = [...new Set(accounts.map((a) => a.organizationId))];
    const organizations = organizationIds.length > 0 ? await this.deps.organizations.findByIds(organizationIds) : [];
    const found = new Set(organizations.map((o) => o.id));
    const personal = new Set(organizations.filter((o) => o.isPersonal && o.deletedAt === null).map((o) => o.id));
    const withOrganization = new Set(accounts.filter((a) => found.has(a.organizationId)).map((a) => a.id));
    return {
      personalOrganizationOf: new Map(
        accounts.filter((a) => personal.has(a.organizationId)).map((a) => [a.id, a.organizationId]),
      ),
      withoutOrganization: new Set(accountIds.filter((id) => !withOrganization.has(id))),
    };
  }

  /** This account's pending rows, oldest first, locked for this transaction. */
  #pendingRows(em: EntityManager, customerAccountId: string): Promise<CustomerAddress[]> {
    return em.find(
      CustomerAddress,
      { customerAccountId, deletedAt: null, mergeRefusal: null },
      { orderBy: { createdAt: 'asc', id: 'asc' }, lockMode: LockMode.PESSIMISTIC_WRITE },
    );
  }

  /**
   * Two phases, because the Organization write is `addresses`' own transaction
   * and must not run inside this module's: first decide every row's target —
   * an equal address the book holds, a new one the port creates, or the
   * owner's refusal — with no lock held; then, in one transaction over this
   * module's rows, lock them, re-check that each is still pending and record
   * the outcome with its audit entry. A crash between the two leaves the new
   * Organization address and a still-pending row, which the next run links.
   */
  async #move(customerAccountId: string, organizationId: string): Promise<AddressBookRetirementResult> {
    const candidates = await this.deps
      .emFactory()
      .find(
        CustomerAddress,
        { customerAccountId, deletedAt: null, mergeRefusal: null },
        { orderBy: { createdAt: 'asc', id: 'asc' } },
      );
    if (candidates.length === 0) return { ...ZERO };

    const book = await this.deps.addresses.list(organizationId);
    const byFingerprint = new Map<string, AddressRecord>(book.map((a) => [addressFingerprint(a), a]));
    const defaultKinds = new Set<string>(book.filter((a) => a.isDefault).map((a) => a.kind));
    const decisions = new Map<string, Decision>();

    for (const row of candidates) {
      const fingerprint = addressFingerprint(row);
      const existing = byFingerprint.get(fingerprint);
      if (existing !== undefined) {
        decisions.set(row.id, { kind: 'link', target: existing, deduplicated: true });
        continue;
      }
      try {
        const created = await this.deps.addresses.createAddress(organizationId, {
          kind: row.kind,
          recipientName: row.recipientName,
          street: row.street,
          city: row.city,
          postalCode: row.postalCode,
          country: row.country,
          ...(row.phone ? { phone: row.phone } : {}),
          isDefault: takesOverDefault(row, defaultKinds),
        });
        byFingerprint.set(fingerprint, created);
        if (created.isDefault) defaultKinds.add(created.kind);
        decisions.set(row.id, { kind: 'link', target: created, deduplicated: false });
      } catch (error) {
        // A refusal is the owner's answer about this one row — a country no
        // longer active, say — and is recorded for the operator; the rest of
        // the account's rows go on. A switched-off owner is not a refusal, and
        // anything that is not an HttpError fails the job, which retries.
        rethrowIfModuleDisabled(error);
        if (!(error instanceof HttpError)) throw error;
        decisions.set(row.id, { kind: 'refuse', code: error.code.slice(0, 64) });
      }
    }

    return this.deps.emFactory().transactional(async (em) => {
      const outcome = { ...ZERO };
      const rows = await this.#pendingRows(em, customerAccountId);
      const now = new Date();
      for (const row of rows) {
        const decision = decisions.get(row.id);
        // A row that arrived after the first phase waits for the next run.
        if (decision === undefined) continue;
        // command-coverage-ignore: a system-initiated, one-time move run by a
        // worker, audited below with the null actor that fact deserves.
        if (decision.kind === 'refuse') {
          row.mergeRefusal = decision.code;
          this.#audit(em, 'customer_address.merge_refused', row, { organizationId, mergeRefusal: decision.code });
          outcome.refused += 1;
          continue;
        }
        const wasDefault = row.isDefault;
        row.mergedIntoAddressId = decision.target.id;
        row.mergedAt = now;
        row.deletedAt = now;
        row.isDefault = false;
        this.#audit(em, 'customer_address.merge', row, {
          organizationId,
          mergedIntoAddressId: decision.target.id,
          deduplicated: decision.deduplicated,
          wasDefault,
        });
        if (decision.deduplicated) outcome.deduplicated += 1;
        else outcome.moved += 1;
      }
      await em.flush();
      return outcome;
    });
  }

  async #erase(customerAccountId: string): Promise<AddressBookRetirementResult> {
    return this.deps.emFactory().transactional(async (em) => {
      const outcome = { ...ZERO };
      const rows = await this.#pendingRows(em, customerAccountId);
      const now = new Date();
      for (const row of rows) {
        // command-coverage-ignore: a system-initiated, one-time erasure run by a
        // worker (OD-9), audited below with a null actor and no personal data.
        row.recipientName = ERASED;
        row.street = ERASED;
        row.city = ERASED;
        row.postalCode = ERASED;
        row.phone = null;
        row.isDefault = false;
        row.deletedAt = now;
        this.#audit(em, 'customer_address.erased', row, { erasedAt: now.toISOString() });
        outcome.erased += 1;
      }
      await em.flush();
      return outcome;
    });
  }

  #audit(em: EntityManager, action: string, row: CustomerAddress, stateAfter: Record<string, unknown>): void {
    this.deps.auditLog.recordWithin(em, {
      actorAdminUserId: null,
      action,
      objectType: 'customer_address',
      objectId: row.id,
      stateBefore: { customerAccountId: row.customerAccountId, kind: row.kind },
      stateAfter,
    });
  }
}
