import { randomUUID } from 'node:crypto';
import { LockMode } from '@mikro-orm/core';
import {
  CUSTOMER_ACCOUNT_ORGANIZATION_CHANGED_EVENT,
  ERROR_CODES,
  isUuidShape,
  mergeIdOfScopeReason,
  type CustomerAccountOrganizationChangedEvent,
  type CustomerAccountOrganizationChangeHookData,
  type CustomerAccountOrganizationChangeOutbox,
  type CustomerAccountRecord,
  type MembershipChangeInput,
  type MembershipChangeMode,
  type MembershipChangeResult,
  type OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { RecordMergeService } from '@endora-commerce/platform/kernel';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import { CustomerAccount } from '../entities/customer-account.entity.js';
import { organizationMoveAuditState } from '../services/customer-account-audit-state.js';
import {
  entityManagerAccountRoleStore,
  refuseLosingLastAdministrator,
  type OrganizationRoleLookup,
} from './customer-account-role-rules.js';

/**
 * `customer_account.organization.change` — the membership move of
 * `specs/191-membership-join-requests/contracts/membership-port.md` §3, in the
 * modes this module implements today (`specs/192-organization-merge/` T069):
 *
 *  - `move`: an account moves to another Organization with a role of it
 *    (absent: the target's *Member*). The last active administrator of a
 *    **company** may not leave it (`409 ORG_OWNER_DEPLETION`), under the
 *    holder lock of `refuseLosingLastAdministrator`;
 *  - `merge` (`contracts/membership-merge-mode.md` §2): an Organization merge
 *    moving the loser's members to the survivor. Accepted only inside that
 *    merge's own system scope while it runs from the account's Organization
 *    into the target (`409 RECORD_MERGE_IN_PROGRESS` otherwise), with the
 *    role the merge's role map names, which must be the target's. It skips
 *    the last-administrator refusal — the source is archived, not depleted —
 *    and moves a removed (soft-deleted) account too, so no row is left naming
 *    the archived loser.
 *
 * One audit entry per account (191 FR-005): `organizationMoveAuditState` plus
 * `mode`, `source` and, for a merge, `mergeId` — ids and codes only (D-288).
 * Hookable (`beforeCommit`, `afterCommit`), not reversible, and it publishes
 * `customer_account.organization_changed.v1` with its `mode` on commit
 * (R-5: hook and outbox consumers tell a merge from a move). The same place
 * and role writes, audits and emits nothing. Sessions are not touched.
 */
export interface ChangeOrganizationCommandDeps {
  readonly roles: OrganizationRoleLookup;
  readonly organizations: () => Pick<OrganizationDetailsPort, 'findById'>;
  readonly recordMerge: () => Pick<RecordMergeService, 'getWithin'>;
  readonly toRecord: (account: CustomerAccount) => Promise<CustomerAccountRecord>;
}

interface ChangeOutcome extends MembershipChangeResult {
  readonly fromOrganizationIsPersonal: boolean;
  readonly toOrganizationIsPersonal: boolean;
  readonly source: string;
  readonly mergeId: string | null;
}

function notFound(message: string): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, message);
}

function notThisMerge(): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.RECORD_MERGE_IN_PROGRESS,
    'A membership move in the merge mode runs only inside the merge that moves this account.',
  );
}

export function makeChangeOrganizationCommand(
  deps: ChangeOrganizationCommandDeps,
  input: MembershipChangeInput,
): Command<ChangeOutcome> & { readonly action: 'customer_account.organization.change'; readonly objectType: 'customer_account' } {
  const mode: MembershipChangeMode = input.merge ? 'merge' : 'move';
  return {
    action: 'customer_account.organization.change',
    objectType: 'customer_account',
    objectId: input.customerAccountId,
    ...(input.extensions ? { extensions: input.extensions } : {}),
    run: async ({ em }) => {
      // 1. The account, locked for the rest of the Command.
      if (!isUuidShape(input.customerAccountId)) {
        throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
      }
      const account = await em.findOne(
        CustomerAccount,
        { id: input.customerAccountId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (account === null || (account.deletedAt && mode !== 'merge')) {
        throw new HttpError(404, ERROR_CODES.CUSTOMER_NOT_FOUND, 'Customer not found.');
      }
      const fromOrganizationId = account.organizationId;

      // 2. The merge mode is its merge's alone (membership-merge-mode §2.1).
      if (input.merge) {
        const { mergeId } = input.merge;
        if (mergeIdOfScopeReason(getTenantContext()?.reason) !== mergeId) throw notThisMerge();
        const merge = await deps.recordMerge().getWithin(em, mergeId);
        if (
          merge === null ||
          merge.hostType !== 'organization' ||
          merge.state !== 'running' ||
          merge.loserId !== input.merge.fromOrganizationId ||
          merge.survivorId !== input.organizationId
        ) {
          throw notThisMerge();
        }
        if (fromOrganizationId !== input.merge.fromOrganizationId && fromOrganizationId !== input.organizationId) {
          throw notThisMerge();
        }
        if (input.organizationRoleId === undefined) {
          throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A merge moves an account with the role its role map names.');
        }
      }

      // 3. The target and the source, as `organizations` reads them.
      const [target, source] = await Promise.all([
        deps.organizations().findById(input.organizationId),
        fromOrganizationId === input.organizationId ? null : deps.organizations().findById(fromOrganizationId),
      ]);
      if (target === null || target.deletedAt || target.mergedIntoOrganizationId) throw notFound('Organization not found.');

      // 4. The role (191 R-4): given, or the target's Member; never another Organization's.
      const roleId = input.organizationRoleId ?? (await deps.roles.predefinedRoleId(input.organizationId, 'member'));
      if ((await deps.roles.findRole(input.organizationId, roleId)) === null) throw notFound('Organization role not found.');

      const base = {
        fromOrganizationId,
        toOrganizationId: input.organizationId,
        organizationRoleId: roleId,
        mode,
        fromOrganizationIsPersonal: (source ?? target).isPersonal,
        toOrganizationIsPersonal: target.isPersonal,
        source: input.source,
        mergeId: input.merge?.mergeId ?? null,
      };

      // 5. Already there: nothing written, nothing audited, nothing emitted.
      if (fromOrganizationId === input.organizationId && account.organizationRoleId === roleId) {
        return { result: { ...base, customerAccount: await deps.toRecord(account), changed: false }, skipAudit: true };
      }

      // 6. The last administrator of a company stays — except in a merge, whose source is archived.
      if (mode === 'move' && fromOrganizationId !== input.organizationId && source !== null && !source.isPersonal) {
        await refuseLosingLastAdministrator(
          { roles: deps.roles, store: entityManagerAccountRoleStore },
          entityManagerAccountRoleStore(em),
          account,
          () => new HttpError(409, ERROR_CODES.ORG_OWNER_DEPLETION, 'The organization would be left without an administrator.'),
        );
      }

      // 7. Organization and role in one statement: the composite foreign key
      //    refuses the previous Organization's role (170 research R-34).
      const before = { organizationId: account.organizationId, organizationRoleId: account.organizationRoleId };
      account.organizationId = input.organizationId;
      account.organizationRoleId = roleId;
      await em.flush();

      // 8. A tenant move by name: the Organization ids stay out of the audit log (D-288).
      const { stateBefore, stateAfter } = organizationMoveAuditState(before, {
        organizationId: input.organizationId,
        organizationRoleId: roleId,
      });
      return {
        result: { ...base, customerAccount: await deps.toRecord(account), changed: true },
        before: stateBefore,
        after: {
          ...stateAfter,
          mode,
          source: input.source,
          ...(input.merge ? { mergeId: input.merge.mergeId } : {}),
        },
      };
    },
    hookData: (result): CustomerAccountOrganizationChangeHookData => ({
      customerAccountId: input.customerAccountId,
      fromOrganizationId: result.fromOrganizationId,
      toOrganizationId: result.toOrganizationId,
      fromOrganizationIsPersonal: result.fromOrganizationIsPersonal,
      toOrganizationIsPersonal: result.toOrganizationIsPersonal,
      organizationRoleId: result.organizationRoleId,
      mode: result.mode,
      source: result.source,
      mergeId: result.mergeId,
    }),
    outboxData: (result): CustomerAccountOrganizationChangeOutbox => ({
      customerAccountId: input.customerAccountId,
      fromOrganizationId: result.fromOrganizationId,
      toOrganizationId: result.toOrganizationId,
      organizationRoleId: result.organizationRoleId,
      mode: result.mode,
      source: result.source,
      organizationId: result.toOrganizationId,
    }),
    event: (result) => {
      if (!result.changed) return undefined;
      const payload: CustomerAccountOrganizationChangedEvent = {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        customerAccountId: input.customerAccountId,
        fromOrganizationId: result.fromOrganizationId,
        toOrganizationId: result.toOrganizationId,
        organizationRoleId: result.organizationRoleId,
        mode: result.mode,
        source: result.source,
        mergeId: result.mergeId,
      };
      return { eventName: CUSTOMER_ACCOUNT_ORGANIZATION_CHANGED_EVENT, payload };
    },
  };
}

/** The port's answer: the Command's result without the hook-only fields. */
export function toMembershipChangeResult(outcome: ChangeOutcome): MembershipChangeResult {
  return {
    customerAccount: outcome.customerAccount,
    fromOrganizationId: outcome.fromOrganizationId,
    toOrganizationId: outcome.toOrganizationId,
    organizationRoleId: outcome.organizationRoleId,
    mode: outcome.mode,
    changed: outcome.changed,
  };
}
