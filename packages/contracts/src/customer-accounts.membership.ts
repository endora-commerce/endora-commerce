// `customer_accounts`' membership move — the `membershipPort` of
// `specs/191-membership-join-requests/contracts/membership-port.md`, with the
// `merge` mode of `specs/192-organization-merge/contracts/membership-merge-mode.md`.
//
// **Published in part.** This is what `specs/192-organization-merge/` (T068 –
// T070) needs and implements: the move (`changeOrganization`, and the same
// Command for a caller that runs it itself, `changeCommand`), in the modes
// `move` and `merge`. 191 WP-1 (#1831) adds `detachToPersonal`, the
// `detach_to_personal` mode and the deprecations of its §5 to this same
// surface; nothing here has to be replaced for that, only widened.

import { z } from 'zod';
import { hookableAction } from './command-hooks.js';
import type { CustomerAccountRecord } from './customer-accounts.js';

/**
 * A code, never prose: who or what asked for the move (191 research R-7). The
 * shape of `specs/186-aggregate-ports/`' caller source.
 */
export const membershipChangeSourceSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/);
export type MembershipChangeSource = z.infer<typeof membershipChangeSourceSchema>;

/** Core writes these; a deployment may write its own code. */
export const MEMBERSHIP_CHANGE_SOURCES = {
  operator: 'operator',
  joinRequest: 'join_request',
  integration: 'integration',
  /** An Organization merge moving the loser's members (`specs/192-organization-merge/`). */
  recordMerge: 'record_merge',
} as const;

/**
 * The kind of move. `detach_to_personal` is 191's and is not produced until
 * #1831 lands it; a consumer switching on the mode treats a value it does not
 * know as a `move`.
 */
export type MembershipChangeMode = 'move' | 'detach_to_personal' | 'merge';

export interface MembershipChangeInput {
  readonly customerAccountId: string;
  readonly organizationId: string;
  /**
   * Absent: the target's predefined *Member* role. Must be a role of
   * `organizationId`. Required with `merge`: the role map's value.
   */
  readonly organizationRoleId?: string;
  readonly source: MembershipChangeSource;
  /** Extension input for hook modules, keyed by module id (spec 176 FR-018). */
  readonly extensions?: Readonly<Record<string, unknown>>;
  /**
   * Present only for the mode `merge` (`specs/192-organization-merge/`): the
   * merge moving this account. Accepted only inside that merge's own system
   * scope while it runs from `fromOrganizationId` into `organizationId`;
   * otherwise `409 RECORD_MERGE_IN_PROGRESS`.
   */
  readonly merge?: { readonly mergeId: string; readonly fromOrganizationId: string };
}

export interface MembershipChangeResult {
  readonly customerAccount: CustomerAccountRecord;
  readonly fromOrganizationId: string;
  readonly toOrganizationId: string;
  readonly organizationRoleId: string;
  readonly mode: MembershipChangeMode;
  /** `false` when the account already was there with that role: nothing written, nothing emitted. */
  readonly changed: boolean;
}

/** `customer_account.organization.change` as the bus runs it — hand it to `commandBus.run` or `ctx.run`. */
export interface MembershipChangeCommand {
  readonly action: 'customer_account.organization.change';
  readonly objectType: 'customer_account';
  readonly objectId: string;
  run(ctx: never): Promise<{ readonly result: MembershipChangeResult }>;
}

/**
 * Container name: `membershipPort`. Owner: `customer_accounts`.
 *
 * Moves a customer account to another Organization with its role, as one
 * audited, hookable Command (`customer_account.organization.change`). **No
 * permission is checked here** — the caller is the gate: an admin route behind
 * `customers:manage` and the reach rule, an `organizations` Command, the
 * platform's merge runner, or server code running under `withSystemScope`.
 * Never resolve it for a customer-facing route that has not decided authority
 * itself.
 *
 * The actor is the ambient one (Principle XIII); automation is told apart by
 * `source`, recorded in the audit entry. Sessions are not touched: the next
 * request resolves the new Organization.
 *
 * Refusals: `404 CUSTOMER_NOT_FOUND` (account missing, or soft-deleted outside
 * a merge), `404 NOT_FOUND` (target missing, deleted or merged; role not of the
 * target), `409 ORG_OWNER_DEPLETION` (the last active administrator leaving a
 * company — never in the mode `merge`, whose source is archived rather than
 * depleted), `409 RECORD_MERGE_IN_PROGRESS` (`merge` outside its merge), and
 * whatever a `beforeCommit` hook vetoes with.
 *
 * Owner off: `customer_accounts` is non-deactivatable; the gate is never closed.
 */
export interface MembershipPort {
  changeOrganization(input: MembershipChangeInput): Promise<MembershipChangeResult>;
  /** The same move as a Command, for a caller that runs it as a child on its own transaction. */
  changeCommand(input: MembershipChangeInput): MembershipChangeCommand;
}

// --- hookable action, outbox, event (191 §4) ------------------------------------

export interface CustomerAccountOrganizationChangeHookData {
  readonly customerAccountId: string;
  readonly fromOrganizationId: string;
  readonly toOrganizationId: string;
  readonly fromOrganizationIsPersonal: boolean;
  readonly toOrganizationIsPersonal: boolean;
  readonly organizationRoleId: string;
  /** A hook switching on it treats an unknown value as `move`. */
  readonly mode: MembershipChangeMode;
  readonly source: string;
  /** The merge moving the account, in the mode `merge`; `null` otherwise. */
  readonly mergeId: string | null;
}

/** `afterCommit` data: ids and codes only. `organizationId` = the destination, which the drain pins the handler to. */
export type CustomerAccountOrganizationChangeOutbox = {
  readonly customerAccountId: string;
  readonly fromOrganizationId: string;
  readonly toOrganizationId: string;
  readonly organizationRoleId: string;
  readonly mode: MembershipChangeMode;
  readonly source: string;
  readonly organizationId: string;
};

export const CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS = {
  changeOrganization: hookableAction<CustomerAccountOrganizationChangeHookData, CustomerAccountOrganizationChangeOutbox>(
    'customer_account.organization.change',
    'customer_account',
    ['beforeCommit', 'afterCommit'],
  ),
} as const;

export const CUSTOMER_ACCOUNT_ORGANIZATION_CHANGED_EVENT = 'customer_account.organization_changed.v1' as const;

export interface CustomerAccountOrganizationChangedEvent {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly customerAccountId: string;
  readonly fromOrganizationId: string;
  readonly toOrganizationId: string;
  readonly organizationRoleId: string;
  /** `merge` when an Organization merge moved the account (`specs/192-organization-merge/` R-5). */
  readonly mode: MembershipChangeMode;
  readonly source: string;
  readonly mergeId: string | null;
}
