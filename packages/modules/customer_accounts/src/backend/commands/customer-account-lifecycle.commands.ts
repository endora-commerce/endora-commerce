import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  isUuidShape,
  type AuthSessionPort,
  type CustomerAccountOutbox,
  type CustomerAccountRecord,
  type CustomerAccountUpdateHookData,
  type CustomFieldMerge,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { blockAuditState, changedKeys } from '../services/customer-account-audit-state.js';
import {
  entityManagerAccountRoleStore,
  refuseDepletingCompanyOrganization,
  type OrganizationRoleLookup,
  type PersonalOrganizationCheck,
} from './customer-account-role-rules.js';

/**
 * The account lifecycle `customers`' admin screens run, as Commands
 * (`specs/186-aggregate-ports/` US3, T050, issue #1822): `customer_account.blocked`,
 * `.unblocked`, `.deleted`, `.restored`, `.group_assigned` and
 * `customer.custom_fields.update`.
 *
 * Until 0.113.0 the first five were written by
 * `CustomerAccountLifecycleWriteService` and audited **after** the flush on the
 * audit port's own connection, so an entry could be lost after its write, and
 * no command hook saw them. Each is a Command now, with the action string and
 * the audit state it always recorded, so an account's history reads on
 * unchanged (`specs/conventions/audit-state.md`).
 *
 * Two things the admin route did beside the write moved in with it (FR-013),
 * so a server-side call does them too:
 *
 * - **the depletion guard** of a block and a deletion — `409 ORG_OWNER_DEPLETION`
 *   for the last active, unblocked administrator of a company Organization —
 *   counted under a lock in the write's transaction rather than over a read
 *   before it (research R-17.2);
 * - **the end of the account's sessions** after a block and a deletion,
 *   deferred to the commit through `afterCommit` (the EventBus's `afterScope`),
 *   so a write that rolls back ends nobody's session, and a session-store
 *   failure is logged without undoing the committed block (R-17.1).
 *
 * The actor is the bus's: `blockedByAdminUserId` and
 * `deletionRequestedByAdminUserId` are the acting administrator, `null` under
 * the `system` actor of a worker (Principle XIII, research R-4).
 */
export interface CustomerAccountLifecycleCommandDeps {
  readonly roles: OrganizationRoleLookup;
  readonly isPersonal: PersonalOrganizationCheck;
  readonly sessions: Pick<AuthSessionPort, 'destroyAllForCustomer'>;
  /** Runs `fn` once the enclosing Command has committed (`EventBus.afterScope`). */
  readonly afterCommit: (fn: () => Promise<void>) => Promise<void>;
}

/** The record the port answers with, built from the row the Command wrote. */
export type LifecycleResult = CustomerAccount;

function customerNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
}

async function loadLive(em: EntityManager, id: string): Promise<CustomerAccount> {
  if (!isUuidShape(id)) throw customerNotFound();
  const account = await em.findOne(CustomerAccount, { id, deletedAt: null });
  if (!account) throw customerNotFound();
  return account;
}

async function loadAny(em: EntityManager, id: string): Promise<CustomerAccount> {
  if (!isUuidShape(id)) throw customerNotFound();
  const account = await em.findOne(CustomerAccount, { id });
  if (!account) throw customerNotFound();
  return account;
}

function endSessionsAfterCommit(deps: CustomerAccountLifecycleCommandDeps, customerAccountId: string): Promise<void> {
  return deps.afterCommit(() => deps.sessions.destroyAllForCustomer(customerAccountId));
}

/**
 * `customer_account.blocked`. Idempotent: an account already blocked records
 * nothing and ends no session. `blockSource` is `staff` — the operator's block;
 * an Organization owner's (`org_owner`) is not this Command.
 */
export function makeBlockCustomerAccountCommand(
  deps: CustomerAccountLifecycleCommandDeps,
  input: { readonly customerAccountId: string; readonly reason: string | null },
): Command<LifecycleResult> {
  return {
    action: 'customer_account.blocked',
    objectType: 'customer_account',
    objectId: input.customerAccountId,
    run: async ({ em, actor }) => {
      const account = await loadLive(em, input.customerAccountId);
      if (account.blockedAt) return { result: account, skipAudit: true };
      await refuseDepletingCompanyOrganization(
        deps,
        entityManagerAccountRoleStore(em),
        account,
        () =>
          new HttpError(
            409,
            ERROR_CODES.ORG_OWNER_DEPLETION,
            'Cannot block the last organization administrator; the organization would be left without an admin.',
          ),
      );
      const before = blockAuditState(account);
      account.blockedAt = new Date();
      account.blockSource = 'staff';
      account.blockedByAdminUserId = actor.actorAdminUserId;
      account.blockedByCustomerAccountId = null;
      account.blockReason = input.reason;
      await em.flush();
      // Revoke the sessions so the block takes effect at once (feature 040 SC-002).
      await endSessionsAfterCommit(deps, account.id);
      return { result: account, before, after: blockAuditState(account) };
    },
  };
}

/** `customer_account.unblocked`. Idempotent, the same way round. */
export function makeUnblockCustomerAccountCommand(input: {
  readonly customerAccountId: string;
}): Command<LifecycleResult> {
  return {
    action: 'customer_account.unblocked',
    objectType: 'customer_account',
    objectId: input.customerAccountId,
    run: async ({ em }) => {
      const account = await loadLive(em, input.customerAccountId);
      if (!account.blockedAt) return { result: account, skipAudit: true };
      const before = blockAuditState(account);
      account.blockedAt = null;
      account.blockSource = null;
      account.blockedByAdminUserId = null;
      account.blockedByCustomerAccountId = null;
      account.blockReason = null;
      await em.flush();
      return { result: account, before, after: blockAuditState(account) };
    },
  };
}

/** `customer_account.deleted` — the soft delete, then the end of the account's sessions. */
export function makeSoftDeleteCustomerAccountCommand(
  deps: CustomerAccountLifecycleCommandDeps,
  input: { readonly customerAccountId: string },
): Command<LifecycleResult> {
  return {
    action: 'customer_account.deleted',
    objectType: 'customer_account',
    objectId: input.customerAccountId,
    run: async ({ em, actor }) => {
      const account = await loadAny(em, input.customerAccountId);
      if (account.deletedAt) {
        throw new HttpError(409, ERROR_CODES.CUSTOMER_ALREADY_DELETED, 'Customer is already deleted.');
      }
      // A personal Organization's sole member is its administrator; deleting
      // them is how that Organization ends (PR-3).
      await refuseDepletingCompanyOrganization(
        deps,
        entityManagerAccountRoleStore(em),
        account,
        () => new HttpError(409, ERROR_CODES.ORG_OWNER_DEPLETION, 'Cannot delete the last organization administrator.'),
      );
      const deletedAt = new Date();
      account.deletedAt = deletedAt;
      account.deletionRequestedByAdminUserId = actor.actorAdminUserId;
      await em.flush();
      await endSessionsAfterCommit(deps, account.id);
      return { result: account, before: { deletedAt: null }, after: { deletedAt: deletedAt.toISOString() } };
    },
  };
}

/**
 * `customer_account.restored`. An anonymised account cannot be restored. The
 * restore window `customers.deletion_retention_days` is `customers`' policy and
 * is its admin route's gate, not this Command's.
 */
export function makeRestoreCustomerAccountCommand(input: {
  readonly customerAccountId: string;
}): Command<LifecycleResult> {
  return {
    action: 'customer_account.restored',
    objectType: 'customer_account',
    objectId: input.customerAccountId,
    run: async ({ em }) => {
      const account = await loadAny(em, input.customerAccountId);
      if (!account.deletedAt) {
        throw new HttpError(409, ERROR_CODES.CUSTOMER_NOT_DELETED, 'Customer is not deleted.');
      }
      if (account.anonymizedAt) {
        throw new HttpError(
          409,
          ERROR_CODES.CUSTOMER_RESTORE_WINDOW_ELAPSED,
          'The restore window has elapsed; this account has been permanently anonymized.',
        );
      }
      account.deletedAt = null;
      account.deletionRequestedByAdminUserId = null;
      await em.flush();
      return { result: account, before: { deletedAt: 'set' }, after: { deletedAt: null } };
    },
  };
}

/** `customer_account.group_assigned` — `null` clears the direct group. */
export function makeSetCustomerGroupCommand(input: {
  readonly customerAccountId: string;
  readonly customerGroupId: string | null;
}): Command<LifecycleResult> {
  return {
    action: 'customer_account.group_assigned',
    objectType: 'customer_account',
    objectId: input.customerAccountId,
    run: async ({ em }) => {
      const account = await loadLive(em, input.customerAccountId);
      const before = { customerGroupId: account.customerGroupId ?? null };
      account.customerGroupId = input.customerGroupId;
      await em.flush();
      return { result: account, before, after: { customerGroupId: input.customerGroupId } };
    },
  };
}

/**
 * `customer.custom_fields.update` (feature 055) — the caller's merge, run
 * between this Command's load and its write so a concurrent patch is not lost.
 * The entry names the keys whose value changed, never the values (D-288).
 *
 * Hookable, both phases (`specs/193-admin-form-extensions/` FR-110): a hook is
 * handed the after-state through `toRecord`, which the caller builds with what
 * it already knows of the account's second factor.
 */
export function makeSetCustomerCustomFieldValuesCommand(input: {
  readonly customerAccountId: string;
  readonly merge: CustomFieldMerge;
  readonly toRecord: (account: CustomerAccount) => CustomerAccountRecord;
}): Command<LifecycleResult> {
  // Set by `run`, which the bus calls before `hookData` and `outboxData`.
  let changedCustomFields: readonly string[] = [];
  return {
    action: 'customer.custom_fields.update',
    objectType: 'customer_account',
    objectId: input.customerAccountId,
    hookData: (account): CustomerAccountUpdateHookData => ({
      customerAccount: input.toRecord(account),
      changedFields: [],
      changedCustomFields,
    }),
    outboxData: (account): CustomerAccountOutbox => ({
      customerAccountId: account.id,
      organizationId: account.organizationId ?? null,
      changedFields: [],
      changedCustomFields,
    }),
    run: async ({ em }) => {
      const account = isUuidShape(input.customerAccountId)
        ? await em.findOne(CustomerAccount, { id: input.customerAccountId })
        : null;
      if (!account) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer not found.');
      const current = { ...(account.customFieldValues ?? {}) };
      account.customFieldValues = await input.merge(current);
      changedCustomFields = changedKeys(current, account.customFieldValues ?? {});
      return { result: account, before: null, after: { changedCustomFields } };
    },
  };
}
